import { describe, expect, it } from "bun:test";
import { NexlaIngestionEngine, type NexlaResourceManifest } from "./nexla";

const registry = { getProviders: () => [{ id: "coin", displayName: "Coin", endpoint: "unused", authMode: "none" as const, pollIntervalMs: 1, fieldMapping: {}, priority: 1, enabled: true }] };
const resources: NexlaResourceManifest = { resources: [{ providerId: "coin", sourceId: 1, nexsetId: 2 }] };

describe("NexlaIngestionEngine", () => {
  it("maps a transformed Nexla sample into a reading", async () => {
    const engine = new NexlaIngestionEngine(registry, resources, async () => ({ samples: [{ metric: "price", value: 42, unit: "USD", timestamp: "2026-01-01T00:00:00Z" }] }));
    const readings: unknown[] = [];
    engine.on("reading", (reading) => readings.push(reading));
    await engine.pollOnce(registry.getProviders()[0]);
    expect(readings).toEqual([{ providerId: "coin", metric: "price", value: 42, unit: "USD", timestamp: "2026-01-01T00:00:00Z", raw: { metric: "price", value: 42, unit: "USD", timestamp: "2026-01-01T00:00:00Z" } }]);
  });

  it("emits a failure for an untransformed sample", async () => {
    const engine = new NexlaIngestionEngine(registry, resources, async () => ({ samples: [{ price: 42 }] }));
    const failures: Array<{ errorLog: string }> = [];
    engine.on("failure", (failure) => failures.push(failure));
    await engine.pollOnce(registry.getProviders()[0]);
    expect(failures[0].errorLog).toContain("does not match");
  });

  it("reads Zero-backed live data through the Zero runner", async () => {
    const zeroProvider = { ...registry.getProviders()[0], id: "zero-coin", authMode: "zeroxyz" as const,
      endpoint: "zero://coin", fieldMapping: { metric: "price", value: "$quote.price", unit: "USD", timestamp: "live" } };
    const zeroRunner = { fetch: async () => ({ quote: { price: 99 } }) };
    const engine = new NexlaIngestionEngine({ getProviders: () => [zeroProvider] }, { resources: [] }, async () => ({}), zeroRunner);
    const readings: Array<{ value: number; unit: string }> = [];
    engine.on("reading", (reading) => readings.push(reading as { value: number; unit: string }));
    await engine.pollOnce(zeroProvider);
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({ value: 99, unit: "USD" });
  });
});
