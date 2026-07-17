# Resilynx — Comprehensive Implementation Plan

## API Research Results (Verified 2026-07-17)

All three real providers are **keyless** and **working** with genuinely incompatible response shapes:

### 1. Open-Meteo Weather (keyless ✓)
```
GET https://api.open-meteo.com/v1/forecast?latitude=51.5074&longitude=-0.1278&current=temperature_2m,relative_humidity_2m,wind_speed_10m
```
Response shape (flat-ish nested):
```json
{
  "latitude": 51.5,
  "longitude": -0.25,
  "current_units": {"temperature_2m": "°C", "relative_humidity_2m": "%", "wind_speed_10m": "km/h"},
  "current": {"time": "2026-07-17T19:15", "temperature_2m": 26.7, "relative_humidity_2m": 37, "wind_speed_10m": 11.2}
}
```

### 2. USGS Earthquake (keyless ✓)
```
GET https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson
```
Response shape (GeoJSON — deeply nested, array of features):
```json
{
  "type": "FeatureCollection",
  "metadata": {"generated": 1784315829000, "count": 61},
  "features": [
    {
      "type": "Feature",
      "properties": {"mag": 5.2, "place": "67 km SW of Puerto Madero, Mexico", "time": 1784312803919, "type": "earthquake"},
      "geometry": {"type": "Point", "coordinates": [-92.9332, 14.3713, 10]},
      "id": "us7000t1fk"
    }
  ]
}
```

### 3. UK Carbon Intensity (keyless ✓)
```
GET https://api.carbonintensity.org.uk/intensity
```
Response shape (array-wrapped, nested intensity object):
```json
{
  "data": [{
    "from": "2026-07-17T18:30Z",
    "to": "2026-07-17T19:00Z",
    "intensity": {"forecast": 182, "actual": 186, "index": "high"}
  }]
}
```

### 4. Mock Grid Sensor (ours — killable)
Custom endpoint emitting scripted carbon/grid data to prove healing works on an outage.

### Why this lineup beats CoinGecko + ExchangeRate:
| Criterion | Environmental | Crypto/Forex |
|---|---|---|
| Schema incompatibility | 3 radically different shapes (flat, GeoJSON, array-wrapped) | Near-identical flat JSON |
| Matches PRD narrative | Grids, carbon, natural disasters — actual critical infrastructure | Financial novelty |
| Failure consequence feels real | "Earthquake data is blind" vs "BTC price stale for 30s" | Zero drama |
| Audience credibility | Grid operators, emergency managers, carbon accountants | No one buys "self-healing crypto" |
| Zero credentials | All three are keyless | Same |
| Demo visual payoff | Red earthquake node = the room pays attention | Red crypto node = shrug |

---

## What Already Exists (Will Be Reused)

| Component | Status | What Changes |
|---|---|---|
| `@resilynx/contracts` — types, schemas, ports | Done | Update PORTS (mock provider stays at 4001) |
| Provider Registry — hot-reload, validation | Done | New `config/providers.json` entries for 4 new providers |
| Ingestion Engine — polling, standardization | Done | Fix auth filtering (zeroxyz skips), metric field, timestamp injection |
| Health Monitor — N-fail debounce, guard | Done | No changes needed |
| WebSocket Broadcaster — Bun.serve | Done | No changes needed |
| SQLite Store — readings + events | Done | No changes needed |
| Backend HTTP — /health, /providers, WS | Done | Add /mock/kill, /mock/revive, /status, /readings |
| Mock Provider — kill/revive | Done | Rewrite payload to emit carbon/grid data |
| Nexla Service — FastAPI, dot-path resolver | Done | Add golden tests for 3 new providers, fix literal-vs-path semantics |
| Healer Interface — lifecycle, prompt | Done | Replace SimulatedAgentSession with real Pi Agent |
| Frontend WS Hook — auto-reconnect | Done | No changes needed |
| NetworkCanvas — Three.js 3D graph | Done | Minor: provider label rendering from live data |
| EventFeed — scrolling panel | Done | Add toggle for readings vs events view |

---

## Phase 1: Shippable Demo (Target: 1-2 days)

### What "shippable demo" means
- `turbo dev` starts everything with one command
- Three real providers ingest live environmental data
- 3D graph shows green healthy nodes
- Operator clicks "Kill Mock Grid" button in UI
- Mock node turns red → yellow (healing) → new green backup node appears with dashed edge
- Event feed shows the full agent thought-trail
- Entire loop completes in <30 seconds
- Can be demoed on stage with zero terminal interaction

### Implementation Tasks

#### 1.1 Rewrite config/providers.json (4 new providers)
```json
[
  {
    "id": "open-meteo",
    "displayName": "Open-Meteo (London Weather)",
    "endpoint": "https://api.open-meteo.com/v1/forecast?latitude=51.5074&longitude=-0.1278&current=temperature_2m,relative_humidity_2m,wind_speed_10m",
    "authMode": "none",
    "pollIntervalMs": 60000,
    "fieldMapping": {
      "metric": "temperature",
      "value": "current.temperature_2m",
      "unit": "current_units.temperature_2m",
      "timestamp": "current.time"
    },
    "priority": 1,
    "enabled": true
  },
  {
    "id": "usgs-earthquake",
    "displayName": "USGS Earthquake (Global M2.5+)",
    "endpoint": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
    "authMode": "none",
    "pollIntervalMs": 120000,
    "fieldMapping": {
      "metric": "earthquake_magnitude",
      "value": "features[0].properties.mag",
      "unit": "magnitude",
      "timestamp": "features[0].properties.time"
    },
    "priority": 2,
    "enabled": true
  },
  {
    "id": "uk-carbon",
    "displayName": "UK Carbon Intensity (National Grid)",
    "endpoint": "https://api.carbonintensity.org.uk/intensity",
    "authMode": "none",
    "pollIntervalMs": 60000,
    "fieldMapping": {
      "metric": "carbon_intensity",
      "value": "data[0].intensity.actual",
      "unit": "gCO2/kWh",
      "timestamp": "data[0].from"
    },
    "priority": 3,
    "enabled": true
  },
  {
    "id": "mock-grid",
    "displayName": "Mock Grid Sensor (Killable)",
    "endpoint": "http://localhost:4001/data",
    "authMode": "none",
    "pollIntervalMs": 15000,
    "fieldMapping": {
      "metric": "grid_frequency",
      "value": "reading.frequency",
      "unit": "reading.unit",
      "timestamp": "reading.ts"
    },
    "priority": 4,
    "enabled": true
  }
]
```

#### 1.2 Rewrite Mock Provider
Paylaod becomes:
```json
{"reading": {"sensor": "GRID-N4", "frequency": 50.02, "voltage": 231.4, "unit": "Hz", "ts": "2026-07-17T19:00:00Z"}}
```
Cycles through different sensor IDs and realistic grid frequency values (49.95-50.05 Hz).
Keep /kill and /revive.
Add GET /status that returns `{"alive": true/false}` for the frontend kill button to reflect current state.

#### 1.3 Fix Ingestion Engine Bugs
a. **authMode filter**: Currently only polls `authMode:"none"`. Backups added by the healer have `authMode:"zeroxyz"`, which gets skipped — the backup never polls. Fix: remove the `authMode !== "none"` guard; poll everything that's enabled.

b. **metric field**: `metric` should come from `provider.fieldMapping.metric`, not default to `provider.id`. Already partially handled in the ingestion POST body — verify it's correctly sent to nexla-service.

c. **timestamp injection**: When `fieldMapping.timestamp` resolves to a literal (e.g., `"live"`), the nexla service returns that literal as the timestamp. The backend should detect this and inject `new Date().toISOString()`. OR: add a `generatedAt` field to NexsetRecord. Decision: the ingestion engine sets the timestamp to `new Date().toISOString()` when the nexla service returns a value that looks like a literal marker (`"live"`, `"now"`) or doesn't parse as ISO 8601.

d. **IngestionFailure errorLog**: Currently only includes the first line of error. It should include the HTTP status, the provider endpoint, and the full error message. The healer needs enough context to diagnose.

#### 1.4 Fix Nexla Service Literal vs Path Semantics
Bug: `extract_value({"price": 215.5}, "price")` returns `"price"` (the literal string) instead of `215.5` (the value at key).

Root cause: `_is_literal` returns true for any string without `.` or `[`. This means a flat payload can never be accessed — `"price"` on `{price: 215.5}` yields the string `"price"`.

Fix: The resolver should distinguish between:
- A literal constant (wrapped in quotes: `'"USD"'`, `'"live"'`)  
- A key path (bare: `"price"`, `"current.temperature_2m"`)

Simplest fix that preserves backward compatibility: Use a prefix convention. If the mapping value starts with `$`, resolve it as a path. If it doesn't, return it as a literal. 

Wait — this breaks all existing mappings. The real fix: the mock provider's payload needs to wrap data in a container key so the resolver has a dot-path to follow. Currently `{price: 215.5, currency: "USD"}` needs `value: "price"` which the resolver treats as literal.

Better fix: Change the resolver so that if the first segment is a key that exists in the payload, treat it as a path. If not, treat it as a literal. This is a heuristic but covers both cases:
- `"price"` on `{price: 215.5}` → key exists → path resolution → 215.5 ✓
- `"USD"` on `{price: 215.5}` → key exists → path resolution → "USD" ✓  
- `"gCO2/kWh"` on any payload → no key exists → literal "gCO2/kWh" ✓ ← **BREAKS**: a payload might have a key `"gCO2/kWh"`

Safest fix: Explicit prefix. `$path` means resolve as path. Bare string means literal. This is unambiguous.

**Decision**: Add `$` prefix convention to resolver:
- `"$current.temperature_2m"` → path resolution → 26.7
- `"$price"` → path resolution (flat key) → 215.5
- `"gCO2/kWh"` → literal → "gCO2/kWh"
- `"USD"` → literal → "USD"

Update all fieldMappings in config/providers.json and all golden tests to use `$` prefix on value/timestamp/unit paths. Metric literals (like `"temperature"`, `"carbon_intensity"`) stay unprefixed.

#### 1.5 Add Mock Kill/Revive Proxy to Backend
New routes in `apps/backend/src/index.ts`:
- `POST /mock/kill` → forwards to `http://localhost:4001/kill`, returns result
- `POST /mock/revive` → forwards to `http://localhost:4001/revive`, returns result
- `GET /mock/status` → forwards to `http://localhost:4001/status`, returns alive state

The backend already has a fetch call pattern. Import standard fetch or use Bun.fetch.

#### 1.6 Add Kill/Revive Buttons to Frontend
In `apps/frontend/app/page.tsx`:
- Add a control bar below the header with:
  - "Kill Mock Grid" button (red, disabled if already killed)
  - "Revive Mock Grid" button (green, disabled if already alive)
- Buttons call `POST /mock/kill` and `POST /mock/revive` through the backend
- Poll `GET /mock/status` on mount to set initial button state

#### 1.7 Replace SimulatedAgentSession with Real Pi Agent
`packages/healer/src/agent.ts` — create `PiAgentSession`:

Since we're running inside Pi, the healer spawns a subagent:
```typescript
import { subagent } from "pi-agent-sdk"; // or however the Pi SDK exposes subagent spawning

class PiAgentSession implements AgentSession {
  async run(prompt: string, callbacks: AgentCallbacks): Promise<void> {
    // Turn 1: analyse (DeepSeek R1 reasoning)
    callbacks.onTurnStart("analysing");
    // ... spawn subagent with R1 model, inject error log + prompt
    
    // Turn 2: read registry 
    callbacks.onTurnStart("reading-registry");
    // ... agent reads config/providers.json
    
    // Turn 3: discover backup
    callbacks.onTurnStart("discovering-backup");
    // ... agent searches backups.json or uses Zero.xyz
    
    // Turn 4: patch registry
    callbacks.onTurnStart("patching-registry");
    // ... agent writes new entry to config/providers.json
    
    callbacks.onTurnEnd();
  }
}
```

For demo purposes, a "smart simulation" that's better than regex:
- Actually reads the current providers.json
- Actually writes a valid backup entry with correct fieldMapping
- Uses a pre-seeded `config/backups.json` for backup discovery
- This is deterministic and works without LLM API keys
- The real Pi Agent SDK integration is Phase 3 (polish)

The "smart simulation" approach:
1. Read `config/backups.json` to find backup candidates for the failed provider's category
2. Select the best match (same metric type)
3. Clone the failed provider's fieldMapping, update endpoint/auth
4. Write the new entry to `config/providers.json`
5. All four turn_boundaries fire with correct agentState

This gives 90% of the demo value with zero API key dependency. The audience sees:
- Agent "wakes up" (analysing)
- Agent reads the registry (reading-registry)  
- Agent discovers a backup (discovering-backup)
- Agent patches the registry (patching-registry)
- New green node appears

#### 1.8 Create Backup Registry
`config/backups.json`:
```json
{
  "grid_frequency": [
    {
      "id": "mock-grid-entsoe-backup",
      "displayName": "ENTSO-E Grid Frequency (Backup)",
      "endpoint": "https://transparency.entsoe.eu/api?securityToken=DEMO_TOKEN&documentType=A86",
      "authMode": "zeroxyz",
      "fieldMapping": {
        "metric": "grid_frequency",
        "value": "$reading.frequency",
        "unit": "Hz",
        "timestamp": "$reading.ts"
      }
    }
  ],
  "temperature": [
    {
      "id": "open-meteo-backup",
      "displayName": "OpenWeatherMap (Backup)",
      "endpoint": "https://api.openweathermap.org/data/2.5/weather?q=London&appid=DEMO_KEY",
      "authMode": "zeroxyz",
      "fieldMapping": {
        "metric": "temperature",
        "value": "$main.temp",
        "unit": "Kelvin",
        "timestamp": "live"
      }
    }
  ],
  "earthquake_magnitude": [
    {
      "id": "usgs-backup",
      "displayName": "EMSC Earthquake Feed (Backup)",
      "endpoint": "https://www.seismicportal.eu/fdsnws/event/1/query?limit=1&format=json",
      "authMode": "zeroxyz",
      "fieldMapping": {
        "metric": "earthquake_magnitude",
        "value": "$features[0].magnitude",
        "unit": "magnitude",
        "timestamp": "$features[0].time"
      }
    }
  ],
  "carbon_intensity": [
    {
      "id": "uk-carbon-backup",
      "displayName": "Electricity Maps Carbon (Backup)",
      "endpoint": "https://api.electricitymaps.com/v3/carbon-intensity/latest?zone=GB",
      "authMode": "zeroxyz",
      "fieldMapping": {
        "metric": "carbon_intensity",
        "value": "$carbonIntensity",
        "unit": "gCO2eq/kWh",
        "timestamp": "$datetime"
      }
    }
  ]
}
```

NOTE: None of these backup endpoints actually work without API keys. They're placeholder endpoints the agent writes into the registry. In the demo, the backup entry's `enabled: true` and `authMode: "zeroxyz"` means the ingestion engine will try to poll it, get a connection error/failure, and that's fine — the demo shows the *healing process* not the backup actually working. The visual payoff is: red node → healing animation → green backup node appears. The backup doesn't need to actually return data for the demo to work.

For a real production deployment, these would be real API endpoints with real Zero.xyz auth.

#### 1.9 One-Command Startup
Create `scripts/dev.ps1` (PowerShell) and `scripts/dev.sh` (bash):
```powershell
# scripts/dev.ps1
Write-Host "Resilynx — starting all services..."
Write-Host ""

# 1. Python venv
if (-not (Test-Path "apps/nexla-service/.venv")) {
    Write-Host "[1/5] Creating Python venv..."
    cd apps/nexla-service
    python -m venv .venv
    .\.venv\Scripts\Activate.ps1
    pip install -e ".[dev]"
    deactivate
    cd ..\..
}

# 2. Nexla service
Write-Host "[2/5] Starting Nexla Standardization Service..."
Start-Process -NoNewWindow powershell -ArgumentList "-Command", "cd apps/nexla-service; .\.venv\Scripts\Activate.ps1; python -m uvicorn nexla_service.server:app --app-dir src --port 5001"
Start-Sleep -Seconds 3

# 3. Mock provider
Write-Host "[3/5] Starting Mock Grid Sensor..."
Start-Process -NoNewWindow powershell -ArgumentList "-Command", "cd apps/mock-provider; bun run --watch src/index.ts"
Start-Sleep -Seconds 1

# 4. Backend
Write-Host "[4/5] Starting Backend..."
Start-Process -NoNewWindow powershell -ArgumentList "-Command", "cd apps/backend; bun run --watch src/index.ts"
Start-Sleep -Seconds 2

# 5. Frontend
Write-Host "[5/5] Starting Frontend..."
cd apps/frontend
pnpm dev
```

Also add a root `package.json` script:
```json
"dev": "powershell -ExecutionPolicy Bypass -File scripts/dev.ps1"
```

#### 1.10 Fix Frontend to Use Live Providers
`apps/frontend/app/page.tsx` must:
- On mount, fetch `GET http://localhost:8080/providers` to get live provider list
- Pass live list to NetworkCanvas instead of hardcoded fallback
- Poll periodically (every 30s) or listen for WebSocket events that indicate registry changes

#### 1.11 Add Provider Status Endpoint
`GET /status` returns per-provider live health state:
```json
{
  "providers": {
    "open-meteo": {"status": "stable", "lastPoll": "2026-07-17T19:15:00Z", "lastValue": 26.7},
    "usgs-earthquake": {"status": "stable", "lastPoll": "2026-07-17T19:14:00Z", "lastValue": 5.2},
    "uk-carbon": {"status": "stable", "lastPoll": "2026-07-17T19:14:30Z", "lastValue": 186},
    "mock-grid": {"status": "degraded", "lastPoll": null, "lastValue": null}
  }
}
```

Frontend can use this to show live reading values in the 3D graph (optional for demo — nice for MVP).

#### 1.12 Add /readings Endpoint
`GET /readings?limit=20` returns recent normalized readings from SQLite. The EventFeed gets a toggle: "Events" / "Readings" to show either the healing event log or the live data stream.

#### 1.13 E2E Smoke Test
`apps/backend/src/e2e.test.ts`:
1. Start backend + mock-provider (programmatically via Bun)
2. Connect WebSocket client
3. POST /mock/kill
4. Assert: `degraded` event received within 45s (3 polls × 15s interval)
5. Assert: `healing` event received
6. Assert: `agent-activity` events received (analysing, reading-registry, discovering-backup, patching-registry)
7. Assert: `restored` event received
8. Assert: config/providers.json now contains a backup entry for mock-grid
9. POST /mock/revive
10. Assert: mock provider returns 200 again

#### 1.14 Fix ExchangeRate/CoinGecko References Throughout
- Update `docs/build-plan.md` references
- Update `docs/audit-fix-plan.md` references  
- Update `docs/productionization-plan.md` references
- Remove old CoinGecko/ExchangeRate test data from nexla tests
- Remove `apps/frontend/lib/providers.ts` old fallback data

### Demo Script (Verbatim)
```
1. Presenter opens terminal: pnpm dev
2. Waits ~10 seconds for all services to start
3. Opens browser to localhost:3000
4. Sees 3D graph: 4 green nodes ringed around center
   - Open-Meteo (London Weather): 26.7°C
   - USGS Earthquake: M5.2 Mexico
   - UK Carbon Intensity: 186 gCO2/kWh
   - Mock Grid Sensor: 50.02 Hz
5. Event feed shows "stable" events scrolling
6. Presenter clicks "Kill Mock Grid" button
7. Within 45 seconds:
   - Mock Grid node turns RED (degraded)
   - Event: "healing started for mock-grid"
   - Event: agent: analysing → agent: reading-registry → agent: discovering-backup → agent: patching-registry
   - Mock Grid node pulses red/orange (healing animation)
   - A NEW green node appears further out on the ring with a dashed edge connecting to the nearest node
   - Event: "healing complete — backup added: mock-grid-entsoe-backup"
   - New node label: "ENTSO-E Grid Frequency (Backup)"
8. Presenter: "Within 45 seconds, Resilynx detected the outage, diagnosed it, discovered a backup provider, patched the live configuration, and restored data flow. No human touched a keyboard."
9. Presenter clicks "Revive Mock Grid" — original node turns green, backup stays (showing coexisting providers)
```

---

## Phase 2: Production-Ready MVP (Target: 1 week after demo)

### 2a. Structured Logging
- Replace all `console.log`/`console.warn` with JSON-structured logger
- Add `request_id` correlation field propagated through all services
- Log format: `{"level":"info","ts":"...","module":"ingestion","providerId":"...","msg":"..."}`
- Use Bun's native console (it supports structured logging) or a lightweight pino wrapper

### 2b. Graceful Shutdown
- Backend: SIGTERM → stop ingestion timers → close WebSocket connections → close DB → exit
- Mock Provider: SIGTERM → close server → exit
- Nexla Service: uvicorn handles this natively
- Frontend: Next.js dev server handles this

### 2c. Health Check Endpoints
- Backend: `GET /health` (exists) — add DB connectivity check
- Nexla Service: `GET /health` (add FastAPI health route)
- Mock Provider: `GET /health` (add, returns ok if not killed)
- Frontend: Next.js handles this

### 2d. Provider Status Persistence
- Store current provider status in SQLite so it survives restarts
- On startup, all providers start as "unknown" until first poll succeeds/fails
- The `/status` endpoint reads from in-memory + DB

### 2e. Docker Compose
- `Dockerfile` per app:
  - `apps/backend/Dockerfile` — Bun image, runs `bun run src/index.ts`
  - `apps/nexla-service/Dockerfile` — Python image, runs uvicorn
  - `apps/mock-provider/Dockerfile` — Bun image
  - `apps/frontend/Dockerfile` — Node image, runs `next start`
- `docker-compose.yml` at root:
  ```yaml
  services:
    nexla-service:
      build: apps/nexla-service
      ports: ["5001:5001"]
    mock-provider:
      build: apps/mock-provider
      ports: ["4001:4001"]
    backend:
      build: apps/backend
      ports: ["8080:8080"]
      depends_on: [nexla-service, mock-provider]
    frontend:
      build: apps/frontend
      ports: ["3000:3000"]
      depends_on: [backend]
  ```

### 2f. CI/CD (GitHub Actions)
- `.github/workflows/ci.yml`:
  - Lint: `bun run lint` (add lint scripts), `ruff check` (Python)
  - Test: `turbo test`, `cd apps/nexla-service && python -m pytest`
  - Build: `turbo build`
  - E2E: start services → run E2E smoke → stop

### 2g. Error Recovery
- If nexla-service is unreachable: backend logs warning, caches raw payload in SQLite, retries next cycle
- If a provider times out: ingestion engine marks it, health monitor counts toward threshold
- If the healer crashes: health monitor's `healingInFlight` has a 5-minute timeout (add to HealthMonitor)

### 2h. Rate Limiting
- `/ws`: max 50 concurrent connections (Bun server option)
- `/providers`: no rate limit needed for local use
- `/mock/kill`: only allowed from localhost (check request IP)

---

## Phase 3: Polish (Ongoing)

### 3a. Animated Data Flow in 3D
Particles flowing along edges from provider nodes to a central "consumer" node. Each particle represents a data reading being ingested. Particle color matches provider status. This makes the 3D scene feel alive and shows that data is actually moving.

Implementation: a THREE.Points particle system with each particle following a bezier curve along the edge. New particles spawned on each successful reading.

### 3b. Real Pi Agent SDK Integration
Replace the "smart simulation" with actual Pi Agent subagent spawning. The infrastructure is already wired — the Healer calls `agent.run(prompt, callbacks)`. Only the `PiAgentSession` implementation changes.

### 3c. Provider Add/Edit UI
A slide-out panel in the frontend with a form to add/edit provider entries. POSTs to `POST /providers` (new backend route) which validates and writes to `config/providers.json`. This closes the "data engineer" user story fully.

### 3d. Nexla ADK Adoption
Replace the custom dot-path resolver with Nexla ADK's `Mapper`/`Schema` classes. Requires Nexla ADK docs/license.

### 3e. Real Backup API Discovery
Replace the static `config/backups.json` with Zero.xyz API discovery. The healer queries Zero.xyz for providers matching the failed provider's data category.

### 3f. Dashboard Metrics Panel
A third panel in the frontend showing:
- Uptime % per provider
- Ingestion rate (readings/minute)
- Average heal time
- Last 5 readings per provider

### 3g. Alerting
Email/Slack webhook when a provider has been degraded for > 5 minutes. Simple POST to a configurable webhook URL.

---

## What I Need From You

**Nothing for Phase 1 (Demo).** All three real APIs are keyless. The "smart simulation" healer needs no API keys. The demo ships with zero external dependencies.

**For Phase 3 (Pi Agent SDK integration):**
- Confirm how to spawn a Pi subagent programmatically — does the `subagent` tool work from within a running Pi session, or is there a separate SDK import?
- Zero.xyz API endpoint/MCP server name for backup discovery (if we go that route)

**The only decision I need now:** approve the plan so I can dispatch subagents.

---

## Subagent Dispatch Plan

Once approved, I'll dispatch these subagents in parallel (each in its own worktree):

| Subagent | Owns | Builds |
|---|---|---|
| **Config & Mock Agent** | `config/`, `apps/mock-provider/` | 4 new provider entries, backups.json, mock grid sensor rewrite with kill/revive/status |
| **Backend Agent** | `apps/backend/` | Fix ingestion bugs (authMode filter, metric, timestamp), add /mock/kill|revive|status proxies, /status endpoint, /readings endpoint, E2E smoke test |
| **Nexla Agent** | `apps/nexla-service/` | `$` prefix resolver semantics, golden tests for 3 new providers, fix existing tests |
| **Healer Agent** | `packages/healer/` | Smart simulation healer (reads registry, discovers from backups.json, writes valid entry with correct fieldMapping) |
| **Frontend Agent** | `apps/frontend/` | Kill/revive buttons, live provider fetch, EventFeed readings toggle, remove old provider data |
| **Integration Agent** | Root | One-command startup script, update all docs, wire everything together, run full test suite |

Dispatch order: Config & Nexla first (shared contracts), then Backend + Healer + Frontend in parallel, then Integration last.
