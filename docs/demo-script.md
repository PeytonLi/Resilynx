# Resilynx — Demo Script

---

Most data pipelines depend on third-party APIs. When a provider changes its schema, goes offline, or returns errors, downstream systems break. The standard recovery path — notice the outage, find a backup, get credentials, write integration code — takes hours.

Resilynx automates that entire loop. It detects provider failures, discovers replacement APIs through Zero.xyz, patches its own configuration, and resumes data flow — without a human touching a keyboard. The people who depend on this data never know anything went wrong. Let me walk through how it's built, then show it working.

---

*Click Architecture tab*

Four layers. Four hundred lines of glue between them.

**Data sources.** Four providers feed live data: Open-Meteo for London weather, USGS for global earthquakes, UK National Grid for carbon intensity, and a mock grid sensor simulating a power grid frequency feed. Each returns a completely different response shape — flat nested JSON, GeoJSON features array, array-wrapped objects. No two look alike, which is the point. The mock sensor is the one we'll kill.

**Standardization engine.** A Python FastAPI service on port 5001. It receives raw payloads over HTTP and maps them into a single unified record — what we call a NexsetRecord — using a dollar-sign prefix path resolver. The path `$current.temperature_2m` extracts 26.7 from Open-Meteo. `$features[0].properties.mag` extracts a magnitude from USGS GeoJSON. Values without the dollar prefix are treated as literal constants — like `gCO2/kWh` for the carbon unit.

On startup, the service connects to Nexla's cloud SDK using a token stored in `.env`. It calls `nexsets.list()` to verify the connection to dataops.nexla.io, then validates every provider's field mapping against the expected NexsetRecord schema. If a mapping would produce an invalid record, it logs a warning at boot — catching config errors before they hit runtime. The actual standardization runs locally through the resolver, not through the cloud. Nexla's role here is schema governance: keeping the canonical definition of what a valid reading looks like.

**Healing orchestrator.** A health monitor in the backend counts consecutive polling failures per provider. Three failures in a row — with a debounce to prevent false alarms — and it declares the provider degraded.

The healer wakes up and runs through four steps. First, it reads the error log and identifies which provider failed. Second, it reads the current provider registry from `config/providers.json`. Third, it maps the failed provider's metric — say, `grid_frequency` — to a search query like "real-time power grid frequency data API" and runs `zero search` through Zero.xyz's CLI. It parses the JSON response, filters to healthy GET endpoints, and runs `zero get` on the best match to pull the endpoint URL, cost, and schema. Fourth, it constructs a new registry entry with that endpoint and writes it to the config file.

The Zero.xyz CLI is installed and authenticated under this account with a funded wallet. The search and get calls are free — search returns 17 results including GridPulse at 8 cents per call, and get returns the full endpoint details. The actual API call to fetch data costs money, so the discovered backup is added to the registry but the healer sets it to disabled by default to avoid burning budget on polling.

The registry file is the agent's only write surface. It cannot modify source code. If the agent writes an invalid entry — bad JSON, missing fields — the registry rejects it and keeps the last valid config. Safe automation by construction.

If Zero.xyz is unreachable, the healer falls back to `config/backups.json`, a static file with pre-configured backup providers per metric type. Same flow, same output — the dashboard can't tell the difference.

**Persistence and broadcast.** All standardized readings go to a local SQLite database using Bun's built-in driver. Every state transition — stable, degraded, healing, restored — is published over WebSocket to a channel called `aegis-events`. The dashboard connects on page load and receives every event in real time with automatic reconnection on disconnect.

---

*Click Dashboard*

The four providers are polling live. Each card shows the provider's endpoint, last reading, and unit. The animated dots between columns show data moving from providers through the Nexla core to the database. The right panel shows the event feed — right now it's all green stable events.

At the top: the impact banner. This is what an everyday person sees. Right now, 50,000 simulated households rely on grid frequency data for power stability monitoring. The banner reads GRID MONITORING ACTIVE. All households covered.

*Click Kill Mock*

The mock grid sensor now returns 503. The other three providers — Open-Meteo, USGS, UK Carbon — continue ingesting without interruption. A single failure doesn't cascade.

The health monitor counts three consecutive failures at 15-second intervals. The mock grid card's border turns amber, then red. The impact banner flips: GRID MONITORING OFFLINE. 50,000 households at risk. This is what the normal person sees — their monitoring just went blind. But Resilynx is already responding.

*Open Events panel*

The healer fires four lifecycle events. You can watch each one land here in real time.

Analysing — it extracted the provider ID and the HTTP 503 error from the failure log. Reading registry — it parsed `config/providers.json` and found the mock-grid entry with metric `grid_frequency`. Discovering backup — it mapped that metric to a search query, ran `zero search` against Zero.xyz's index, got a list of power grid APIs, and selected the cheapest healthy match. Patching registry — it constructed a valid registry entry and wrote it to the config file.

The Zero.xyz interaction is a real CLI call. The `zero` binary is installed globally. The session is authenticated with a funded wallet. The search returned 17 capabilities including GridPulse at 8 cents per call. The get call returned the full endpoint schema — URL, method, pricing, failure modes. The entire discovery took under two seconds. Free.

The registry file is watched by the backend using Node's `fs.watch`. It hot-reloads automatically — no restart. The ingestion engine picks up the new provider on the next poll cycle.

The banner flips back to green: GRID MONITORING RESTORED. It shows the measured recovery time and confirms 50,000 households are back online. From the normal person's perspective, nothing happened.

*Click Revive*

The original provider comes back. The backup stays in the registry permanently — new entry, new endpoint, same data type. The system grows more resilient with each heal.

---

**No per-provider code.** Adding a data source means adding a JSON entry with five fields: endpoint, auth mode, poll interval, field mapping, and priority. The standardization engine handles the rest. Four providers share zero lines of parsing code.

**Safe automation.** The healer's edit surface is one file. A bad patch triggers validation at the registry layer and the last valid config is preserved.

**Observability by default.** Every heal produces a structured, timestamped event log. You can replay exactly what the agent did, in order, with the data it had at each step.

**Keyless onboarding.** All three real APIs require zero credentials. Zero.xyz covers authentication for discovered backups — no API key provisioning, no secrets in the config file.

**Real integrations, used concretely.** Zero.xyz is not simulated — the CLI is installed, authenticated, and calling the live index. Nexla is not a stub — the SDK connects to dataops.nexla.io on every startup and validates field mappings. Both are Python and TypeScript dependencies with version pins.
