import { describe, expect, it, jest } from "bun:test";
import { IngestionEngine } from "./ingestion";
import { HealthMonitor } from "./healthMonitor";
import { Store } from "./db";
import { Healer } from "@resilynx/healer";
import type { AgentCallbacks, AgentSession } from "@resilynx/healer/src/agent";
import type { NexsetRecord, ProviderRegistryEntry, WsPayload } from "@resilynx/contracts";
import type { FailureEvent } from "@resilynx/healer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(overrides?: Partial<ProviderRegistryEntry>): ProviderRegistryEntry {
  return {
    id: "test-provider",
    displayName: "Test Provider",
    endpoint: "http://localhost:9999/data",
    authMode: "none",
    pollIntervalMs: 1000,
    fieldMapping: { metric: "test_metric", value: "price", unit: "currency", timestamp: "ts" },
    priority: 1,
    enabled: true,
    ...overrides,
  };
}

function makeReading(providerId: string): NexsetRecord {
  return {
    providerId,
    metric: "test_metric",
    value: 42.5,
    unit: "USD",
    timestamp: new Date().toISOString(),
  };
}

/** A stubbed agent that fires callbacks but never touches filesystem/LLM. */
class StubAgentSession implements AgentSession {
  promptReceived = "";
  turnStates: string[] = ["analysing", "reading-registry", "discovering-backup", "patching-registry"];

  async run(prompt: string, callbacks: AgentCallbacks): Promise<void> {
    this.promptReceived = prompt;
    for (const state of this.turnStates) {
      callbacks.onTurnStart(state);
    }
    callbacks.onTurnEnd();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("backend startup wiring", () => {
  it("ingestion reading flows to store.insertReading and healthMonitor.recordSuccess", async () => {
    const provider = makeProvider();
    const registry = { getProviders: () => [provider] };
    const store = new Store(":memory:");
    const monitor = new HealthMonitor({ async heal() {} });

    let callCount = 0;
    const fetchImpl = jest.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response(JSON.stringify({ price: 42.5, currency: "USD", ts: "2026-01-01T00:00:00Z" }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(makeReading(provider.id)), { status: 200 }));
    }) as unknown as typeof fetch;

    const engine = new IngestionEngine(registry, "http://localhost:5001/standardize", fetchImpl);

    // Wire like index.ts
    engine.on("reading", (record: NexsetRecord) => {
      store.insertReading(record);
      monitor.recordSuccess(record.providerId);
    });

    await engine.pollOnce(provider);

    // Store has the reading
    const readings = store.recentReadings(10);
    expect(readings.length).toBe(1);
    expect(readings[0].providerId).toBe(provider.id);
    expect(readings[0].value).toBe(42.5);

    // Monitor shows stable
    const status = monitor.getStatus();
    expect(status.get(provider.id)?.status).toBe("stable");

    store.close();
  });

  it("ingestion failure flows to healthMonitor.recordFailure", async () => {
    const provider = makeProvider();
    const registry = { getProviders: () => [provider] };
    const monitor = new HealthMonitor({ async heal() {} });

    // First record a success so the provider enters the "seen" set
    monitor.recordSuccess(provider.id);

    const fetchImpl = jest.fn(() =>
      Promise.resolve(new Response(JSON.stringify("Service Unavailable"), { status: 503 })),
    ) as unknown as typeof fetch;

    const engine = new IngestionEngine(registry, "http://localhost:5001/standardize", fetchImpl);

    engine.on("failure", (failure) => {
      monitor.recordFailure(failure as import("./ingestion").IngestionFailure);
    });

    await engine.pollOnce(provider);

    const status = monitor.getStatus();
    expect(status.get(provider.id)?.status).toBe("degraded");
  });

  it("healthMonitor down event triggers healer.heal", async () => {
    const stubAgent = new StubAgentSession();
    const healer = new Healer(stubAgent);
    const monitor = new HealthMonitor(healer);

    const healEvents: FailureEvent[] = [];
    // Track heal calls via the healer's event
    const healsStarted: unknown[] = [];
    healer.on("healing", (p) => healsStarted.push(p));

    // 3 failures to trigger down
    for (let i = 0; i < 3; i++) {
      monitor.recordFailure({
        providerId: "p1",
        errorLog: "ECONNREFUSED",
        timestamp: new Date().toISOString(),
      });
    }

    expect(healsStarted.length).toBe(1);
    expect((healsStarted[0] as WsPayload).status).toBe("healing");
    expect(stubAgent.promptReceived).toContain("p1");
    expect(stubAgent.promptReceived).toContain("ECONNREFUSED");
  });

  it("healer lifecycle events emit correct WsPayload shapes", async () => {
    const stubAgent = new StubAgentSession();
    const healer = new Healer(stubAgent);

    const healingPayloads: WsPayload[] = [];
    const activityPayloads: WsPayload[] = [];
    const restoredPayloads: WsPayload[] = [];

    healer.on("healing", (p: WsPayload) => healingPayloads.push(p));
    healer.on("agent-activity", (p: WsPayload) => activityPayloads.push(p));
    healer.on("restored", (p: WsPayload) => restoredPayloads.push(p));

    await healer.heal({
      providerId: "mock-exchange",
      errorLog: "HTTP 503 from http://localhost:4001/data",
      consecutiveFailures: 3,
      timestamp: new Date().toISOString(),
    });

    // healing event
    expect(healingPayloads.length).toBe(1);
    expect(healingPayloads[0].status).toBe("healing");
    expect(healingPayloads[0].nodeId).toBe("healer");
    expect(healingPayloads[0].message).toContain("Healing started");

    // agent-activity events — one per turn state
    expect(activityPayloads.length).toBe(stubAgent.turnStates.length);
    for (const p of activityPayloads) {
      expect(p.status).toBe("healing");
      expect(p.nodeId).toBe("healer");
      expect(p.agentState).toBeDefined();
      expect(typeof p.agentState).toBe("string");
    }

    // restored event
    expect(restoredPayloads.length).toBe(1);
    expect(restoredPayloads[0].status).toBe("restored");
    expect(restoredPayloads[0].nodeId).toBe("healer");
    expect(restoredPayloads[0].message).toContain("Healing complete");
  });
});
