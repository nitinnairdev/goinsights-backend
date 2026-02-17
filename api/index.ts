import express, { Request, Response } from "express";
import cors from "cors";
import * as geotab from "./geotab";
import * as gemini from "./gemini";

const app = express();
app.use(cors());
app.use(express.json());

// Main Endpoint for a Card (e.g., /api/insights/safety)
app.get("/api/insights/:category", async (req: Request, res: Response) => {
  try {
    const category = req.params.category;
    let data;

    switch (category) {
      case "safety":
        data = await geotab.getSafetyInsights();
        break;
      case "fuel":
        data = await geotab.getFuelInsights();
        break;
      case "faults":
        data = await geotab.getFaultInsights();
        break;
      case "idling":
        data = await geotab.getIdlingInsights();
        break;
      case "trips":
        data = await geotab.getTripInsights();
        break;
      default:
        return res
          .status(400)
          .json({ error: `Category '${category}' is not supported.` });
    }

    const aiSummary = await gemini.getInsightSummary(category, data);

    res.json({ ...data, aiSummary });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Chatbot endpoint
app.post("/api/ace/chat", async (req, res) => {
  try {
    const { prompt, chatId } = req.body;
    const aceResponse = await geotab.askGeotabAce(prompt, chatId);
    res.json(aceResponse);
  } catch (err: any) {
    res.status(500).send(err.message);
  }
});

app.listen(3000, () => console.log("GoInsights Backend running on port 3000"));
