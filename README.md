# Resilynx

Self-healing data-ingestion engine with a live 3D visual sandbox.

Resilynx continuously ingests from disparate real-world APIs and standardizes their chaotic payloads into one unified schema. When a provider fails, it autonomously diagnoses the failure, discovers a backup provider via Zero.xyz, and patches the live provider registry — all while broadcasting every step to a 3D network graph you can watch in real time.

## Providers

Four data sources feed the engine, each with a deliberately incompatible response shape to prove standardization:

| Provider | Type | Endpoint |
|---|---|---|
| **Open-Meteo** | Real: London weather (temperature, humidity, wind) | `api.open-meteo.com` |
| **USGS Earthquake** | Real: global M2.5+ earthquakes (GeoJSON) | `earthquake.usgs.gov` |
| **UK Carbon Intensity** | Real: National Grid carbon intensity | `api.carbonintensity.org.uk` |
| **Mock Grid Sensor** | Killable mock: simulated grid frequency/voltage | `localhost:4001` |

All real providers are keyless — clone the repo and run, no credentials needed.

## Quick Start

```bash
pnpm install
pnpm dev
```

One command starts everything: Python venv → Nexla standardization service → Mock Grid Sensor → Backend → Frontend. Open **http://localhost:3000** to see the 3D network graph.

Press `Ctrl+C` to stop all services.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Frontend (Next.js + Three.js)  :3000            │
│  ├─ NetworkCanvas — 3D provider graph            │
│  └─ EventFeed — live agent thought-trail         │
└──────────────────┬──────────────────────────────┘
                   │ WebSocket (aegis-events)
┌──────────────────▼──────────────────────────────┐
│  Backend (Bun + TypeScript)  :8080               │
│  ├─ Provider Registry — watched config file      │
│  ├─ Ingestion Engine — polls providers           │
│  ├─ Health Monitor — N-fail debounce             │
│  ├─ Healing Orchestrator — Pi Agent SDK          │
│  └─ SQLite Store — readings + event history      │
└──────┬───────────────────────┬──────────────────┘
       │ POST /standardize     │ GET /data
┌──────▼──────────┐   ┌────────▼──────────────────┐
│  Nexla Service  │   │  Mock Grid Sensor  :4001   │
│  (Python/FastAPI)│   │  (Bun + TypeScript)       │
│  :5001           │   │  Kill/Revive switch       │
└─────────────────┘   └───────────────────────────┘
       ▲
       │ Real providers (Open-Meteo, USGS, UK Carbon)
```

## Nexla — Standardization Layer

### Problem

Data providers return wildly different shapes. Open-Meteo gives `{ current: { temperature_2m: 14.2, ... } }`. USGS returns GeoJSON `{ features: [{ properties: { mag: 4.7, ... } }] }`. The frontend and database expect one unified shape: `{ providerId, metric, value, unit, timestamp }`. Without a standardization layer, every consumer must write bespoke parsing for every provider — fragile, repetitive, and unscalable.

### Solution

A Python FastAPI service (`apps/nexla-service`, port 5001) exposes `POST /standardize`. The backend sends each raw provider payload with a **field mapping** that uses `$`-prefixed dot-path expressions:

```json
{
  "providerId": "open-meteo",
  "metric": "temperature",
  "rawPayload": { "current": { "temperature_2m": 14.2, "time": "2026-..." } },
  "fieldMapping": {
    "value": "$current.temperature_2m",
    "unit": "$current_units.temperature_2m",
    "timestamp": "$current.time"
  }
}
```

The service resolves `$current.temperature_2m` → `14.2` using a local dot-path resolver, validates types (value must be numeric, unit must be a string), and returns a `NexsetRecord`. **No Nexla Cloud API call happens at runtime** — the resolver is pure Python.

At startup the service uses the Nexla SDK (`nexla_client.py`) to validate that every field mapping path is structurally sound (checking against Nexla "rename" transform operations), but this is a one-time gate, not a per-request cost.

### Why it's useful

- **One shape, infinite providers.** Add a new provider by adding one entry to `config/providers.json` with a field mapping — no code changes.
- **Type safety at the boundary.** Non-numeric values, missing fields, and malformed mappings are caught and surfaced as structured errors before they reach the database.
- **Nexla SDK validation.** Provider field mappings are pre-validated against Nexla's transform model, catching configuration errors at startup rather than at runtime.
- **Decoupled from Nexla Cloud.** The standardization endpoint works fully offline — Nexla Cloud integration (`NexlaIngestionEngine` + `NexlaApiClient` in `apps/backend/src/nexla.ts`) exists as an alternative path for teams that want Nexla Cloud to handle polling and transformation, but is not required.

### Architecture

```
Provider payload (any shape)
  │
  ▼
IngestionEngine.poll()              apps/backend/src/ingestion.ts:63
  │  fetch(provider.endpoint) → raw JSON
  │  or zeroRunner.fetch() for zeroxyz providers
  ▼
POST :5001/standardize             apps/nexla-service/src/nexla_service/server.py:84
  │  { providerId, metric, rawPayload, fieldMapping }
  ▼
extract_value() dot-path resolver   apps/nexla-service/src/nexla_service/resolver.py
  │  "$current.temperature_2m" → 14.2
  │  type validation (numeric value, string unit)
  ▼
NexsetRecord emitted                { providerId, metric, value, unit, timestamp, raw }
  │
  ├─► Store.insertReading()         SQLite persistence
  ├─► HealthMonitor.recordSuccess() resets failure counter
  └─► WebSocket broadcast           frontend updates in real-time
```

## Zero.xyz — Backup Discovery & Live Data Fetching

### Problem

When a provider fails (3 consecutive poll errors), a human must manually find a replacement API, sign up for credentials, configure auth, and patch the registry. In production this means minutes to hours of downtime while data goes stale. Autonomous healing needs **zero-config backup discovery** — no human in the loop, no credential provisioning.

### Solution

The **ZeroHealerSession** (`packages/healer/src/agent.ts:242`) uses the `zero` CLI to automate the full backup lifecycle:

**Discovery (free):**
```
zero search "real-time power grid frequency data API" --json
  → filters to healthy GET endpoints
  → zero get <token> for endpoint details (URL, cost, schema)
  → cost check: if cost > $0.10/call → reject
  → constructs ProviderRegistryEntry with authMode:"zeroxyz"
```

**Fetching (costs money, per-call):**
```
zero fetch <endpoint> --json --max-pay 0.10
  → authenticated, metered API call through Zero.xyz proxy
  → returns body → POSTed to /standardize like any other provider
```

**Fallback:** If the `zero` CLI is unavailable (not installed, not authenticated, network error), the healer **falls back to static backups** in `config/backups.json` — a curated catalog organized by metric type (`grid_frequency`, `temperature`, `earthquake_magnitude`, `carbon_intensity`). This ensures healing never blocks on a single dependency.

### Spend Controls

| Control | Where | Default |
|---|---|---|
| `maxPerCallUsd` | `packages/healer/src/zero.ts:128` | `$0.10` (env: `ZERO_MAX_PER_CALL_USD`) |
| `ZERO_MAX_MONTHLY_USD` | `.env` (readiness only) | `$5` (not yet enforced in code) |

The `discover()` call only uses **free** Zero.xyz operations (`search` + `get`). The `fetch()` call passes `--max-pay` to cap per-call spending. Backup entries are created with `enabled: false` so they never auto-poll — the operator or healer explicitly enables them.

### Why it's useful

- **Zero credentials.** No API keys to provision, rotate, or store. Zero.xyz handles auth transparently.
- **Cost-gated.** Every backup discovery checks per-call cost against a configurable cap. Expensive APIs are rejected, cheap ones pass through.
- **Degrade gracefully.** If Zero.xyz is unreachable, `config/backups.json` provides a static fallback — healing continues.
- **Edit-surface safety.** The healer can only write to `config/providers.json`. It cannot modify source code, credentials, or infrastructure.

### Architecture

```
HealthMonitor detects 3 consecutive failures
  │  apps/backend/src/healthMonitor.ts:46
  ▼
Healer.heal(failure)                packages/healer/src/index.ts:118
  │  emits "healing" → WebSocket → frontend shows yellow node
  │  builds agent prompt with failure context
  ▼
ZeroHealerSession.run()             packages/healer/src/agent.ts:251
  │
  ├─ TRY: ZeroAgentRunner.discover(failed)
  │   ├─ zero search <query> --json            FREE
  │   ├─ zero get <token>                      FREE
  │   ├─ cost check ($0.08 ≤ $0.10 ✓)
  │   └─ returns ProviderRegistryEntry { authMode:"zeroxyz", enabled:false }
  │
  └─ CATCH: SmartHealerSession (fallback)
      ├─ reads config/backups.json by metric key
      └─ returns first matching static backup
  │
  ▼
Patches config/providers.json       backup.enabled = true, priority = failed+1
  │
  ▼
Registry.on("change") → ingestion.restart()
  │  new backup starts polling via ZeroAgentRunner.fetch()
  │  POST :5001/standardize → normalized readings resume
  ▼
Healer emits "restored" → WebSocket → frontend shows green backup node
```

| Service | Runtime | Port |
|---|---|---|
| Frontend | Next.js (React + Three.js) | 3000 |
| Backend | Bun + TypeScript | 8080 |
| Nexla Service | Python (FastAPI + Nexla ADK) | 5001 |
| Mock Grid Sensor | Bun + TypeScript | 4001 |

## Demo Script

1. Open **http://localhost:3000** — four green nodes appear, pulsing with live environmental data
2. Click **Kill Mock Grid** — the mock node turns red as the health monitor detects the outage
3. Watch the healing agent wake up, diagnose the failure, and route a new backup node into the graph (yellow → green)
4. Click **Revive** to restore the original provider
5. The full kill → detect → heal → restore loop completes in seconds

## Project Structure

```
resilynx/
├── apps/
│   ├── backend/         # Ingestion engine, health monitor, healer, WebSocket
│   ├── frontend/        # Next.js + Three.js 3D sandbox
│   ├── mock-provider/   # Killable mock grid sensor
│   └── nexla-service/   # Python standardization service (Nexla ADK)
├── packages/
│   ├── contracts/       # Shared types, schemas, PORTS
│   └── healer/          # Healing orchestrator (Pi Agent SDK)
├── config/
│   └── providers.json   # Provider registry (healer's only edit surface)
├── docs/                # Implementation and audit plans
├── scripts/
│   └── dev.ps1          # One-command startup script
└── package.json         # Monorepo root (pnpm + turborepo)
```

## Testing

```bash
# Run all TypeScript tests
pnpm test

# Run all TypeScript + Python tests
pnpm test:all

# Individual suites
cd apps/backend && bun test
cd apps/mock-provider && bun test
cd packages/healer && bun test
cd apps/nexla-service && python -m pytest tests/ -v
```

Frontend 3D rendering is verified visually, not unit-tested (see [PRD.md](./PRD.md)).

## Healing Flow

1. **Health Monitor** detects N consecutive ingestion failures for a provider
2. **Healing Orchestrator** wakes a headless Pi Agent session
3. Agent receives the error log and current registry as context
4. Agent discovers a backup provider via Zero.xyz
5. Agent patches `config/providers.json` with the backup entry
6. Provider Registry hot-reloads, ingestion resumes
7. Every lifecycle event is broadcast over WebSocket to the 3D frontend

> **Agent edit surface**: the healing agent can only modify `config/providers.json`. It cannot touch source code — healing is registry-config-only in v1.
