# Plan: Resilynx — Audit Fixes + Domain Migration

## Phase 1: Domain Migration (carbon → financial market data)

### 1.1 Update provider registry
**File:** `config/providers.json`
- Replace `uk-carbon-intensity` → `coingecko` (crypto prices, free tier)
- Replace `open-meteo` → `frankfurter` (forex rates, completely free)
- Replace `mock-carbon-registry` → `mock-exchange` (mock financial exchange)
- Update endpoints, field mappings, display names, poll intervals

### 1.2 Update mock provider
**File:** `apps/mock-provider/src/index.ts`
- Change payload shape from `{reading: {value, unit, ts}}` to `{ticker: "MOCK", price: number, currency: "USD", ts: string}`
- Cycle ticker values (MOCK, TEST, DEMO) and prices
- Update tests

### 1.3 Update nexla golden tests
**File:** `apps/nexla-service/tests/test_standardize.py`
- Replace UK-CI tests with CoinGecko payload tests
- Replace Open-Meteo tests with Frankfurter payload tests
- Replace Mock carbon tests with Mock exchange tests
- Update expected NexsetRecord values

### 1.4 Update frontend provider list
**File:** `apps/frontend/lib/providers.ts`
- Replace all 3 provider entries to match new financial domain
- Keep sync with `config/providers.json`

### 1.5 Update PRD references
**File:** `PRD.md`, `docs/build-plan.md`
- Update all mentions of carbon/weather APIs to financial APIs
- Update demo script language

---

## Phase 2: Critical Bug Fixes

### 2.1 Fix ingestion: poll `authMode:"zeroxyz"` providers
**File:** `apps/backend/src/ingestion.ts`
- Remove the `authMode !== "none"` skip guard
- For `authMode:"zeroxyz"`, add a Zero.xyz proxy prefix or treat identically to `"none"` for now
- `metric` field: derive from `provider.fieldMapping.metric` if present, else fall back to `provider.id`

### 2.2 Fix `agent-activity` nodeId
**File:** `apps/backend/src/index.ts` (line ~82)
- The handler receives a WsPayload (from healer's `wsPayload()`), not a raw object
- Change: `const a = (activity ?? {}) as { providerId?... }` → use `activity as WsPayload` and read `.nodeId` directly

### 2.3 Fix `metric` field semantics
**File:** `apps/backend/src/ingestion.ts` — same as 2.1
- `metric` should be the human-readable metric name, not `provider.id`
- Add `metric` key to `fieldMapping` in provider registry entries, or derive from a known mapping

### 2.4 Fix restored node labels and edges
**File:** `apps/frontend/components/NetworkCanvas.tsx`
- When a new restored node spawns, create a label sprite for it
- Draw a connecting edge from an existing node to the new restored node

### 2.5 Fix WebSocket cleanup leak
**File:** `apps/frontend/hooks/useWebSocket.ts`
- Store the WebSocket instance in a ref
- Close it in the useEffect cleanup

### 2.6 Fix frontend hardcoded providers
**File:** `apps/frontend/lib/providers.ts`
- Either: fetch providers from `GET http://localhost:8080/providers` on mount
- Or: accept as SSR limitation, add a comment noting it drifts from live config
- **Decision:** fetch from backend on mount, fall back to hardcoded list

---

## Phase 3: High-Priority Improvements

### 3.1 Add missing test files
**Files:** `apps/backend/src/ingestion.test.ts`, `apps/backend/src/db.test.ts`
- Ingestion tests: polls enabled provider, emits reading on success, emits failure on 503, skips nexla errors
- DB tests: insert/query readings, insert/query events

### 3.2 Add httpx dependency
**File:** `apps/nexla-service/pyproject.toml`
- Add `httpx` to dev dependencies so `TestClient` works

### 3.3 Fix `broadcast()` closure ordering
**File:** `apps/backend/src/index.ts`
- Move the `broadcast` function definition after `Bun.serve()` or use a let binding

---

## Phase 4: Verification

### 4.1 Run all test suites
- `turbo test` (bun tests)
- `cd apps/nexla-service && python -m pytest tests/ -v`

### 4.2 E2E smoke test
- Start full stack (`turbo dev`)
- Verify CoinGecko + Frankfurter data flowing in event feed
- Kill mock exchange → verify `degraded` → `healing` → `restored`
- Verify frontend shows connected, 3D nodes colored correctly

### 4.3 Capture sandbox
- Browse to `localhost:3000`, screenshot the financial data dashboard

---

## Files touched (by phase)

| Phase | Files |
|---|---|
| 1.1 | `config/providers.json` |
| 1.2 | `apps/mock-provider/src/index.ts`, `apps/mock-provider/src/index.test.ts` |
| 1.3 | `apps/nexla-service/tests/test_standardize.py` |
| 1.4 | `apps/frontend/lib/providers.ts` |
| 1.5 | `PRD.md`, `docs/build-plan.md` |
| 2.1 | `apps/backend/src/ingestion.ts` |
| 2.2 | `apps/backend/src/index.ts` |
| 2.4 | `apps/frontend/components/NetworkCanvas.tsx` |
| 2.5 | `apps/frontend/hooks/useWebSocket.ts` |
| 2.6 | `apps/frontend/lib/providers.ts` (already in 1.4) |
| 3.1 | `apps/backend/src/ingestion.test.ts`, `apps/backend/src/db.test.ts` |
| 3.2 | `apps/nexla-service/pyproject.toml` |
| 3.3 | `apps/backend/src/index.ts` (already in 2.2) |
| 4.1-4.3 | `turbo test`, pytest, E2E smoke, browser capture |

## Out of scope for this pass

- Real Pi Agent SDK integration (needs actual API keys, SDK setup)
- Nexla ADK SDK adoption (needs ADK license/docs)
- Healer concurrency guard (low risk with current 3-failure debounce)
- `turbo test` running pytest natively (needs cross-platform venv in package.json script)
