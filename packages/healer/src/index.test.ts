import { describe, expect, it, mock, beforeEach } from "bun:test";
import { Healer, type FailureEvent, type WsPayload, type ProviderRegistryEntry } from "./index";
import type { AgentCallbacks, AgentSession } from "./agent";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFailure(overrides?: Partial<FailureEvent>): FailureEvent {
  return {
    providerId: "mock-carbon-registry",
    errorLog: "ECONNREFUSED 127.0.0.1:4001",
    consecutiveFailures: 3,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/** A fully stubbed agent that fires lifecycle callbacks but never touches the filesystem. */
class StubAgentSession implements AgentSession {
  // Controls: what the stub should do during run().
  promptReceived = "";
  shouldFail = false;
  turnStates: string[] = ["analysing", "reading-registry", "discovering-backup", "patching-registry"];

  async run(prompt: string, callbacks: AgentCallbacks): Promise<void> {
    this.promptReceived = prompt;

    if (this.shouldFail) {
      // Still fire lifecycle for correctness, then throw.
      callbacks.onTurnStart("analysing");
      callbacks.onTurnEnd();
      throw new Error("simulated agent crash");
    }

    for (const state of this.turnStates) {
      callbacks.onTurnStart(state);
    }
    callbacks.onTurnEnd();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Healer — wake-on-failure", () => {
  let healer: Healer;
  let stubAgent: StubAgentSession;

  beforeEach(() => {
    stubAgent = new StubAgentSession();
    healer = new Healer(stubAgent);
  });

  it("emits 'healing' event with WsPayload shape when heal() is called", async () => {
    const events: WsPayload[] = [];
    healer.on("healing", (p: WsPayload) => events.push(p));

    const failure = makeFailure();
    await healer.heal(failure);

    expect(events.length).toBe(1);
    const payload = events[0];
    // WsPayload shape
    expect(payload.status).toBe("healing");
    expect(payload.nodeId).toBe("healer");
    expect(payload.message).toContain(failure.providerId);
    expect(typeof payload.timestamp).toBe("string");
    expect(new Date(payload.timestamp).getTime()).not.toBeNaN();
  });

  it("healing event payload carries failure context in message", async () => {
    const events: WsPayload[] = [];
    healer.on("healing", (p: WsPayload) => events.push(p));

    const failure = makeFailure({ providerId: "open-meteo", errorLog: "timeout" });
    await healer.heal(failure);

    expect(events[0].message).toContain("open-meteo");
  });
});

describe("Healer — error-log injection", () => {
  let healer: Healer;
  let stubAgent: StubAgentSession;

  beforeEach(() => {
    stubAgent = new StubAgentSession();
    healer = new Healer(stubAgent);
  });

  it("agent prompt contains the error log text", async () => {
    const failure = makeFailure({ errorLog: "ECONNREFUSED 127.0.0.1:4001" });
    await healer.heal(failure);

    expect(stubAgent.promptReceived).toContain("ECONNREFUSED 127.0.0.1:4001");
  });

  it("agent prompt contains the provider ID", async () => {
    const failure = makeFailure({ providerId: "open-meteo" });
    await healer.heal(failure);

    expect(stubAgent.promptReceived).toContain("open-meteo");
  });

  it("agent prompt contains consecutive failure count", async () => {
    const failure = makeFailure({ consecutiveFailures: 5 });
    await healer.heal(failure);

    expect(stubAgent.promptReceived).toContain("5");
  });

  it("agent prompt instructs Zero.xyz backup discovery", async () => {
    await healer.heal(makeFailure());

    expect(stubAgent.promptReceived).toContain("Zero.xyz");
  });

  it("agent prompt instructs patching config/providers.json", async () => {
    await healer.heal(makeFailure());

    expect(stubAgent.promptReceived).toContain("config/providers.json");
  });

  it("agent prompt specifies auth mode zeroxyz", async () => {
    await healer.heal(makeFailure());

    expect(stubAgent.promptReceived).toContain("zeroxyz");
  });

  it("agent prompt specifies priority 1 below failed provider", async () => {
    await healer.heal(makeFailure());

    expect(stubAgent.promptReceived).toContain("1 below");
  });

  it("prompt includes timestamp of the failure", async () => {
    const iso = "2025-03-15T08:30:00.000Z";
    const failure = makeFailure({ timestamp: iso });
    await healer.heal(failure);

    expect(stubAgent.promptReceived).toContain(iso);
    expect(new Date(failure.timestamp).getTime()).not.toBeNaN();
  });

  it("prompt instructs backup entry to be enabled", async () => {
    await healer.heal(makeFailure());

    expect(stubAgent.promptReceived).toContain("enabled");
  });
});

describe("Healer — event binding (lifecycle transitions)", () => {
  let healer: Healer;
  let stubAgent: StubAgentSession;

  beforeEach(() => {
    stubAgent = new StubAgentSession();
    healer = new Healer(stubAgent);
  });

  it("emits healing → agent-activity* → restored in correct order", async () => {
    const order: string[] = [];
    healer.on("healing", () => order.push("healing"));
    healer.on("agent-activity", () => order.push("agent-activity"));
    healer.on("restored", () => order.push("restored"));

    await healer.heal(makeFailure());

    // healing first, then agent-activity for each turn state, then restored last.
    expect(order[0]).toBe("healing");
    expect(order[order.length - 1]).toBe("restored");
    // Every entry between first and last is agent-activity.
    const middle = order.slice(1, -1);
    expect(middle.length).toBeGreaterThan(0);
    expect(middle.every((e) => e === "agent-activity")).toBe(true);
  });

  it("agent-activity events carry agentState from turn boundaries", async () => {
    const states: string[] = [];
    healer.on("agent-activity", (p: WsPayload) => {
      if (p.agentState) states.push(p.agentState);
    });

    stubAgent.turnStates = ["analysing", "searching", "patching"];
    await healer.heal(makeFailure());

    expect(states).toEqual(["analysing", "searching", "patching"]);
  });

  it("agent-activity payload matches WsPayload shape", async () => {
    const payloads: WsPayload[] = [];
    healer.on("agent-activity", (p: WsPayload) => payloads.push(p));

    await healer.heal(makeFailure());

    expect(payloads.length).toBeGreaterThan(0);
    for (const p of payloads) {
      expect(p.status).toBe("healing");
      expect(p.nodeId).toBe("healer");
      expect(typeof p.agentState).toBe("string");
      expect(p.agentState!.length).toBeGreaterThan(0);
      expect(typeof p.timestamp).toBe("string");
    }
  });

  it("emits restored even when agent session throws", async () => {
    stubAgent.shouldFail = true;

    const events: string[] = [];
    healer.on("healing", () => events.push("healing"));
    healer.on("agent-activity", () => events.push("agent-activity"));
    healer.on("restored", () => events.push("restored"));

    await healer.heal(makeFailure());

    expect(events).toContain("healing");
    expect(events).toContain("agent-activity");
    expect(events).toContain("restored");
  });

  it("restored payload matches WsPayload shape", async () => {
    const restoredEvents: WsPayload[] = [];
    healer.on("restored", (p: WsPayload) => restoredEvents.push(p));

    await healer.heal(makeFailure());

    expect(restoredEvents.length).toBe(1);
    const p = restoredEvents[0];
    expect(p.status).toBe("restored");
    expect(p.nodeId).toBe("healer");
    expect(p.message).toBeDefined();
    expect(typeof p.timestamp).toBe("string");
  });
});

describe("Healer — WsPayload shape verification", () => {
  it("all event payloads satisfy WsPayload contract", async () => {
    const stubAgent = new StubAgentSession();
    const healer = new Healer(stubAgent);

    const allPayloads: WsPayload[] = [];
    healer.on("healing", (p: WsPayload) => allPayloads.push(p));
    healer.on("agent-activity", (p: WsPayload) => allPayloads.push(p));
    healer.on("restored", (p: WsPayload) => allPayloads.push(p));

    await healer.heal(makeFailure());

    // Every payload must have the required WsPayload fields.
    for (const p of allPayloads) {
      // status: NetworkStatus
      expect(["stable", "degraded", "healing", "restored"]).toContain(p.status);
      // nodeId: string
      expect(typeof p.nodeId).toBe("string");
      expect(p.nodeId.length).toBeGreaterThan(0);
      // timestamp: string (ISO 8601)
      expect(typeof p.timestamp).toBe("string");
      expect(new Date(p.timestamp).getTime()).not.toBeNaN();
    }
  });
});

describe("Healer — edge cases", () => {
  it("multiple rapid heal() calls do not interfere", async () => {
    const stubAgent = new StubAgentSession();
    const healer = new Healer(stubAgent);

    let completed = 0;
    healer.on("restored", () => completed++);

    await Promise.all([
      healer.heal(makeFailure({ providerId: "a" })),
      healer.heal(makeFailure({ providerId: "b" })),
    ]);

    expect(completed).toBe(2);
  });

  it("healing event includes the correct nodeId", async () => {
    const stubAgent = new StubAgentSession();
    const healer = new Healer(stubAgent);

    const payloads: WsPayload[] = [];
    healer.on("healing", (p: WsPayload) => payloads.push(p));
    healer.on("agent-activity", (p: WsPayload) => payloads.push(p));
    healer.on("restored", (p: WsPayload) => payloads.push(p));

    await healer.heal(makeFailure());

    for (const p of payloads) {
      expect(p.nodeId).toBe("healer");
    }
  });
});
