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
    benchmark: avg30Day.toFixed(1),
    delta: delta.toFixed(1),
  };
};

export const getTripInsights = () => fetchMetricWithDelta("Trip");
export const getSafetyInsights = () => fetchMetricWithDelta("ExceptionEvent");
export const getFaultInsights = () => fetchMetricWithDelta("FaultData");
export const getIdlingInsights = () =>
  fetchMetricWithDelta("LogRecord", "DiagnosticEngineIdleTimeId");
export const getFuelInsights = () =>
  fetchMetricWithDelta("StatusData", "DiagnosticFuelLevelId");

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
  const constrainedPrompt = `${prompt} (IMPORTANT: Provide a very brief, precise answer. Limit to 2-3 sentences. No long paragraphs.)`;
  // --- STEP 1: Ensure we have a Chat ID (create-chat) ---
  if (!chatId) {
    console.log("🆕 No Chat ID found. Creating new session...");
    const createRes = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "GetAceResults",
        params: {
          serviceName: "dna-planet-orchestration",
          functionName: "create-chat",
          customerData: true,
          functionParameters: {}, // Python example uses empty dict for create-chat
          credentials,
        },
      }),
    });

    const createData = await createRes.json();
    chatId = createData.result?.apiResult?.results?.[0]?.chat_id;

    if (!chatId) throw new Error("Failed to retrieve chat_id from Geotab Ace.");
    console.log(`✅ Chat Created: ${chatId}`);
  }

  // --- STEP 2: Send the Prompt (send-prompt) ---
  console.log("✉️ Sending prompt to Ace...");
  const promptRes = await fetch(targetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "GetAceResults",
      params: {
        serviceName: "dna-planet-orchestration",
        functionName: "send-prompt",
        customerData: true,
        functionParameters: {
          chat_id: chatId,
          prompt: constrainedPrompt,
        },
        credentials,
      },
    }),
  });

  const promptData = await promptRes.json();
  const messageGroupId =
    promptData.result?.apiResult?.results?.[0]?.message_group?.id;

  if (!messageGroupId)
    throw new Error("Failed to get message_group_id after sending prompt.");

  // --- STEP 3: Poll for completion (get-message-group) ---
  let attempts = 0;
  while (attempts < 30) {
    // Increased attempts for complex queries
    await new Promise((r) => setTimeout(r, 5000)); // Python uses 5s sleep

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
            chat_id: chatId, // Added based on Python example
            message_group_id: messageGroupId, // Fixed key name from 'id' to 'message_group_id'
          },
          credentials,
        },
      }),
    });

    const pollData = await pollRes.json();
    const group = pollData.result?.apiResult?.results?.[0]?.message_group;
    const status = group?.status?.status;

    console.log("Poll Data:", group);
    console.log(`🤖 Ace Status: ${status || "UNKNOWN"}`);

    if (status === "DONE") {
      const messages = Object.values(group.messages || {});
      const assistantMsg: any = [...messages]
        .reverse()
        .find((m: any) => m.role === "assistant");

      // Get the raw content
      const fullContent =
        assistantMsg?.content || assistantMsg?.reasoning || "";

      // Trim to the first newline (\n)
      // This effectively removes the 'Confidence Level' and 'References' sections
      const trimmedText = fullContent.split("\n")[0].trim();

      return {
        text: trimmedText,
        data: assistantMsg?.preview_array || [],
        chatId: chatId,
      };
    }

    if (status === "FAILED") {
      throw new Error(`Ace status failed for group ${messageGroupId}`);
    }

    attempts++;
  }

  throw new Error("Ace Polling Timeout.");
};
