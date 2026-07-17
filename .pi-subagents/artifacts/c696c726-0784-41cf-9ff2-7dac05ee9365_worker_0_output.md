# Config & Mock Provider — Implementation Result

## Summary
All 5 tasks completed. 4 files changed, 1 file created, 7 tests passing.

## Changed files
- `config/providers.json` — rewritten with 4 providers
- `config/backups.json` — created with backup providers per metric
- `apps/mock-provider/src/index.ts` — grid sensor payload, GET /status endpoint
- `apps/mock-provider/src/index.test.ts` — 7 tests, new payload shape + status test
- `apps/frontend/lib/providers.ts` — 4 providers matching config

## Validation
```
bun test v1.3.12 (700fc117)
src\index.test.ts:
(pass) mock provider > GET /data returns payload with reading.sensor, reading.frequency, reading.voltage, reading.unit, reading.ts
(pass) mock provider > GET /status returns { alive: true } when not killed
(pass) mock provider > POST /kill makes subsequent GET /data return 503
(pass) mock provider > GET /status returns { alive: false } after kill
(pass) mock provider > POST /revive restores GET /data after a kill
(pass) mock provider > 404s on unknown routes
(pass) mock provider > cycles through different sensors on successive calls

 7 pass, 0 fail, 15 expect() calls
```

## Residual risks
- None. All existing patterns preserved (killed flag, cycleIdx, resetForTests, import.meta.main).
- The `AuthMode` type already includes `"zeroxyz"` so backups.json entries are valid.
- The `$` prefix convention on fieldMapping values is documented in the task; resolver implementation is in Nexla agent's scope.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "5 files changed — exactly the scope requested: config/providers.json, config/backups.json, mock-provider/src/index.ts, mock-provider/src/index.test.ts, frontend/lib/providers.ts. No other files touched."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "7 passing tests, config files validated against AuthMode type, providers.ts matches config exactly."
    }
  ],
  "changedFiles": [
    "config/providers.json",
    "config/backups.json",
    "apps/mock-provider/src/index.ts",
    "apps/mock-provider/src/index.test.ts",
    "apps/frontend/lib/providers.ts"
  ],
  "testsAddedOrUpdated": [
    "apps/mock-provider/src/index.test.ts"
  ],
  "commandsRun": [
    {
      "command": "cd apps/mock-provider && bun test",
      "result": "passed",
      "summary": "7 pass, 0 fail, 15 expect() calls"
    }
  ],
  "validationOutput": [
    "All 7 tests pass: data payload shape, status alive, status dead, kill/503, revive, 404, sensor cycling."
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "Replaced 3 CoinGecko/ExchangeRate/Mock-Exchange providers with 4 environmental sensor providers (open-meteo, usgs-earthquake, uk-carbon, mock-grid). Mock provider payload changed from ticker/price to reading/sensor/frequency/voltage. Added GET /status. Created backups.json with per-metric fallback providers.",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "The $ prefix convention on fieldMapping values is documented in the task as being simultaneously implemented by the Nexla agent in the resolver."
}
```
