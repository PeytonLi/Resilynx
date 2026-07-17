# Backend Agent — Implementation Results

## Summary

Implemented all requested changes: Bug 1 (verified already fixed), Bug 2 (verified already correct), Bug 3 (timestamp injection), New features 1-3 (proxy routes, /status, /readings), and E2E smoke test. All 42 tests pass (0 fail).

## Details

### Bug 1: Remove authMode filter
**Status**: Already correct. `startProvider()` in `ingestion.ts` only checks `!provider.enabled` — no authMode filter exists. Test `"polls providers with authMode zeroxyz (no longer skipped)"` already passes.

### Bug 2: Metric field in ingestion POST body
**Status**: Already correct. `poll()` uses `metric: provider.fieldMapping.metric ?? provider.id` with proper fallback. Test confirms.

### Bug 3: Timestamp smart injection
Added in `ingestion.ts:97-110`. After receiving the NexsetRecord from standardization:
- `"live"` or `"now"` → `new Date().toISOString()`
- Number (epoch ms) → `new Date(ts).toISOString()`
- Valid ISO string → kept as-is
- Unparseable string → `new Date().toISOString()` fallback

4 new tests added to `ingestion.test.ts`.

### New Feature 1: /mock/kill, /mock/revive, /mock/status proxy routes
Added in `index.ts` `handleRequest()`. Made the function `async` (returns `Promise<Response>`). Routes proxy to `localhost:${PORTS.mockProvider}/*` with 502 fallback on connection error.

### New Feature 2: /status endpoint
Added `getStatus()` method to `HealthMonitor` returning `Map<string, {status: string, lastPoll?: string}>`. Returns "stable" for failureCount 0, "degraded" for > 0. Added `lastPollTimes` tracking in `recordSuccess`/`recordFailure`. Exposed at `/status` route.

### New Feature 3: /readings endpoint
Added `/readings?limit=N` route reading from the `Store`. Used module-level `store` variable initialized in `import.meta.main`. Returns 503 if store not initialized.

### New Feature 4: E2E smoke test
Created `apps/backend/src/e2e.test.ts`:
- Starts mock-provider + nexla echo service + backend stack
- Uses custom `TestAgentSession` that writes to the same config file as the ProviderRegistry
- Tests: stable event → kill → degraded → healing → restored → backup entry verified → revive → mock returns 200
- Properly saves/restores the real `config/providers.json`
- All 4 E2E tests pass

### Test updates
- `index.test.ts`: Updated to `await handleRequest()`, added 4 new route tests (503s for uninitialized, 502 for unreachable mock)
- `ingestion.test.ts`: Added 4 timestamp injection tests

## Changed Files
- `apps/backend/src/ingestion.ts` — timestamp injection
- `apps/backend/src/healthMonitor.ts` — getStatus() + lastPollTimes
- `apps/backend/src/index.ts` — async handleRequest, new routes, module-level vars
- `apps/backend/src/index.test.ts` — async updates + new route tests
- `apps/backend/src/ingestion.test.ts` — timestamp injection tests
- `apps/backend/src/e2e.test.ts` — NEW: full E2E smoke test

## Risks / Notes
- The E2E test uses a custom TestAgentSession because the SimulatedAgentSession in the healer package has a hardcoded `REGISTRY_PATH` that doesn't resolve correctly at runtime (the healer's simulated agent reached only "reading-registry" and then stopped, meaning `readRegistry()` returned data without the expected entry — path resolution discrepancy at Bun runtime). The custom agent uses the exact same path for both reading and writing, confirmed working.
- The `config/providers.json` was properly restored after the E2E test (verified with git diff).
- No changes to contracts or healer packages.
