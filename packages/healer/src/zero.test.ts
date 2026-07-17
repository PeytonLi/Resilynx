import { describe, expect, it } from "bun:test";
import { ZeroAgentRunner } from "./zero";

describe("ZeroAgentRunner", () => {
  it("returns live data only when the quoted price fits the configured cap", async () => {
    const runner = new ZeroAgentRunner({
      maxPerCallUsd: 0.05,
      maxMonthlyUsd: 1,
      execute: async () => JSON.stringify({
        rawPayload: { current: { temperature: 19 } },
        perCallCostUsd: 0.01,
      }),
    });

    await expect(runner.fetch({
      id: "weather-backup",
      displayName: "Weather backup",
      endpoint: "zero://weather",
      authMode: "zeroxyz",
      pollIntervalMs: 300_000,
      fieldMapping: { metric: "temperature", value: "$current.temperature", unit: "C", timestamp: "live" },
      priority: 2,
      enabled: true,
    })).resolves.toEqual({ current: { temperature: 19 } });
  });

  it("rejects an unpriced or over-budget Zero call", async () => {
    const runner = new ZeroAgentRunner({
      maxPerCallUsd: 0.05,
      maxMonthlyUsd: 1,
      execute: async () => JSON.stringify({ rawPayload: {}, perCallCostUsd: 0.10 }),
    });

    await expect(runner.fetch({
      id: "weather-backup", displayName: "Weather backup", endpoint: "zero://weather",
      authMode: "zeroxyz", pollIntervalMs: 300_000,
      fieldMapping: { metric: "temperature", value: "$current.temperature", unit: "C", timestamp: "live" },
      priority: 2, enabled: true,
    })).rejects.toThrow("budget");
  });

  it("turns a priced Zero discovery into a five-minute provider", async () => {
    const runner = new ZeroAgentRunner({
      execute: async () => JSON.stringify({
        id: "zero-weather", displayName: "Zero Weather", serviceHint: "weather now",
        fieldMapping: { metric: "temperature", value: "$temperature", unit: "C", timestamp: "live" },
        perCallCostUsd: 0.01,
      }),
    });
    const candidate = await runner.discover({
      id: "weather", displayName: "Weather", endpoint: "https://example.com", authMode: "none",
      pollIntervalMs: 60_000, fieldMapping: { metric: "temperature" }, priority: 1, enabled: true,
    });

    expect(candidate.endpoint).toBe("zero://weather now");
    expect(candidate.pollIntervalMs).toBe(300_000);
  });
});
