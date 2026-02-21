# 🧠 GoInsights Backend Architecture

The GoInsights backend acts as the **Intelligent Orchestrator** of the ecosystem.  
It authenticates with Geotab, aggregates fleet telemetry, calculates performance deltas, and coordinates between Google Gemini and Geotab Ace to deliver both executive summaries and deep conversational intelligence.

---

## 🏛️ Technical Stack

- **Runtime:** Node.js + Express (TypeScript)
- **Deployment:** Railway (Production)
- **AI Model:** Gemini 2.5 Flash Lite
- **Fleet Data Source:** Geotab NGeotab API
- **GenAI Orchestration:** Geotab Ace (`dna-planet-orchestration`)
- **Configuration:** dotenv (environment-based secrets)

---

## 🧩 Architectural Components

### 1️⃣ API Layer (Express Gateway)

The backend exposes two primary capabilities:

**Insight Cards API**
- `GET /api/insights/:category`
- Supports: safety, fuel, faults, idling, trips, hos
- Returns:
  - Current (24h value)
  - 30-day daily benchmark
  - % delta
  - Gemini-generated executive summary

**InsightsBot (Ace Chat API)**
- `POST /api/ace/chat`
- Proxies prompts to Geotab Ace
- Returns:
  - Short executive summary
  - Structured preview data (tables)
  - Column metadata
  - Persistent chatId for session continuity

---

### 2️⃣ Authentication & Federation Layer

Handles Geotab authentication using:

- `GEOTAB_DATABASE`
- `GEOTAB_USERNAME`
- `GEOTAB_PASSWORD`
- `GEOTAB_SERVER`

**Federation-Aware Design**
- If Geotab returns a different `path` (e.g., `my3.geotab.com`),
- All subsequent API calls dynamically redirect to that server.

This ensures compatibility with Geotab’s multi-server architecture.

---

### 3️⃣ Telemetry Aggregator Engine

Core function: `fetchMetricWithDelta()`

**Purpose**
- Fetch 30 days of fleet telemetry
- Separate:
  - Last 24 hours (Current)
  - Previous 29 days (Benchmark window)

**Delta Logic**
- Calculates 30-day rolling daily average
- Compares 24h total against baseline
- Outputs percentage variance

**Metric Coverage**
- Trips
- Safety events
- Fault data
- Engine idling
- Fuel usage
- HOS status changes

This creates a statistically grounded signal before AI summarization occurs.

---

### 4️⃣ AI Orchestration Layer

#### 🥇 Card-Level Executive Briefings (Gemini)

Function: `getInsightSummary()`

- Injects:
  - Current metric
  - 30-day average
  - % delta
- Forces:
  - 2-sentence executive briefing
  - Clear trend evaluation (positive / negative / neutral)
  - One actionable fleet management recommendation

Tone: Professional, concise, decision-ready.

---

#### 🥈 Conversational Intelligence (Geotab Ace)

Function: `askGeotabAce()`

Implements a 3-step workflow:

1. Create chat (if no chatId)
2. Send prompt to orchestration service
3. Poll until completion

Returns:
- Short assistant summary
- Structured dataset (`preview_array`)
- Column definitions
- Persistent chatId

This allows:
- Deep entity resolution
- Table-based fleet answers
- Session continuity across queries

---

## 🔐 Security & Environment Design

- All credentials stored in Railway environment variables
- No hardcoded secrets
- CORS enabled (recommended: restrict to Geotab + Vercel domains)
- Session credentials never exposed to frontend directly

---

## 🔄 Backend Data Flow

1. Authenticate with Geotab (federation-aware)
2. Retrieve 30-day telemetry dataset
3. Calculate 24h vs baseline delta
4. Generate executive summary via Gemini
5. For deep queries → route through Geotab Ace
6. Return structured + AI-enriched response to frontend

---

## 🧠 Architectural Pattern Summary

GoInsights backend implements a **Hybrid Fleet Intelligence Model**:

- 📊 Deterministic telemetry (Geotab API)
- 📈 Statistical benchmarking (24h vs 30d)
- ✨ Executive AI summarization (Gemini)
- 🔍 Deep conversational entity intelligence (Geotab Ace)
- 🔁 Persistent chat sessions (chatId threading)

This ensures:

- Mathematical accuracy  
- Executive readability  
- Context-aware AI responses  
- Federation-safe connectivity  
- Scalable production deployment  

---
