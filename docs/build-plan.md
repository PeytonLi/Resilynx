# Plan: Resilynx — PRD + Multi-Agent Build

## Context

The Resilynx repo started empty (no commits, no source). The user supplied the full product concept — a self-healing data-ingestion engine with a 3D visual sandbox — plus the tech stack. Decisions resolved via interview:

- **Data sources:** two real public APIs plus one mock provider with a kill switch (reproducible failure demo).
- **Standardization:** a real Nexla ADK Python service (not a TS stand-in).
- **Healing:** registry-config edits (not live source-code patching).
- **PRD home:** `PRD.md` at the repo root.
- **Execution model (user-directed):** split the work between a setup agent, parallel feature subagents each in their own git worktree, and a final testing/integration agent.

## Execution Plan

### Stage 1 — Setup agent (works directly on `main`)

The setup agent builds the foundation so that all feature agents can build independently and never fight over the same files:

1. Write `PRD.md` (full content from the PRD) and commit it as the first commit.
2. Scaffold the Turborepo monorepo with pnpm: `apps/backend` (Bun/TS), `apps/frontend` (Next.js), `apps/nexla-service` (Python), `apps/mock-provider` (Bun/TS), `packages/contracts`.
3. Write `packages/contracts` — the shared seam all feature agents need to start in parallel without coordinating: TS types + JSON schemas for the provider-registry entry, the Nexset record, and the WebSocket payload (`{ status, nodeId, agentState?, message?, timestamp }`); the `aegis-events` channel name; and port assignments (backend `8080`, nexla-service, mock-provider, frontend `3000`).
4. Write the `packages/healer` interface — the healing agent and backend agent can work against the same seam without touching each other's files.
5. Stub each app just enough that `pnpm install` and `turbo build` pass, then commit.

### Stage 2 — Feature agents (parallel, each with `isolation: "worktree"`)

Four agents dispatched in parallel, each in its own `git worktree`. Each owns a non-overlapping set of directories. All depend only on `packages/contracts` and the `packages/healer` interface from Stage 1. Follow the `superpowers:subagent-driven-development` and `superpowers:using-git-worktrees` skills when dispatching.

| Agent | Owns | Builds |
|---|---|---|
| **Backend Agent** | `apps/backend`, `apps/mock-provider`, `config/` | Provider registry with hot-reload + invalid-edit rejection, ingestion engine (polls providers, calls nexla-service over HTTP), health monitor (N-consecutive-failures debounce), `Bun.serve` WebSocket broadcaster on `/ws` publishing to `aegis-events`, SQLite persistence, killable mock provider with `/kill` + `/revive`. Plus `bun test` suites. |
| **Nexla Agent** | `apps/nexla-service` | Python Nexla ADK HTTP service: raw payload + field mapping in → Nexset record out; structured errors for malformed payloads. Plus pytest golden tests. |
| **Healing Agent** | `packages/healer` | Pi Agent embedded via native SDK, headless; DeepSeek V3/R1 models; Zero.xyz for backup-API discovery; edit surface restricted to the registry file; binds `turn_start`/`agent_end` to `healing`/`restored` callbacks the backend broadcasts. Stubbed-agent tests for wake/injection/event binding. |
| **Frontend Agent** | `apps/frontend` | Next.js app: `useEffect` WebSocket client to `ws://localhost:8080/ws` with auto-reconnect, `networkStatus` state, `<NetworkCanvas/>` Three.js graph (green stable, yellow/red failing, new green node + edge on restore), event feed panel. |

**Contract for each dispatch:** the agent gets the PRD section relevant to its module, the contracts package, and its directory ownership list; it must not edit files outside its owned directories.

### Stage 3 — Integration & testing agent (works on `main`)

1. Merge the four feature branches into `main` one at a time (backend-core → nexla-service → healing-agent → frontend), resolving conflicts — expected to be minimal given directory ownership.
2. Wire the real `packages/healer` into the backend's health monitor (replace the stub).
3. Run all test suites (`turbo test`: bun test + pytest).
4. End-to-end smoke: start the full stack (`turbo dev`), kill the mock provider, assert the broadcaster emits `degraded` → `healing` → `restored` and the registry gains an agent-written backup entry.
5. Capture the sandbox during the kill → heal loop (browse skill).
6. Clean up merged worktrees/branches.

## Verification (overall)

- `turbo build && turbo test` pass from a clean clone.
- The full kill → heal loop works end to end on `turbo dev`: kill switch → red node → agent activity feed → green backup node → data resumes, in under ~30 seconds.


---

# Product Requirement Document: Resilynx

## Problem Statement

Critical global systems — carbon offset registries, supply chains, power grids — depend on data fragmented across thousands of incompatible, archaic third-party APIs. When a provider changes its schema, goes offline, or crashes, every downstream system breaks. Today, recovery is manual: a developer must notice the outage, diagnose it, hunt for a backup provider, read its documentation, obtain API keys, and write new integration code. Human reaction time is measured in hours; the systems consuming the data need milliseconds. That latency causes cascading failures in real-time marketplaces and grids, and operators have no visibility into what is broken or what recovery is doing.

## Solution

**Resilynx** is an autonomous data-ingestion engine and visual sandbox: a self-healing digital twin of a data-provider network.

It continuously ingests from disparate real-world APIs and standardizes their chaotic payloads into one unified schema. When a provider fails, Resilynx does not page a human — it wakes an embedded, headless AI coding agent that diagnoses the failure from the error log, uses the Zero.xyz master-key protocol to discover and securely connect to a backup provider (no manual API-key setup), and patches the live provider registry so data flows resume. The entire healing sequence — detection, agent wake-up, reasoning, patching, restoration — is broadcast over native WebSockets to a Next.js + Three.js frontend, where the provider network is rendered as a live 3D graph: healthy nodes glow green, a failing node turns red, and the operator watches the AI route a new green backup node into the graph in real time.

For a demo, the operator can kill a controlled mock provider on demand and watch the system repair itself end to end.

## User Stories

1. As a marketplace operator, I want provider outages resolved automatically, so that my downstream systems never wait on a human developer.
2. As a marketplace operator, I want a live 3D view of my entire provider network, so that I can see system health at a glance.
3. As a marketplace operator, I want failing nodes to turn red the moment they fail, so that I know about outages before my customers do.
4. As a marketplace operator, I want to watch the AI agent's healing progress live (waking, thinking, patching, restored), so that I trust what the automation is doing instead of treating it as a black box.
5. As a marketplace operator, I want restored pathways rendered as new green nodes and edges, so that I can confirm recovery actually happened.
6. As a data engineer, I want every provider's messy payload standardized into one predictable schema (a Nexset), so that downstream consumers never write per-provider parsers.
7. As a data engineer, I want new providers added by editing a registry entry (endpoint, auth, field mapping) rather than writing integration code, so that onboarding a source takes minutes.
8. As a data engineer, I want the backend to hot-reload the provider registry, so that provider changes — human- or agent-made — take effect without a restart.
9. As a data engineer, I want ingestion failures logged with structured error context, so that both humans and the healing agent can diagnose them.
10. As a platform developer, I want the healing agent to receive the actual error log when it wakes, so that it patches the real root cause rather than guessing.
11. As a platform developer, I want the agent to connect to backup APIs through Zero.xyz's zero-configuration access, so that healing is never blocked on credential provisioning.
12. As a platform developer, I want the agent's edit surface restricted to the provider registry, so that an autonomous agent cannot break the running system's code.
13. As a platform developer, I want agent lifecycle events (turn_start, agent_end) bound to WebSocket broadcasts, so that the frontend mirrors the agent's internal state with millisecond accuracy.
14. As a platform developer, I want DeepSeek R1 used for architectural reasoning and DeepSeek V3 for fast patch generation, so that healing is both correct and quick.
15. As a demo presenter, I want a kill switch on a mock provider, so that I can trigger a realistic outage on stage, on demand, every time.
16. As a demo presenter, I want at least two real public APIs ingesting live alongside the mock provider, so that the demo shows real-world chaos, not a toy.
17. As a demo presenter, I want the full kill → detect → heal → restore loop to complete in seconds, so that the audience sees self-healing happen live without dead air.
18. As a frontend user, I want the 3D scene to react to state changes (stable, degraded, healing, restored) via material/color updates, so that system state is legible without reading logs.
19. As a frontend user, I want the WebSocket client to reconnect automatically, so that a page refresh or network blip doesn't blind the dashboard.
20. As a frontend user, I want a readable event feed alongside the 3D view, so that I can follow exactly what the agent said and did during a heal.
21. As an operations engineer, I want recent readings and event history persisted locally (SQLite), so that I can review what happened after the fact.
22. As an operations engineer, I want the system to keep serving data from healthy providers while one is being healed, so that a single failure never becomes a total outage.
23. As a new contributor, I want the whole stack to start with one command in the monorepo, so that I can run the full demo locally without setup archaeology.

## Implementation Decisions

**Architecture** — Turborepo monorepo (pnpm) with apps and shared packages: a Bun/TypeScript backend (execution layer), a Python Nexla ADK standardization service (data layer), a Next.js frontend (visual sandbox), a killable mock provider, and shared `contracts`/`healer` packages. Local execution and testing target PowerShell on Windows.

**Modules** (each a deep module with a small, stable interface):

- **Provider Registry** — a watched config file listing providers: id, display name, endpoint, auth mode, poll interval, field mapping, priority, enabled flag. The backend hot-reloads it on change. This file is the healing agent's *only* edit surface. Interface: `getProviders()`, change events.
- **Ingestion Engine** (Bun/TS) — polls each enabled registry provider, forwards raw payloads to the standardization service, emits normalized readings and structured failure events. Interface: start/stop, reading stream, failure stream.
- **Nexla Standardization Service** (Python, Nexla ADK) — HTTP service: raw provider payload in, unified Nexset record out, using the provider's registry field mapping. No custom regex or hardcoded per-provider parsers in the backend.
- **Health Monitor** — consumes the failure stream; after N consecutive failures for a provider, declares it down and triggers the Healing Orchestrator. Debounces so one blip doesn't wake the agent.
- **Healing Orchestrator** (Pi Agent via native SDK embedding, own package) — spawns a headless agent session on node failure; injects the error log and current registry into the prompt; instructs the agent to use Zero.xyz to discover and connect a backup provider and patch the registry with its native Read/Write/Edit/Bash tools. Binds `turn_start` → broadcast `healing`, `agent_end` → broadcast `restored`. Cache management prunes context during the debugging loop.
- **WebSocket Broadcaster** — `Bun.serve` upgrades `/ws` connections; all clients subscribe to a global `aegis-events` channel; publishes `stable` / `degraded` / `healing` / `restored` payloads plus agent activity events.
- **Frontend State Binding** (Next.js) — a `useEffect`-connected WebSocket client at `ws://localhost:8080/ws` parses payloads into `networkStatus` state, passed as a prop to `<NetworkCanvas/>`.
- **NetworkCanvas** (Three.js) — spatial WebGL model of the provider graph; node materials react to status (green stable, yellow/red degraded-failing, new green node + edge on restore).
- **Mock Provider** — a small killable HTTP server in the monorepo with a kill/revive switch, emitting realistic-but-scripted payloads in a schema different from the real APIs (to prove standardization).

**Data sources** — two real, keyless public APIs (candidates: UK Carbon Intensity API and Open-Meteo; final pick at implementation) plus the mock provider. Backup providers for failover are discovered via Zero.xyz at heal time.

**AI stack** — Pi Agent (headless, native SDK embedding, surgical file-editing tools); DeepSeek V3 for rapid patch generation, DeepSeek R1 for architectural reasoning; Zero.xyz for zero-configuration access to backup APIs.

**Persistence** — Bun's built-in SQLite stores recent normalized readings and the event/heal history.

**Key contracts** (pinned in a shared contracts package so modules evolve independently) — the WebSocket payload `{ status, nodeId, agentState?, message?, timestamp }`, the provider-registry entry schema, and the Nexset record schema. Everything else may churn.

## Testing Decisions

Good tests exercise external behavior through a module's public interface — inputs in, observable outputs out — never internal implementation details. The codebase is greenfield, so there is no prior art; these tests establish the pattern. TS modules use `bun test`; the Python service uses `pytest`.

- **Nexla Standardization Service** — golden tests: sample raw payloads from each provider (including the mock's deliberately weird schema) map to the exact expected Nexset record; malformed payloads yield structured errors.
- **Provider Registry** — editing the file yields updated `getProviders()` output and a change event; an invalid edit is rejected without dropping the previous good config (protects against a bad agent patch).
- **Health Monitor** — N consecutive failures trigger exactly one healing event; a success resets the counter; flapping does not re-trigger while a heal is in flight.
- **WebSocket Broadcaster** — a test client receives correctly shaped status payloads for each lifecycle transition.
- **Healing Orchestrator** — tested with a stubbed agent (real LLM calls are non-deterministic and slow): verifies wake-on-failure, error-log injection, and event-to-broadcast binding. The real agent loop is validated by the end-to-end demo, not unit tests.
- **End-to-end smoke** — start the stack, kill the mock provider, assert the broadcaster emits `degraded` → `healing` → `restored` and the registry gains a backup entry.
- Frontend 3D rendering is verified visually, not unit-tested.

## Out of Scope

- Live source-code patching by the agent (healing is registry-config-only in v1).
- Authentication, multi-tenancy, and user accounts.
- Production deployment, horizontal scaling, and cloud infrastructure.
- Persistence beyond local SQLite; no external database.
- Broad provider coverage — v1 is 2 real APIs + 1 mock, not thousands.
- Security hardening / sandboxing of the agent beyond restricting its edit surface.
- Mobile or responsive layouts; the sandbox targets desktop.
- Alerting/paging integrations (email, Slack, PagerDuty).

## Further Notes

- The WebSocket channel name `aegis-events` is kept from the original spec; rename if project naming settles on "resilynx-events".
- Demo script: open the sandbox → point at live green nodes ingesting real data → hit the mock provider's kill switch → red node → agent status feed streams → new green backup node appears → data flows resume. Total loop should stay under ~30 seconds for stage use.
- Nexla ADK is a Python SDK, which is why the standardization layer is a separate Python service inside the otherwise TypeScript monorepo — sponsor-tool authenticity was chosen over stack purity.
- Real-API choices favor keyless endpoints so cloning the repo requires zero credential setup; Zero.xyz covers credentials only for agent-discovered backups.
- When a GitHub remote exists, `PRD.md` can be filed verbatim as the repo's founding issue.
