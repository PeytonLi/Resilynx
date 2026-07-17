import { describe, expect, it } from "bun:test";
import { Store } from "./db";
import type { NexsetRecord, WsPayload } from "@resilynx/contracts";

function makeReading(providerId: string): NexsetRecord {
  return {
    providerId,
    metric: "test_metric",
    value: 42.5,
    unit: "USD",
    timestamp: new Date().toISOString(),
  };
}

function makeEvent(status: WsPayload["status"], nodeId: string): WsPayload {
  return {
    status,
    nodeId,
    timestamp: new Date().toISOString(),
  };
}

describe("Store", () => {
  it("inserts and retrieves readings", () => {
    const store = new Store(":memory:");

    store.insertReading(makeReading("p1"));
    store.insertReading(makeReading("p2"));
    store.insertReading(makeReading("p1"));

    const readings = store.recentReadings(10);
    expect(readings.length).toBe(3);
    expect(readings[0].providerId).toBe("p1"); // most recent first
    expect(readings[0].value).toBe(42.5);
    expect(readings[0].metric).toBe("test_metric");
    expect(readings[0].unit).toBe("USD");

    store.close();
  });

  it("inserts and retrieves events", () => {
    const store = new Store(":memory:");

    store.insertEvent(makeEvent("stable", "coingecko"));
    store.insertEvent(makeEvent("degraded", "mock-exchange"));
    store.insertEvent(makeEvent("healing", "mock-exchange"));

    const events = store.recentEvents(10);
    expect(events.length).toBe(3);
    expect(events[0].status).toBe("healing"); // most recent first
    expect(events[0].nodeId).toBe("mock-exchange");

    store.close();
  });

  it("respects the limit parameter", () => {
    const store = new Store(":memory:");

    for (let i = 0; i < 10; i++) {
      store.insertReading(makeReading(`p${i}`));
    }

    const readings = store.recentReadings(3);
    expect(readings.length).toBe(3);

    store.close();
  });

  it("stores agent-activity events with agentState and message", () => {
    const store = new Store(":memory:");

    store.insertEvent({
      status: "healing",
      nodeId: "healer",
      agentState: "analysing",
      message: "Diagnosing HTTP 503 from mock-exchange",
      timestamp: new Date().toISOString(),
    });

    const events = store.recentEvents(1);
    expect(events.length).toBe(1);
    expect(events[0].agentState).toBe("analysing");
    expect(events[0].message).toContain("HTTP 503");

    store.close();
  });

  it("persists data across store instances (file-backed)", () => {
    // Use a file-backed DB to verify persistence
    const tmpDir = process.env.TEMP ?? process.env.TMPDIR ?? "/tmp";
    const dbPath = `${tmpDir}/resilynx-test-${Date.now()}.db`;

    const store1 = new Store(dbPath);
    store1.insertReading(makeReading("persist-test"));
    store1.close();

    const store2 = new Store(dbPath);
    const readings = store2.recentReadings(1);
    expect(readings.length).toBe(1);
    expect(readings[0].providerId).toBe("persist-test");
    store2.close();
  });

  it("returns empty arrays for empty store", () => {
    const store = new Store(":memory:");
    expect(store.recentReadings()).toEqual([]);
    expect(store.recentEvents()).toEqual([]);
    store.close();
  });
});
