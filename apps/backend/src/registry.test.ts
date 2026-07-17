import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ProviderRegistry } from "./registry";

const GOOD_CONFIG = [
  {
    id: "p1",
    displayName: "Provider One",
    endpoint: "http://localhost:4001/data",
    authMode: "none",
    pollIntervalMs: 1000,
    fieldMapping: { value: "a.b" },
    priority: 1,
    enabled: true,
  },
] as const;

function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (condition()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("timed out waiting for condition"));
      setTimeout(check, 20);
    };
    check();
  });
}

describe("ProviderRegistry", () => {
  let dir: string;
  let filePath: string;
  let registry: ProviderRegistry;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "resilynx-registry-"));
    filePath = path.join(dir, "providers.json");
    writeFileSync(filePath, JSON.stringify(GOOD_CONFIG));
    registry = new ProviderRegistry(filePath);
  });

  afterEach(() => {
    registry.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads a valid config and exposes it via getProviders()", async () => {
    await registry.load();
    expect(registry.getProviders()).toEqual(GOOD_CONFIG as never);
  });

  it("hot-reloads and emits a change event when the file is edited with a valid config", async () => {
    await registry.load();
    registry.watch();

    const updated = [{ ...GOOD_CONFIG[0], pollIntervalMs: 5000 }];
    let emitted: unknown;
    registry.on("change", (event) => (emitted = event));

    writeFileSync(filePath, JSON.stringify(updated));

    await waitFor(() => registry.getProviders()[0]?.pollIntervalMs === 5000);
    expect(registry.getProviders()).toEqual(updated as never);
    expect(emitted).toHaveProperty("providers");
    expect(emitted).toHaveProperty("timestamp");
    expect((emitted as { providers: unknown }).providers).toEqual(updated as never);
  });

  it("rejects an invalid edit (bad JSON) and keeps the last good config", async () => {
    await registry.load();
    registry.watch();

    writeFileSync(filePath, "{ not valid json");
    // give the watcher time to fire and reject
    await new Promise((r) => setTimeout(r, 200));

    expect(registry.getProviders()).toEqual(GOOD_CONFIG as never);
  });

  it("rejects an invalid edit (bad shape) and keeps the last good config", async () => {
    await registry.load();
    registry.watch();

    writeFileSync(filePath, JSON.stringify([{ id: "missing-fields" }]));
    await new Promise((r) => setTimeout(r, 200));

    expect(registry.getProviders()).toEqual(GOOD_CONFIG as never);
  });

  it("debounces rapid file edits into a single change event", async () => {
    await registry.load();
    registry.watch();

    const events: unknown[] = [];
    registry.on("change", (e) => events.push(e));

    // 3 rapid edits, each with different pollIntervalMs
    writeFileSync(filePath, JSON.stringify([{ ...GOOD_CONFIG[0], pollIntervalMs: 100 }]));
    writeFileSync(filePath, JSON.stringify([{ ...GOOD_CONFIG[0], pollIntervalMs: 200 }]));
    writeFileSync(filePath, JSON.stringify([{ ...GOOD_CONFIG[0], pollIntervalMs: 300 }]));

    // Wait long enough for debounce (25ms) + fs watch latency
    await waitFor(() => registry.getProviders()[0]?.pollIntervalMs === 300);

    // Only one change event, and providers reflect the LAST edit (300)
    expect(events.length).toBe(1);
    expect(registry.getProviders()[0]?.pollIntervalMs).toBe(300);
  });
});
