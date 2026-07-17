# Resilynx — Demo Script (Architecture + Live Healing)

## Pre-flight
```powershell
pnpm dev          # start all services, wait ~10s for logs to settle
```
Open `http://localhost:3000`. Verify green "GRID MONITORING: ACTIVE" banner. Click the "Architecture" tab in the sidebar once to confirm it loads. Return to "Dashboard" tab before starting.

---

## Act 1 — The Problem & Architecture (0:00–2:00)

### 0:00 — Hook
> "Every day, critical infrastructure — power grids, supply chains, carbon registries — depends on data from thousands of incompatible APIs. When one of those APIs changes its schema, goes offline, or crashes, every downstream system breaks. Recovery today is manual: someone has to notice the outage, hunt for a backup, get API keys, and write new integration code. That takes hours. Meanwhile, the data stops flowing."

### 0:25 — What Resilynx is
> "Resilynx is an autonomous data-ingestion engine. It detects when a provider fails, finds a backup automatically, and patches its own configuration — all without a human touching a keyboard. Let me walk you through the architecture, then show it working live."

### 0:40 — Click "Architecture" in sidebar
> "Four layers make this work."

> **Point at Data Sources card (cyan):** "Layer one: data sources. We have four providers feeding live data right now. Open-Meteo for London weather, USGS for global earthquakes, the UK National Grid for carbon intensity, and a mock grid sensor that simulates a power grid feed. Each one returns a completely different data shape — flat JSON, nested GeoJSON, array-wrapped objects. Normally you'd write four different parsers."

> **Point at Standardization Engine card (teal):** "Layer two: the Nexla standardization engine. This is a Python FastAPI service that takes any raw payload and maps it into one unified record — what we call a NexsetRecord. It uses a dollar-sign prefix path resolver that extracts values from nested paths. So 'current.temperature_2m' from Open-Meteo and 'features[0].properties.mag' from USGS both become the same clean format. The Nexla cloud SDK validates these schemas at startup."

> **Point at Healing Orchestrator card (purple):** "Layer three: the healing orchestrator. This is where the autonomy lives. A health monitor tracks every provider. Three consecutive failures trigger the healer. The healer reads the error log, searches Zero.xyz for a backup API of the same data type, and patches the provider registry file. That's the only file the agent can edit — it can't touch source code. Zero.xyz handles API discovery and payment automatically — no API key setup, no credential provisioning."

> **Point at Persistence & Broadcast card (amber):** "Layer four: persistence and delivery. All readings are stored in SQLite using Bun's built-in database. Every state change — stable, degraded, healing, restored — is broadcast over WebSocket to this dashboard in real time."

### 1:45 — Click "Dashboard" in sidebar to return
> "That's the architecture. Now let me show you what happens when a provider actually fails."

---

## Act 2 — The Live Healing Demo (2:00–3:30)

### 2:00 — Set the scene
> **Point at impact banner:** "Right now, the grid monitoring is active. 50,000 simulated households are receiving real-time frequency data from the mock grid sensor. The green dot means healthy. Every arrow you see is data flowing."

> **Point at the four provider cards:** "Open-Meteo, USGS, UK Carbon, Mock Grid — all green. All ingesting."

### 2:10 — Click Kill Mock
> **Click "Kill Mock" button in header**

> "I just killed the mock grid sensor. Its endpoint now returns 503 — service unavailable. No human knows this happened yet."

### 2:15 — Watch the failure cascade
> **Point at Mock Grid card — it should turn amber then red:** "Within seconds, the ingestion engine tried to poll and got a 503. Then again. Then a third time. The health monitor has a three-failure debounce to prevent false alarms."

> **Point at impact banner — it's turning red:** "GRID MONITORING: OFFLINE. 50,000 households at risk. But look — the healing orchestrator is already awake."

### 2:30 — Watch the healing in the Events panel
> **Click "Events" button in header to open the right panel if not already visible**

> **Scroll to the latest events:** "Every step the agent takes is broadcast in real time. analysing — it's reading the error log. reading-registry — it's checking the current provider configuration. discovering-backup — this is where it searches Zero.xyz for a replacement API. patching-registry — it just wrote a new provider entry to the config file."

> **Point at the agent state in the banner:** "You can see the current agent state live: discovering-backup."

### 2:55 — Recovery
> **Point at the impact banner turning green:** "GRID MONITORING: RESTORED. Service restored in — what's the timer say? — roughly six seconds. 50,000 households back online. Zero human intervention."

> "The provider registry hot-reloaded automatically. The ingestion engine picked up the new backup provider and started polling it. Data is flowing again."

### 3:10 — Show what the agent wrote
> "If I open the config file — `config/providers.json` — you'd see a new entry the agent wrote. Endpoint, auth mode set to zeroxyz for Zero.xyz-proxied access, field mapping cloned from the failed provider. Priority set one below the failed provider so the next poll cycle picks it up immediately."

### 3:25 — Revive to reset
> **Click "Revive" button:** "I can bring the original provider back. The backup stays in the registry — it's a permanent part of the system now."

---

## Act 3 — The Takeaway (3:30–5:00)

### 3:30 — What just happened
> "Let me recap what you just saw. I killed a provider. The health monitor detected it in three poll cycles. The healing orchestrator woke up, analyzed the failure, searched Zero.xyz for a backup API — a real, paid API that costs eight cents per call — discovered one, and patched the live configuration. The registry hot-reloaded. Data flow resumed. Total time: under ten seconds. Nobody got paged. Nobody wrote code."

### 3:50 — Why the architecture matters
> **Click "Architecture" in sidebar:** "This works because every layer has a narrow, well-defined interface. The provider registry is just a JSON file — add an entry, you've onboarded a source. The standardization engine maps any payload shape to one schema — no per-provider code. The healer only edits the registry file — it can't break the running system. And every state transition is broadcast so you can see exactly what the agent is doing."

### 4:15 — The tech stack
> "Under the hood: Bun and TypeScript for the backend — fast startup, native SQLite, built-in WebSocket server. Python and FastAPI for the Nexla standardization service with dot-path resolution. Zero.xyz's CLI for API discovery and payment — no per-service signup needed. Nexla's cloud SDK for schema validation. Next.js and React for the dashboard. The whole thing is a Turborepo monorepo — one `pnpm dev` starts everything."

### 4:35 — Real integrations, not mocks
> "Zero.xyz is real — the CLI is installed, authenticated, and searching live. Nexla is real — the SDK is connected to dataops.nexla.io and validates schemas at startup. The three real APIs — Open-Meteo, USGS, UK Carbon — are all keyless, public endpoints. Clone the repo, run one command, and you have a live self-healing data pipeline."

### 4:50 — Close
> "Resilynx takes what today requires an on-call engineer with API documentation and turns it into infrastructure that heals itself. The operator watches. The agent acts. Data keeps flowing. That's the product."

> "Questions?"

---

## Quick Reference Card

| What to show | Where | What to say |
|---|---|---|
| Hook | Opening | "Thousands of incompatible APIs. Recovery takes hours." |
| Architecture layers | Sidebar → Architecture | Walk through Data Sources → Standardization → Healing → Persistence |
| Dashboard | Sidebar → Dashboard | "Four providers, one unified data stream" |
| Kill Mock | Header button | Click it — "I just killed the grid sensor" |
| Red banner | Top of dashboard | "50,000 households at risk" |
| Agent states | Events panel + banner | "analysing → reading-registry → discovering-backup → patching-registry" |
| Green banner | Top of dashboard | "Restored in ~6 seconds. Zero human intervention." |
| What the agent wrote | Explain verbally | "New entry in providers.json with zeroxyz auth" |
| Tech stack | Closing | "Bun/TS, Python/FastAPI, Zero.xyz CLI, Nexla SDK, Next.js" |
| Real integrations | Closing | "Zero.xyz is live. Nexla is connected. APIs are real." |

## Troubleshooting

| Issue | Fix |
|---|---|
| Backend not responding | `pnpm dev` must be running, check port 8080 |
| Mock kill takes too long | Each provider polls every 15s, 3 failures = 45s max |
| Zero.xyz doesn't find backup | Static `backups.json` fallback works — same visual result |
| Impact banner not updating | Refresh, check WebSocket Connected indicator in header |
| Nexla connection failed | Check `.env` has correct `NEXLA_API_URL` and `NEXLA_TOKEN` |
| Build errors | `rm -rf apps/frontend/.next .turbo && pnpm build` |
