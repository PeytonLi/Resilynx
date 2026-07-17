# Plan: Resilynx — Productionization (Beyond Demo)

## 1. Pi Agent SDK Integration (real healing)

### Current state
`SimulatedAgentSession` regex-parses the prompt, reads registry from disk, writes a fake backup entry with hardcoded fields. No AI reasoning occurs.

### Target state
`PiAgentSession` implements `AgentSession` using the Pi Agent native SDK. A real LLM (DeepSeek V3 for code generation, DeepSeek R1 for architectural reasoning) diagnoses failures and patches the registry.

### Implementation steps

#### 1a. Create PiAgentSession class
**File:** `packages/healer/src/pi-agent-session.ts` (new)
- Import Pi Agent SDK (`@pi-agent/sdk` or equivalent)
- Implement `AgentSession.run(prompt, callbacks)`
- Spawn a headless agent session with the prompt injected as system message
- Configure the agent's tool set: `Read`, `Write`, `Edit`, `Bash` — all scoped to the repo
- Enforce edit-surface restriction: the agent may only write to `config/providers.json`
  - Implement as a pre-write hook that rejects writes to any other path
  - Return a structured error to the agent: "Edit rejected: you may only modify config/providers.json"

#### 1b. Model routing
- **DeepSeek R1** for the initial diagnostic turn: analyze the error log, determine failure type (network/timeout/schema/auth), decide if a backup is needed
- **DeepSeek V3** for patch generation: read registry, write the new provider entry with correct field mapping
- Implement as two separate agent turns with explicit handoff
- Configuration: model names in env vars or a config object, swappable for testing

#### 1c. Zero.xyz integration
- The agent prompt instructs the agent to use Zero.xyz's master-key protocol
- Pi Agent has access to a Zero.xyz MCP tool or HTTP endpoint
- The agent discovers backup APIs by: (1) identifying the data type of the failed provider, (2) querying Zero.xyz for providers of that type, (3) selecting the best match by latency/cost/coverage
- For the demo: Zero.xyz returns a pre-configured backup endpoint. In production: the agent evaluates and picks.
- **Fallback:** if Zero.xyz is unavailable, the agent searches a local backup registry file (`config/backups.json`) as a degraded-mode path

#### 1d. Context window / cache management
- The agent's debugging loop can fill the context window
- After each failed attempt, prune: keep the error log, the current registry, and the last N messages; drop intermediate reasoning
- Implement as a Pi Agent cache policy: `maxTokens: 8000`, eviction strategy LRU
- On context exhaustion, the agent emits `agent-activity` with `agentState: "pruning"` and resets with a summary

#### 1e. Agent lifecycle observability
- Each `turn_start` emits: `{agentState: "analysing" | "reading-registry" | "discovering-backup" | "patching-registry" | "pruning"}`
- Each tool call emits: `{agentState: "calling-tool", message: "Read config/providers.json"}`
- The backend rebroadcasts these as `agent-activity` WsPayloads
- The frontend renders them as a live thought-trail in the event feed

#### 1f. Testing strategy
- **Unit tests** (bun test): `PiAgentSession` with a mock Pi Agent SDK — verify prompt construction, tool restriction enforcement, lifecycle callback ordering, model routing logic
- **Integration tests**: a real-but-ephemeral agent session against a local test registry — verify the agent writes a valid entry, doesn't touch other files
- **E2E**: the existing smoke test now exercises the real agent path (requires Pi Agent SDK in CI)

---

## 2. Nexla ADK Adoption

### Current state
Plain FastAPI service with a custom dot-path resolver (`resolver.py`). No Nexla ADK classes used.

### Target state
The standardization service uses Nexla ADK's `Schema`, `Mapper`, and `Connector` classes for type-safe, declarative field mapping instead of raw dot-path strings.

### Implementation steps

#### 2a. Replace dot-path resolver with Nexla ADK Mapper
**File:** `apps/nexla-service/src/nexla_service/adapter.py` (create)
- Import `nexla.adk.Mapper` (or equivalent SDK class)
- Define a `NexsetSchema` using Nexla ADK's schema DSL
- The mapper accepts a raw payload + schema → produces a validated NexsetRecord
- The registry's `fieldMapping` becomes a Nexla mapping config, not raw dot-paths

#### 2b. Schema validation
**File:** `apps/nexla-service/src/nexla_service/schemas.py` (create)
- Define provider-specific schemas: `CoinGeckoSchema`, `FrankfurterSchema`, `MockExchangeSchema`
- Nexla ADK validates input shape before mapping — catches malformed payloads earlier
- Structured validation errors propagate as 400 responses with field-level detail

#### 2c. Connector abstraction
**File:** `apps/nexla-service/src/nexla_service/connectors.py` (create)
- Nexla ADK `Connector` classes for each provider type
- Encapsulate auth, retry, rate-limiting per provider
- The backend calls `POST /standardize` as before; the connector handles provider-specific logic internally

#### 2d. Dependency management
**File:** `apps/nexla-service/pyproject.toml`
- Add `nexla-adk` (or the actual package name) to dependencies
- Add `httpx` for TestClient
- Pin versions for reproducibility

---

## 3. Production Infrastructure

### 3a. Database migration: SQLite → PostgreSQL
- **Current:** Bun's built-in SQLite stores readings + events locally
- **Target:** PostgreSQL with connection pooling
- Create `packages/db` (shared package): Drizzle ORM schema, migration files, seed scripts
- Backend imports from `@resilynx/db` instead of `./db.ts`
- SQLite retained as a fallback for local dev (`DATABASE_URL=:memory:` or sqlite path)
- **Migration path:** existing `Store` class gets a `PostgresStore` sibling implementing the same interface

### 3b. Authentication & multi-tenancy
- **Current:** no auth — anyone on localhost can hit any endpoint
- **Target:** JWT-based auth with API key fallback for provider endpoints
- **New package:** `packages/auth` — middleware for Bun.serve and FastAPI
- Provider registry gains `ownerId` field for multi-tenant isolation
- WebSocket connections require a token in the query string: `ws://host:8080/ws?token=...`
- Mock provider gets a `/login` endpoint for demo credentials

### 3c. Deployment
- **Docker:** `Dockerfile` per app (backend, nexla-service, frontend) + `docker-compose.yml` at root
- **CI/CD:** GitHub Actions workflow — lint → test → build → push images → deploy
- **Target platforms:** Fly.io or Railway (simple), Kubernetes (production)
- Health check endpoints already exist (`/health` on backend and nexla-service)
- Graceful shutdown: SIGTERM handler that stops ingestion, drains WebSocket connections, closes DB

### 3d. Monitoring & observability
- **Structured logging:** JSON log lines with correlation IDs (request_id propagated across services)
- **Metrics:** Prometheus endpoint on each service — ingestion rate, failure rate, heal latency, WebSocket client count
- **Tracing:** OpenTelemetry spans across backend → nexla-service → provider fetch
- **Alerting:** heal failures (agent crashed without restoring), provider outage > 5 minutes, ingestion rate drops to zero

---

## 4. Security Hardening

### 4a. Agent sandbox
- **Current:** simulated agent has unrestricted filesystem access
- **Target:** the Pi Agent runs in a restricted environment:
  - Filesystem: read-only except `config/providers.json` (write) and a temp dir
  - Network: allowed to call Zero.xyz and provider endpoints; blocked from arbitrary internet access
  - Process: no shell access beyond the tools Pi Agent provides (Read/Write/Edit)
  - Implementation: Pi Agent's built-in tool restriction + a container-level network policy

### 4b. Input validation & rate limiting
- **Backend:** rate-limit `/ws` upgrades (max 50 concurrent), `/providers` (100 req/min)
- **Nexla-service:** request body size limit (1MB), field mapping depth limit (5 levels)
- **Mock provider:** `/kill` requires a shared secret header (demo mode only — disabled in production)
- **Provider registry:** validate new entries against the JSON schema on write (already partially done, add schema-based validation)

### 4c. Secret management
- API keys for real providers stored in environment variables, never in `providers.json`
- The registry's `authMode: "apiKey"` reads from `process.env[PROVIDER_ID_API_KEY]`
- Zero.xyz credentials injected at runtime, never committed

---

## 5. Operational Readiness

### 5a. Graceful degradation
- If nexla-service is down: backend caches raw payloads and retries; continues broadcasting health status
- If Zero.xyz is unreachable: healer falls back to a local backup registry
- If the healer crashes mid-heal: the health monitor's `healingInFlight` flag has a 5-minute timeout
- If PostgreSQL is down: backend falls back to SQLite (already implemented)

### 5b. Provider onboarding UX
- **Current:** edit `config/providers.json` by hand
- **Target:** a CLI tool (`pnpm provider add`) that:
  - Accepts endpoint, auth mode, field mapping
  - Validates the entry against the schema
  - Tests connectivity by making a sample request
  - Appends to `providers.json`
- A web UI form in the frontend (secondary priority)

### 5c. Backup provider registry
- **File:** `config/backups.json` (new)
- A curated list of fallback providers per data category
- Used when Zero.xyz discovery returns no results
- Updated manually or via a periodic refresh job

---

## 6. Testing Gaps (Demo → Production)

| Layer | Current | Target |
|---|---|---|
| Unit (TS) | 36 tests (healer, backend, mock-provider) | Add: ingestion.test.ts, db.test.ts, pi-agent-session.test.ts, auth middleware tests |
| Unit (Python) | 21 tests (resolver, golden) | Add: adapter.test.ts, connector tests, schema validation tests |
| Integration | 0 | Add: backend → nexla integration tests, healer → registry integration tests |
| E2E | Manual smoke test | Playwright test: open frontend, kill mock, verify feed, screenshot |
| Performance | 0 | Load test: 100 providers polling simultaneously, WebSocket broadcast to 50 clients |
| Chaos | 0 | Randomly kill/revive providers, verify no cascading failures |

---

## Implementation Order (Recommended)

### Wave 1: Core healing works (2-3 weeks)
1. Pi Agent SDK integration (1a-1f)
2. Fix ingestion authMode zeroxyz (demo plan 2.1)
3. Fix metric semantics (demo plan 2.3)
4. E2E test with real agent healing

### Wave 2: Production data layer (2 weeks)
1. PostgreSQL migration (3a)
2. Secret management (4c)
3. Backup provider registry (5c)

### Wave 3: Security + observability (2 weeks)
1. Authentication (3b)
2. Agent sandbox (4a)
3. Monitoring (3d)

### Wave 4: Polish + scale (2 weeks)
1. Nexla ADK adoption (2a-2c)
2. Provider onboarding UX (5b)
3. Test gap closure (6)
4. Docker + CI/CD (3c)
