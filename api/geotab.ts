import dotenv from "dotenv";
dotenv.config();

const BASE_URL = `https://${process.env.GEOTAB_SERVER || "my.geotab.com"}/apiv1`;

/**
 * Handles Authentication and Federation.
 * If the server returns "path": "my3.geotab.com", all subsequent
 * calls must go there.
 */
export const getAuth = async () => {
  try {
    const authResponse = await fetch(BASE_URL, {
      method: "POST",
      body: JSON.stringify({
        method: "Authenticate",
        params: {
          database: process.env.GEOTAB_DATABASE,
          userName: process.env.GEOTAB_USERNAME,
          password: process.env.GEOTAB_PASSWORD,
        },
      }),
      headers: { "Content-Type": "application/json" },
    });

    const authData = await authResponse.json();
    if (authData.error) throw new Error(authData.error.message);

    const { credentials, path } = authData.result;

    // 🌐 Federation Fix: Use specific server if provided
    const targetUrl =
      path === "ThisServer" ? BASE_URL : `https://${path}/apiv1`;

    console.log(`🚀 Authenticated. Targeting: ${targetUrl}`);
    return { credentials, targetUrl };
  } catch (error: any) {
    console.error("❌ Geotab Auth Failed:", error.message);
    throw error;
  }
};

/**
 * Generic fetcher for metrics with 24h vs 30d comparison.
 */
const fetchMetricWithDelta = async (
  typeName: string,
  diagnosticId: string | null = null,
) => {
  const { credentials, targetUrl } = await getAuth();
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(
    now.getTime() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const searchParams: any = { fromDate: thirtyDaysAgo };
  if (diagnosticId) searchParams.diagnosticSearch = { id: diagnosticId };

  const response = await fetch(targetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "Get",
      resultsLimit: 50,
      params: { typeName, search: searchParams, credentials },
    }),
  });

  const data = await response.json();
  const result = data.result || [];

  console.log("Result:", result);

  const todayData = result.filter(
    (item: any) => (item.dateTime || item.activeFrom || item.start) > oneDayAgo,
  );
  const pastData = result.filter(
    (item: any) =>
      (item.dateTime || item.activeFrom || item.start) <= oneDayAgo,
  );

  const todayTotal = todayData.length;
  const avg30Day = pastData.length / 29 || 0;
  const delta = avg30Day === 0 ? 0 : ((todayTotal - avg30Day) / avg30Day) * 100;

  return {
    current: todayTotal,
    benchmark: +avg30Day.toFixed(1),
    delta: +delta.toFixed(1),
  };
};

export const getTripInsights = () => fetchMetricWithDelta("Trip");
export const getSafetyInsights = () => fetchMetricWithDelta("ExceptionEvent");
export const getFaultInsights = () => fetchMetricWithDelta("FaultData");
export const getIdlingInsights = () =>
  fetchMetricWithDelta("LogRecord", "DiagnosticEngineIdleTimeId");
export const getFuelInsights = () =>
  fetchMetricWithDelta("StatusData", "DiagnosticFuelLevelId");
export const getHOSInsights = () => fetchMetricWithDelta("DriverStatusChange");

/**
 * Geotab Ace API Implementation.
 * Uses 'GetAceResults' to communicate with the GenAI orchestration layer.
 */
/**
 * Geotab Ace API Implementation
 * Approach: Call create-chat/send-prompt -> Get message_group.id -> Poll get-message-group
 */
export const askGeotabAce = async (prompt: string, existingChatId?: string) => {
  const { credentials, targetUrl } = await getAuth();
  let chatId = existingChatId;

  // We remove the strict "list format only" constraint to let Ace provide the raw preview_array
  const constrainedPrompt = `${prompt} (IMPORTANT: Provide a very brief, 1-2 sentence summary. The specific data will be shown in a table.)`;

  // --- STEP 1: Ensure we have a Chat ID ---
  if (!chatId) {
    const createRes = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "GetAceResults",
        params: {
          serviceName: "dna-planet-orchestration",
          functionName: "create-chat",
          customerData: true,
          functionParameters: {},
          credentials,
        },
      }),
    });
    const createData = await createRes.json();
    chatId = createData.result?.apiResult?.results?.[0]?.chat_id;
    if (!chatId) throw new Error("Failed to retrieve chat_id.");
  }

  // --- STEP 2: Send the Prompt ---
  const promptRes = await fetch(targetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "GetAceResults",
      params: {
        serviceName: "dna-planet-orchestration",
        functionName: "send-prompt",
        customerData: true,
        functionParameters: { chat_id: chatId, prompt: constrainedPrompt },
        credentials,
      },
    }),
  });
  const promptData = await promptRes.json();
  const messageGroupId =
    promptData.result?.apiResult?.results?.[0]?.message_group?.id;

  // --- STEP 3: Poll for completion ---
  let attempts = 0;
  while (attempts < 30) {
    await new Promise((r) => setTimeout(r, 5000));

    const pollRes = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "GetAceResults",
        params: {
          serviceName: "dna-planet-orchestration",
          functionName: "get-message-group",
          customerData: true,
          functionParameters: {
            chat_id: chatId,
            message_group_id: messageGroupId,
          },
          credentials,
        },
      }),
    });

    const pollData = await pollRes.json();
    const group = pollData.result?.apiResult?.results?.[0]?.message_group;
    const status = group?.status?.status;

    if (status === "DONE") {
      const messages: any[] = Object.values(group.messages || {});

      // 1. Find the message containing the data (usually type 'UserDataReference')
      const dataMsg = messages.find(
        (m) => m.preview_array && m.preview_array.length > 0,
      );

      // 2. Find the assistant's verbal response (usually type 'COTMessage')
      const assistantMsg = messages.find(
        (m) => m.role === "assistant" && (m.reasoning || m.content),
      );

      // Extract text summary: prioritise reasoning, then content, then interpretation
      const rawText =
        assistantMsg?.reasoning ||
        assistantMsg?.content ||
        assistantMsg?.interpretation ||
        "";
      const trimmedText = rawText.split("\n")[0].trim();

      return {
        text: trimmedText,
        data: dataMsg?.preview_array || [],
        columns: dataMsg?.columns || [],
        chatId: chatId,
      };
    }

    if (status === "FAILED") throw new Error("Ace status failed.");
    attempts++;
  }
  throw new Error("Ace Polling Timeout.");
};
