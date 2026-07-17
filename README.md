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
