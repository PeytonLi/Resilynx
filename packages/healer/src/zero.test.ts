import { describe, expect, it } from "bun:test";
import { ZeroAgentRunner } from "./zero";

/** Returns a mock runZero that responds to search/get/fetch commands. */
function mockZero(handlers: Record<string, string>) {
  return async (args: string[]): Promise<string> => {
    const cmd = args[0];
    const key = cmd === "search" ? `search:${args[1]}` : cmd === "get" ? `get:${args[1]}` : cmd;
    const response = handlers[key] ?? handlers[cmd];
    if (!response) throw new Error(`Unmocked zero ${cmd} ${args.slice(1).join(" ")}`);
    return response;
  };
}

describe("ZeroAgentRunner", () => {
  it("discovers a backup provider via search + get", async () => {
    const runZero = mockZero({
      "search:real-time weather temperature API": JSON.stringify({
        capabilities: [
          {
            token: "z_Test.1",
            slug: "weather-api-test",
            name: "Test Weather API",
            canonicalName: "Test Weather API",
            description: "Weather data",
            url: "https://weather.example.com/current",
            method: "GET",
            cost: { amount: "0.01", asset: "USDC" },
            availabilityStatus: "healthy",
          },
        ],
        total: 1,
      }),
      "get:z_Test.1": JSON.stringify({
        slug: "weather-api-test",
        name: "Test Weather API",
        canonicalName: "Test Weather API",
        description: "Weather data",
        url: "https://weather.example.com/current",
        method: "GET",
        bodySchema: {},
        responseSchema: null,
        availabilityStatus: "healthy",
        displayCostAmount: "0.01",
        displayCostAsset: "USDC",
      }),
    });

    const runner = new ZeroAgentRunner({ maxPerCallUsd: 0.05, runZero });
    const candidate = await runner.discover({
      id: "weather",
      displayName: "Weather",
      endpoint: "https://example.com",
      authMode: "none",
      pollIntervalMs: 60_000,
      fieldMapping: { metric: "temperature" },
      priority: 1,
      enabled: true,
    });

    expect(candidate.id).toBe("weather-zero-backup");
    expect(candidate.endpoint).toBe("https://weather.example.com/current");
    expect(candidate.authMode).toBe("zeroxyz");
    expect(candidate.enabled).toBe(false);
    expect(candidate.pollIntervalMs).toBe(300_000);
    expect(candidate.priority).toBe(2);
  });

  it("throws when Zero search returns no results", async () => {
    const runZero = mockZero({
      "search:real-time weather temperature API": JSON.stringify({ capabilities: [], total: 0 }),
    });

    const runner = new ZeroAgentRunner({ runZero });
    await expect(runner.discover({
      id: "unknown", displayName: "Unknown", endpoint: "https://x.com",
      authMode: "none", pollIntervalMs: 60_000,
      fieldMapping: { metric: "temperature" }, priority: 1, enabled: true,
    })).rejects.toThrow("no results");
  });

  it("throws when no healthy GET candidates found", async () => {
    const runZero = mockZero({
      "search:real-time weather temperature API": JSON.stringify({
        capabilities: [{
          token: "z_Bad.1", slug: "bad", name: "Bad", canonicalName: "Bad",
          description: "", url: "https://bad.com", method: "POST",
          cost: { amount: "1", asset: "USDC" }, availabilityStatus: "unhealthy",
        }],
        total: 1,
      }),
    });

    const runner = new ZeroAgentRunner({ runZero });
    await expect(runner.discover({
      id: "weather", displayName: "Weather", endpoint: "https://x.com",
      authMode: "none", pollIntervalMs: 60_000,
      fieldMapping: { metric: "temperature" }, priority: 1, enabled: true,
    })).rejects.toThrow("healthy GET");
  });

  it("throws when cost exceeds maxPerCallUsd", async () => {
    const runZero = mockZero({
      "search:real-time weather temperature API": JSON.stringify({
        capabilities: [{
          token: "z_Exp.1", slug: "expensive", name: "Expensive", canonicalName: "Expensive",
          description: "", url: "https://exp.com", method: "GET",
          cost: { amount: "5.00", asset: "USDC" }, availabilityStatus: "healthy",
        }],
        total: 1,
      }),
      "get:z_Exp.1": JSON.stringify({
        slug: "expensive", name: "Expensive", canonicalName: "Expensive",
        description: "", url: "https://exp.com", method: "GET",
        bodySchema: {}, responseSchema: null, availabilityStatus: "healthy",
        displayCostAmount: "5.00", displayCostAsset: "USDC",
      }),
    });

    const runner = new ZeroAgentRunner({ maxPerCallUsd: 0.05, runZero });
    await expect(runner.discover({
      id: "weather", displayName: "Weather", endpoint: "https://x.com",
      authMode: "none", pollIntervalMs: 60_000,
      fieldMapping: { metric: "temperature" }, priority: 1, enabled: true,
    })).rejects.toThrow("exceeds max");
  });

  it("fetch returns response body on success", async () => {
    const runZero = mockZero({
      fetch: JSON.stringify({
        runId: "run_123",
        ok: true,
        status: 200,
        body: { temperature: 22.5 },
      }),
    });

    const runner = new ZeroAgentRunner({ runZero });
    const result = await runner.fetch({
      id: "weather-backup", displayName: "Weather", endpoint: "https://weather.com",
      authMode: "zeroxyz", pollIntervalMs: 60_000,
      fieldMapping: { metric: "temperature" }, priority: 2, enabled: false,
    });
    expect(result).toEqual({ temperature: 22.5 });
  });

  it("fetch throws when response is not ok", async () => {
    const runZero = mockZero({
      fetch: JSON.stringify({ runId: "run_123", ok: false, status: 503, body: null }),
    });

    const runner = new ZeroAgentRunner({ runZero });
    await expect(runner.fetch({
      id: "bad", displayName: "Bad", endpoint: "https://bad.com",
      authMode: "zeroxyz", pollIntervalMs: 60_000,
      fieldMapping: { metric: "x" }, priority: 1, enabled: false,
    })).rejects.toThrow("status 503");
  });

  it("maps unknown metrics to a generic search query", async () => {
    const runZero = mockZero({
      "search:real-time wind speed data API": JSON.stringify({
        capabilities: [{
          token: "z_Wind.1", slug: "wind", name: "Wind API", canonicalName: "Wind API",
          description: "", url: "https://wind.com", method: "GET",
          cost: { amount: "0.01", asset: "USDC" }, availabilityStatus: "healthy",
        }],
        total: 1,
      }),
      "get:z_Wind.1": JSON.stringify({
        slug: "wind", name: "Wind API", canonicalName: "Wind API",
        description: "", url: "https://wind.com", method: "GET",
        bodySchema: {}, responseSchema: null, availabilityStatus: "healthy",
        displayCostAmount: "0.01", displayCostAsset: "USDC",
      }),
    });

    const runner = new ZeroAgentRunner({ runZero });
    const candidate = await runner.discover({
      id: "wind-sensor", displayName: "Wind", endpoint: "https://x.com",
      authMode: "none", pollIntervalMs: 60_000,
      fieldMapping: { metric: "wind_speed" }, priority: 1, enabled: true,
    });

    expect(candidate.id).toBe("wind-sensor-zero-backup");
  });
});
