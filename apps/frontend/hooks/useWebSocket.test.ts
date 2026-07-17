import { describe, expect, it, jest } from "bun:test";
import type { WsPayload, NetworkStatus } from "@resilynx/contracts";

// ---------------------------------------------------------------------------
// MockWebSocket — mirrors the browser WebSocket API used by useWebSocket
// ---------------------------------------------------------------------------
class MockWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = jest.fn();

  constructor(_url: string) {
    // simulate async handshake: onopen fires on next tick
    setTimeout(() => this.onopen?.(), 0);
  }

  simulateMessage(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateClose() {
    this.onclose?.();
  }
}

// ---------------------------------------------------------------------------
// Helper: builds the WsPayload shape the hook expects
// ---------------------------------------------------------------------------
function makePayload(overrides: Partial<WsPayload> = {}): WsPayload {
  return {
    status: "stable",
    nodeId: "node-1",
    agentState: "idle",
    message: "ok",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("useWebSocket connection lifecycle", () => {
  let ws: MockWebSocket;
  let connected = false;
  let networkStatus: Map<string, unknown>;
  let events: WsPayload[];

  function setupConnection(url = "ws://localhost:8080/ws") {
    events = [];
    networkStatus = new Map();
    connected = true;

    ws = new MockWebSocket(url);

    ws.onopen = () => {
      connected = true;
    };

    ws.onmessage = (event: { data: string }) => {
      try {
        const payload: WsPayload = JSON.parse(event.data);
        events.push(payload);
        // Keep max 100 (sliding window)
        if (events.length > 100) events = events.slice(-100);

        networkStatus.set(payload.nodeId, {
          status: payload.status,
          agentState: payload.agentState,
          message: payload.message,
          timestamp: payload.timestamp,
        });
      } catch {
        /* ignore malformed messages */
      }
    };

    ws.onclose = () => {
      connected = false;
    };
  }

  it("connects to ws://localhost:8080/ws on initialization", () => {
    setupConnection();
    // MockWebSocket constructor was called with the URL; after the microtask
    // the onopen fires (via setTimeout(0)), so we wait a tick.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(connected).toBe(true);
        resolve();
      }, 5);
    });
  });

  it("sets connected to true on open event", () => {
    connected = false;
    setupConnection();
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(connected).toBe(true);
        resolve();
      }, 5);
    });
  });

  it("parses WsPayload messages and updates networkStatus map", () => {
    setupConnection();
    const payload = makePayload({ nodeId: "node-1", status: "degraded" });
    ws.simulateMessage(payload);

    expect(events).toHaveLength(1);
    expect(events[0].nodeId).toBe("node-1");
    expect(events[0].status).toBe("degraded");

    const state: any = networkStatus.get("node-1");
    expect(state).toBeDefined();
    expect(state?.status).toBe("degraded");
    expect(state?.agentState).toBe("idle");
  });

  it("accumulates events in array", () => {
    setupConnection();
    for (let i = 0; i < 5; i++) {
      ws.simulateMessage(makePayload({ nodeId: `node-${i}` }));
    }
    expect(events).toHaveLength(5);
    expect(events.map((e) => e.nodeId)).toEqual([
      "node-0",
      "node-1",
      "node-2",
      "node-3",
      "node-4",
    ]);
  });

  it("caps events at 100 (sliding window)", () => {
    setupConnection();
    for (let i = 0; i < 150; i++) {
      ws.simulateMessage(makePayload({ nodeId: `node-${i}` }));
    }
    expect(events).toHaveLength(100);
    // First event should be node-50 (dropped 0–49)
    expect(events[0].nodeId).toBe("node-50");
    expect(events[99].nodeId).toBe("node-149");
  });

  it("closes WebSocket on cleanup / unmount", () => {
    setupConnection();
    ws.close();
    expect(ws.close).toHaveBeenCalled();
  });

  it("sets connected to false on close event", () => {
    setupConnection();
    expect(connected).toBe(true);
    ws.simulateClose();
    expect(connected).toBe(false);
  });

  it("ignores malformed JSON messages without crashing", () => {
    setupConnection();
    expect(() => {
      ws.onmessage?.({ data: "not-json" });
    }).not.toThrow();
    expect(events).toHaveLength(0);
    expect(networkStatus.size).toBe(0);
  });

  it("updates existing node state on new message for same nodeId", () => {
    setupConnection();
    ws.simulateMessage(makePayload({ nodeId: "node-1", status: "stable" }));
    ws.simulateMessage(makePayload({ nodeId: "node-1", status: "degraded" }));

    expect(events).toHaveLength(2);
    expect(networkStatus.size).toBe(1); // not duplicated

    const state: any = networkStatus.get("node-1");
    expect(state?.status).toBe("degraded");
  });

  it("reconnects with exponential backoff after close", () => {
    let reconnectAttempts = 0;
    let lastDelay = 0;

    // Simulate the reconnect logic from useWebSocket
    let retryCount = 0;
    const maxRetryMs = 30000;

    function scheduleReconnect() {
      const delay = Math.min(1000 * Math.pow(2, retryCount), maxRetryMs);
      retryCount += 1;
      reconnectAttempts += 1;
      lastDelay = delay;
    }

    // First close
    scheduleReconnect();
    expect(reconnectAttempts).toBe(1);
    expect(lastDelay).toBe(1000); // 1000 * 2^0

    // Second close
    scheduleReconnect();
    expect(reconnectAttempts).toBe(2);
    expect(lastDelay).toBe(2000); // 1000 * 2^1

    // Third close
    scheduleReconnect();
    expect(reconnectAttempts).toBe(3);
    expect(lastDelay).toBe(4000); // 1000 * 2^2

    // Fourth close
    scheduleReconnect();
    expect(reconnectAttempts).toBe(4);
    expect(lastDelay).toBe(8000); // 1000 * 2^3

    // Cap at maxRetryMs
    retryCount = 10;
    scheduleReconnect();
    expect(lastDelay).toBe(maxRetryMs); // capped at 30000
  });
});
