import { describe, expect, it, jest } from "bun:test";

// ---------------------------------------------------------------------------
// providers test — tests fetchProviders and the synchronous fallback array
// ---------------------------------------------------------------------------

describe("providers", () => {
  it("fallback array has 4 entries", async () => {
    const { providers: fallback } = await import("./providers");
    expect(fallback).toHaveLength(4);
    expect(fallback.map((p) => p.id)).toEqual([
      "open-meteo",
      "usgs-earthquake",
      "uk-carbon",
      "mock-grid",
    ]);
  });

  it("fetchProviders returns parsed JSON on success", async () => {
    const mockProviders = [
      {
        id: "test-provider",
        displayName: "Test Provider",
        endpoint: "http://localhost:4001/data",
        authMode: "none",
        pollIntervalMs: 15000,
        fieldMapping: { metric: "test" },
        priority: 1,
        enabled: true,
      },
    ];

    // @ts-expect-error: partial mock of global fetch
    globalThis.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockProviders),
      }),
    );

    const { fetchProviders } = await import("./providers");
    const result = await fetchProviders();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("test-provider");
    expect(fetch).toHaveBeenCalledWith("http://localhost:8080/providers");
  });

  it("fetchProviders returns fallback on fetch error", async () => {
    // @ts-expect-error: partial mock of global fetch
    globalThis.fetch = jest.fn(() => Promise.reject(new Error("ECONNREFUSED")));

    const { fetchProviders } = await import("./providers");
    const result = await fetchProviders();

    expect(result).toHaveLength(4);
    expect(result[0].id).toBe("open-meteo");
    expect(fetch).toHaveBeenCalledWith("http://localhost:8080/providers");
  });
});
