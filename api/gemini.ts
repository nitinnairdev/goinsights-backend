import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("❌ GEMINI_API_KEY is missing from .env file");
}

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

/**
 * 1. CARD INSIGHTS: Summarizes a specific metric (Safety, Fuel, etc.)
 * Used by the dashboard cards for the "at-a-glance" delta explanation.
 */
export const getInsightSummary = async (
  category: string,
  data: any,
): Promise<string> => {
  try {
    const prompt = `
      You are GoInsight, a professional Fleet Intelligence Assistant.
      Analyze these ${category} statistics for the last 24 hours compared to the 30-day average:
      
      - Current (Last 24h): ${data.current}
      - 30-Day Daily Average: ${data.benchmark}
      - Percentage Change (Delta): ${data.delta}%

      Task: Provide a 2-sentence briefing.
      Sentence 1: Evaluate if this trend is positive, negative, or neutral.
      Sentence 2: Suggest one specific management action based on Geotab best practices.
      
      Tone: Professional, concise, and executive.
    `;

    const result = await model.generateContent(prompt);
    console.log(result.response.text());
    return result.response.text();
  } catch (error: any) {
    console.error(`Gemini Insight Error (${category}):`, error);
    return "Insight temporarily unavailable. Please check raw data.";
  }
};

/**
 * 2. CHATBOT PANEL: Handles the right-side interactive chat.
 * This takes the 'context' of the current fleet data so the user can ask follow-up questions.
 */
export const generateChatResponse = async (
  userMessage: string,
  fleetContext: any,
): Promise<string> => {
  try {
    const prompt = `
      You are the GoInsight Fleet Advocate. You are helping a fleet manager in a live chat.
      
      Current Fleet Context:
      ${JSON.stringify(fleetContext)}

      User Question: "${userMessage}"

      Instructions:
      - Answer the question using the provided fleet context data.
      - If the data points to a problem (e.g., high idling or many faults), be proactive in your advice.
      - If you don't have enough data to answer specifically, suggest they check the "Geotab Ace" deep-dive tool.
      - Keep responses under 3 sentences unless a detailed explanation is requested.
    `;

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (error: any) {
    console.error("Gemini Chat Error:", error);
    return "I'm having trouble accessing the fleet intelligence right now. How else can I help?";
  }
};
