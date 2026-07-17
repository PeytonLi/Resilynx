import { describe, expect, it, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SmartHealerSession, type AgentCallbacks } from "./agent";
import type { ProviderRegistryEntry } from "./index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const base = resolve(import.meta.dir, "..", ".test-tmp");
  rmSync(base, { recursive: true, force: true });
  mkdirSync(resolve(base, "config"), { recursive: true });
  return base;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SmartHealerSession", () => {
  let originalCwd: string;
  let tmpDir: string;

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("patches registry with backup entry from backups.json", async () => {
    // Arrange: temp dir with mock config files
    tmpDir = makeTempDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    const providers: ProviderRegistryEntry[] = [
      {
        id: "mock-grid",
        displayName: "Mock Grid Provider",
        endpoint: "https://grid.example.com/api",
        authMode: "none",
        pollIntervalMs: 30000,
        fieldMapping: {
          metric: "grid_frequency",
          value: "frequency",
          unit: "Hz",
          timestamp: "ts",
        },
        priority: 5,
        enabled: true,
      },
    ];

    const backups: Record<string, ProviderRegistryEntry[]> = {
      grid_frequency: [
        {
          id: "mock-grid-entsoe-backup",
          displayName: "ENTSO-E Backup",
          endpoint: "https://entsoe.example.com/api",
          authMode: "none",
          pollIntervalMs: 60000,
          fieldMapping: {
            metric: "grid_frequency",
            value: "freq",
            unit: "Hz",
            timestamp: "time",
          },
          priority: 0,
          enabled: false,
        },
      ],
    };

    writeFileSync(
      resolve(tmpDir, "config", "providers.json"),
      JSON.stringify(providers, null, 2) + "\n",
      "utf-8",
    );
    writeFileSync(
      resolve(tmpDir, "config", "backups.json"),
      JSON.stringify(backups, null, 2) + "\n",
      "utf-8",
    );

    // Act
    const session = new SmartHealerSession();
    const states: string[] = [];
    const callbacks: AgentCallbacks = {
      onTurnStart: (s) => states.push(s),
      onTurnEnd: () => {},
    };

    await session.run(
      "Provider ID: mock-grid\nError Log: ECONNREFUSED\n",
      callbacks,
    );

    // Assert: callbacks fired in order
    expect(states).toEqual([
      "analysing",
      "reading-registry",
      "discovering-backup",
      "patching-registry",
    ]);

    // Assert: providers.json now contains the backup entry
    const { readFileSync } = await import("node:fs");
    const updatedRaw = readFileSync(
      resolve(tmpDir, "config", "providers.json"),
      "utf-8",
    );
    const updated: ProviderRegistryEntry[] = JSON.parse(updatedRaw);

    expect(updated.length).toBe(2);

    const backup = updated.find((e) => e.id === "mock-grid-entsoe-backup");
    expect(backup).toBeDefined();
    expect(backup!.priority).toBe(6); // failed entry priority 5 + 1
    expect(backup!.authMode).toBe("zeroxyz");
    expect(backup!.enabled).toBe(true);
  });

  it("does nothing when provider ID is missing from prompt", async () => {
    tmpDir = makeTempDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    writeFileSync(
      resolve(tmpDir, "config", "providers.json"),
      "[]\n",
      "utf-8",
    );

    const session = new SmartHealerSession();
    const states: string[] = [];
    const callbacks: AgentCallbacks = {
      onTurnStart: (s) => states.push(s),
      onTurnEnd: () => {},
    };

    await session.run("No provider ID here", callbacks);

    expect(states).toEqual(["analysing"]);
  });

  it("does nothing when provider not found in registry", async () => {
    tmpDir = makeTempDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    writeFileSync(
      resolve(tmpDir, "config", "providers.json"),
      "[]\n",
      "utf-8",
    );

    const session = new SmartHealerSession();
    const states: string[] = [];
    const callbacks: AgentCallbacks = {
      onTurnStart: (s) => states.push(s),
      onTurnEnd: () => {},
    };

    await session.run("Provider ID: unknown-id\nError Log: ...\n", callbacks);

    expect(states).toEqual(["analysing", "reading-registry"]);
  });

  it("does nothing when backups.json has no candidates for metric", async () => {
    tmpDir = makeTempDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    const providers: ProviderRegistryEntry[] = [
      {
        id: "mock-grid",
        displayName: "Mock Grid Provider",
        endpoint: "https://grid.example.com/api",
        authMode: "none",
        pollIntervalMs: 30000,
        fieldMapping: { metric: "unknown_metric", value: "x", unit: "x", timestamp: "ts" },
        priority: 5,
        enabled: true,
      },
    ];

    writeFileSync(
      resolve(tmpDir, "config", "providers.json"),
      JSON.stringify(providers, null, 2) + "\n",
      "utf-8",
    );
    writeFileSync(
      resolve(tmpDir, "config", "backups.json"),
      '{}\n',
      "utf-8",
    );

    const session = new SmartHealerSession();
    const states: string[] = [];
    const callbacks: AgentCallbacks = {
      onTurnStart: (s) => states.push(s),
      onTurnEnd: () => {},
    };

    await session.run("Provider ID: mock-grid\nError Log: ...\n", callbacks);

    expect(states).toEqual([
      "analysing",
      "reading-registry",
      "discovering-backup",
    ]);
  });
});
