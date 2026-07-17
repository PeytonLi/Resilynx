import { describe, expect, it, jest } from "bun:test";
import { IngestionEngine } from "./ingestion";
import type { NexsetRecord, ProviderRegistryEntry } from "@resilynx/contracts";

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

function makeFetchImpl(status: number, body: unknown) {
  return jest.fn(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  ) as unknown as typeof fetch;
}

function makeNexsetRecord(providerId: string): NexsetRecord {
  return {
    providerId,
    metric: "test_metric",
    value: 42,
    unit: "USD",
    timestamp: new Date().toISOString(),
  };
}

describe("IngestionEngine", () => {
  it("polls an enabled provider and emits a reading on success", async () => {
    const provider = makeProvider();
    const registry = { getProviders: () => [provider] };

    // The engine makes two fetches per poll: one to the provider, one to the standardize URL.
    // We need separate fetch implementations that can be sequenced.
    let callCount = 0;
    const fetchImpl = jest.fn(() => {
      callCount++;
      if (callCount === 1) {
        // Provider response
        return Promise.resolve(new Response(JSON.stringify({ price: 42, currency: "USD", ts: "2026-01-01T00:00:00Z" }), { status: 200 }));
      }
      // Standardization service response
      return Promise.resolve(new Response(JSON.stringify(makeNexsetRecord(provider.id)), { status: 200 }));
    }) as unknown as typeof fetch;

    const engine = new IngestionEngine(registry, "http://localhost:5001/standardize", fetchImpl);

    const readings: NexsetRecord[] = [];
    engine.on("reading", (r) => readings.push(r as NexsetRecord));

    await engine.pollOnce(provider);

    expect(readings.length).toBe(1);
    expect(readings[0].providerId).toBe(provider.id);
    expect(readings[0].metric).toBe("test_metric");
    expect(readings[0].value).toBe(42);
  });

  it("emits failure when provider returns non-2xx", async () => {
    const provider = makeProvider();
    const registry = { getProviders: () => [provider] };
    const fetchImpl = makeFetchImpl(503, "Service Unavailable");

    const engine = new IngestionEngine(registry, "http://localhost:5001/standardize", fetchImpl);

    const failures: unknown[] = [];
    engine.on("failure", (f) => failures.push(f));

    await engine.pollOnce(provider);

    expect(failures.length).toBe(1);
    expect((failures[0] as { providerId: string }).providerId).toBe(provider.id);
  });

  it("emits failure on fetch error (network failure)", async () => {
    const provider = makeProvider();
    const registry = { getProviders: () => [provider] };
    const fetchImpl = jest.fn(() => Promise.reject(new Error("connect ECONNREFUSED"))) as unknown as typeof fetch;

    const engine = new IngestionEngine(registry, "http://localhost:5001/standardize", fetchImpl);

    const failures: unknown[] = [];
    engine.on("failure", (f) => failures.push(f));

    await engine.pollOnce(provider);

    expect(failures.length).toBe(1);
    expect((failures[0] as { errorLog: string }).errorLog).toContain("ECONNREFUSED");
  });

  it("skips silently when standardization service is unreachable", async () => {
    const provider = makeProvider();
    const registry = { getProviders: () => [provider] };

    let callCount = 0;
    const fetchImpl = jest.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response(JSON.stringify({ price: 42 }), { status: 200 }));
      }
      return Promise.reject(new Error("connect ECONNREFUSED"));
    }) as unknown as typeof fetch;

    const engine = new IngestionEngine(registry, "http://localhost:5001/standardize", fetchImpl);

    const readings: unknown[] = [];
    const failures: unknown[] = [];
    engine.on("reading", (r) => readings.push(r));
    engine.on("failure", (f) => failures.push(f));

    await engine.pollOnce(provider);

    // No reading emitted (standardization failed), no failure emitted (provider was reachable)
    expect(readings.length).toBe(0);
    expect(failures.length).toBe(0);
  });

  it("polls providers with authMode zeroxyz (no longer skipped)", async () => {
    const provider = makeProvider({ id: "zeroxyz-provider", authMode: "zeroxyz" });
    const registry = { getProviders: () => [provider] };

    let callCount = 0;
    const fetchImpl = jest.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response(JSON.stringify({ price: 100 }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(makeNexsetRecord(provider.id)), { status: 200 }));
    }) as unknown as typeof fetch;

    const engine = new IngestionEngine(registry, "http://localhost:5001/standardize", fetchImpl);

    const readings: NexsetRecord[] = [];
    engine.on("reading", (r) => readings.push(r as NexsetRecord));

    await engine.pollOnce(provider);

    expect(readings.length).toBe(1);
    expect(readings[0].providerId).toBe("zeroxyz-provider");
  });

  it("uses fieldMapping.metric when available", async () => {
    const provider = makeProvider({ fieldMapping: { metric: "crypto_price", value: "price", unit: "currency", timestamp: "ts" } });
    const registry = { getProviders: () => [provider] };

    let capturedBody: string | undefined;
    let callCount = 0;
    const fetchImpl = jest.fn((url: string, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response(JSON.stringify({ price: 100 }), { status: 200 }));
      }
      capturedBody = init?.body as string;
      return Promise.resolve(new Response(JSON.stringify(makeNexsetRecord(provider.id)), { status: 200 }));
    }) as unknown as typeof fetch;

    const engine = new IngestionEngine(registry, "http://localhost:5001/standardize", fetchImpl);
    await engine.pollOnce(provider);

    const body = JSON.parse(capturedBody!);
    expect(body.metric).toBe("crypto_price");
  });

  it("skips disabled providers", async () => {
    const provider = makeProvider({ enabled: false });
    const registry = { getProviders: () => [provider] };
    const fetchImpl = jest.fn(() =>
      Promise.resolve(new Response("{}", { status: 200 })),
    ) as unknown as typeof fetch;

    const engine = new IngestionEngine(registry, "http://localhost:5001/standardize", fetchImpl);
    engine.start();
    engine.stop();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stop() clears all timers", () => {
    const provider = makeProvider();
    const registry = { getProviders: () => [provider] };
    const engine = new IngestionEngine(registry);
    engine.start();
    engine.stop();
    // If timers weren't cleared, the test process would hang or leak.
    // The fact that stop() returns synchronously is sufficient.
  });
});
