# Resilynx — Demo Script

## Pre-flight
```powershell
pnpm dev          # start all services, wait ~10s
```
Open `http://localhost:3000`. Verify green "GRID MONITORING: ACTIVE" banner. Confirm Architecture tab loads. Return to Dashboard.

---

## Opening

Most data pipelines depend on third-party APIs. When a provider changes its schema, goes offline, or returns errors, downstream systems break. The standard recovery path — notice the outage, find a backup, get credentials, write integration code — takes hours.

Resilynx automates that entire loop. It detects provider failures, discovers replacement APIs, patches its own configuration, and resumes data flow. Let me walk through how it's built, then show it working.

---

## Architecture

*Click Architecture tab*

Four layers.

**Data sources.** Four providers feed live data: Open-Meteo for London weather, USGS for global earthquakes, UK National Grid for carbon intensity, and a mock grid sensor. Each returns a different response shape — flat JSON, GeoJSON features array, array-wrapped objects. No two look alike, which is the point.

**Standardization engine.** A Python FastAPI service that maps any raw payload into a single unified record using a dollar-sign prefix path resolver. The path `$current.temperature_2m` extracts a nested value from Open-Meteo. `$features[0].properties.mag` does the same from USGS GeoJSON. The Nexla cloud SDK validates these field mappings at startup so malformed configs are caught early.

**Healing orchestrator.** A health monitor counts consecutive polling failures per provider. After three, it triggers the healer. The healer reads the error log, searches Zero.xyz for a backup API matching the failed provider's data type, and writes a new entry to the provider registry file. That file is the agent's only write surface — it cannot modify source code. Zero.xyz handles API discovery and per-call payment without per-service signup.

**Persistence and broadcast.** All standardized readings go to a local SQLite database. Every state transition — stable, degraded, healing, restored — is published over WebSocket to the dashboard in real time.

---

## Live Demo

*Click Dashboard*

The four providers are polling live. Each card shows the provider's endpoint, last reading value, and unit. The animated dots between columns show data moving from provider through the Nexla core to the database.

At the top, the impact banner shows what an everyday person would see. Right now, 50,000 simulated households rely on this grid frequency data for power stability monitoring. The banner reads: GRID MONITORING ACTIVE. All households are covered.

*Click Kill Mock*

The mock grid sensor now returns 503. Nothing else is affected — the other three providers continue ingesting normally.

The health monitor counts three consecutive failures and declares the provider degraded. The banner flips to red: GRID MONITORING OFFLINE. 50,000 households at risk. This is what the normal person sees — their monitoring just went blind.

*Open Events panel*

The healer fires a sequence of lifecycle events: analysing the error log, reading the current registry, discovering a backup via Zero.xyz, patching the config file. Each step is timestamped and visible here.

The Zero.xyz search is a real CLI call — it queries for APIs matching the failed provider's metric type, filters to healthy GET endpoints, and selects the lowest-cost match. If Zero.xyz is unavailable, the healer falls back to a static backup registry file.

The backup entry is written to `config/providers.json`. The registry file is watched for changes — it hot-reloads without restarting the backend. The ingestion engine picks up the new provider on the next poll cycle.

The banner flips back to green: GRID MONITORING RESTORED. It shows the measured recovery time — typically under ten seconds — and confirms 50,000 households are back online. The normal person never knew anything happened.

*Click Revive*

The original provider comes back. The backup remains registered — it's a permanent part of the system.

---

## What Makes This Useful

**No per-provider code.** Adding a data source means adding a JSON entry: endpoint, auth mode, poll interval, field mapping. The standardization engine handles the rest.

**Safe automation.** The healer's edit surface is restricted to one config file. A bad patch fails validation and the registry keeps the last valid config. The agent cannot touch application code or other providers.

**Observability built in.** Every heal produces a structured event log. You can replay exactly what the agent did, when, and why. No black box.

**Keyless onboarding.** All three real APIs are public, no-credential endpoints. Zero.xyz covers authentication for discovered backups. Cloning the repo requires no API key setup.

**Real integrations.** Zero.xyz CLI is installed and authenticated. Nexla cloud SDK is connected and validates schemas at startup. These aren't mocks.

---

## Tech Stack

| Component | Runtime |
|---|---|
| Ingestion engine, health monitor, WebSocket server | Bun + TypeScript |
| Standardization service | Python + FastAPI |
| API discovery and payment | Zero.xyz CLI |
| Schema validation | Nexla SDK (dataops.nexla.io) |
| Dashboard | Next.js + React |
| Persistence | Bun SQLite |
| Monorepo | Turborepo + pnpm |

---

## Troubleshooting

| Issue | Fix |
|---|---|
| Backend not responding | Verify `pnpm dev` is running, port 8080 |
| Mock kill doesn't trigger | Max wait: 45s (3 polls × 15s) |
| Zero.xyz returns no results | Static `backups.json` fallback — same behavior |
| Banner not updating | Refresh page, check WebSocket Connected indicator |
| Build errors | `rm -rf apps/frontend/.next .turbo && pnpm build` |
