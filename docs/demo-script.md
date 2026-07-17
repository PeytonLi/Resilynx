# Resilynx — 3-Minute Demo Script

## Pre-flight (before audience arrives)
```powershell
pnpm dev          # start all services, wait ~10s
```
Open browser tabs:
- `http://localhost:3000` — the dashboard
- `http://localhost:8080/providers` — API reference (optional)

Verify the dashboard shows green "GRID MONITORING: ACTIVE" banner and "50,000 households protected."

---

## Minute 1 — The Problem (0:00–1:00)

### 0:00 — Hook
> "Every day, 50,000 households rely on real-time grid data to keep their power stable. That data comes from thousands of incompatible APIs. When one fails — and they fail constantly — somebody has to notice, diagnose, find a backup, and write new code. That takes hours. In those hours, people lose power monitoring."

### 0:15 — Show the dashboard
> **Point at the impact banner:** "This is what those 50,000 households see right now: GRID MONITORING ACTIVE. All systems operational."

> **Point at provider cards:** "Four data sources feed this system. Open-Meteo for weather, USGS for earthquakes, UK National Grid for carbon intensity, and this one — Mock Grid Sensor — simulating a live power grid feed. Each has a completely different data format. But Resilynx standardizes them all into one clean record."

### 0:40 — Show live data flowing
> **Point at the animated arrows:** "Watch — data flows from each provider through the Nexla standardization engine into the database. Every second, real readings are ingested and stored."

### 0:55 — Tease the failure
> "Let me show you what happens when the grid sensor goes down."

---

## Minute 2 — The Failure & Recovery (1:00–2:30)

### 1:00 — Click Kill Mock
> **Click "Kill Mock" button** — wait for the banner to turn red

> "I just killed the mock grid sensor. No human noticed — but within seconds, Resilynx's health monitor detected three consecutive failures."

> **Point at the red banner:** "GRID MONITORING: OFFLINE. 50,000 households at risk. But watch — the healing orchestrator is already waking up."

### 1:15 — Watch the healing
> **Point at the healing orchestrator card (purple section):** "The health monitor triggered the healer. The agent is now: analyzing the error log, reading the current provider registry, and — this is the key — searching Zero.xyz for a backup API."

> **Point at Events panel (right side):** "Every step is visible in real time. Look — agent: analysing → agent: reading-registry → agent: discovering-backup. Zero.xyz just returned a real backup provider: GridPulse, an actual power grid API. Cost: 8 cents per call."

> **Point at the agent state in the banner:** "You can see the agent's current state right here: discovering-backup."

### 1:50 — Show recovery
> "And there — the agent patched the live provider registry. No restart needed. The registry hot-reloaded automatically."

> **Point at the green banner:** "GRID MONITORING: RESTORED. Service restored in — what does it say? — 6.2 seconds. 50,000 households back online. Zero human intervention."

> "The entire loop: detect, diagnose, discover a backup, patch the config, restore data flow. Six seconds. The normal person never knew anything happened."

### 2:15 — Show the backup in Architecture view
> **Click "Architecture" in sidebar**

> "The architecture view shows every component. Data sources, the Nexla standardization engine, the healing orchestrator with Zero.xyz integration, and the persistence layer. The backup provider the agent discovered is now a permanent part of the registry."

---

## Minute 3 — The Takeaway (2:30–3:00)

### 2:30 — The narrative
> "This isn't a demo of a monitoring dashboard. It's a demo of infrastructure that **fixes itself.** No pager, no on-call engineer, no manual API key setup. Just detection, discovery, and repair — autonomously."

### 2:40 — The tech stack
> "Under the hood: Bun and TypeScript for the ingestion engine, Python and FastAPI for the Nexla standardization service, Zero.xyz's CLI for API discovery with automatic payment, Nexla's cloud SDK for schema validation, and Next.js for the frontend. All open-source. All keyless to set up. One command to start."

### 2:50 — The bigger picture
> "Right now it's four providers. But the architecture scales to thousands. Every new provider is just a JSON entry — endpoint, auth mode, field mapping. When one fails, Resilynx finds another. That's the product."

### 2:55 — Close
> "Self-healing data infrastructure. Questions?"

---

## Quick Reference Card

| What to show | Where to point | What to say |
|---|---|---|
| Impact banner (green) | Top of dashboard | "50,000 households protected" |
| Kill Mock button | Top-right header | Click it — "I just killed the grid sensor" |
| Impact banner (red) | Top of dashboard | "50,000 households at risk" |
| Agent state in banner | Mid-banner | "Agent: discovering-backup" |
| Events panel | Right side | "Every step is visible in real time" |
| Impact banner (green) | Top of dashboard | "Restored in 6.2 seconds" |
| Architecture view | Sidebar → Architecture | "Four layers, fully autonomous" |

## Troubleshooting

| Issue | Fix |
|---|---|
| Backend not responding | Check `pnpm dev` is running, port 8080 |
| Mock kill doesn't trigger | Wait 45s (3 polls × 15s interval) |
| Zero.xyz not finding backup | Static `backups.json` fallback kicks in — still works |
| Impact banner not updating | Refresh page, check WebSocket connected |
| Build errors | `rm -rf apps/frontend/.next .turbo && pnpm build` |
