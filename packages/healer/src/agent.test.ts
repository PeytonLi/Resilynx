import { describe, expect, it, afterEach } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { SmartHealerSession, ZeroHealerSession, type AgentCallbacks } from "./agent";
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

  // --- Backup entry structure validation ---

  it("backup entry has correct fieldMapping from backups.json", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "healer-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    mkdirSync(join(tmpDir, "config"), { recursive: true });

    const providers: ProviderRegistryEntry[] = [
      {
        id: "mock-grid",
        displayName: "Mock Grid Provider",
        endpoint: "https://grid.example.com/api",
        authMode: "none",
        pollIntervalMs: 30000,
        fieldMapping: { metric: "grid_frequency", value: "freq", unit: "Hz", timestamp: "ts" },
        priority: 5,
        enabled: true,
      },
    ];

    const expectedMapping = {
      metric: "grid_frequency",
      value: "freq_hz",
      unit: "mHz",
      timestamp: "time_ms",
    };

    const backups: Record<string, ProviderRegistryEntry[]> = {
      grid_frequency: [
        {
          id: "mock-grid-backup",
          displayName: "Backup Grid",
          endpoint: "https://backup.example.com/api",
          authMode: "none",
          pollIntervalMs: 60000,
          fieldMapping: expectedMapping,
          priority: 0,
          enabled: false,
        },
      ],
    };

    writeFileSync(join(tmpDir, "config", "providers.json"), JSON.stringify(providers, null, 2) + "\n", "utf-8");
    writeFileSync(join(tmpDir, "config", "backups.json"), JSON.stringify(backups, null, 2) + "\n", "utf-8");

    const session = new SmartHealerSession();
    await session.run("Provider ID: mock-grid\nError Log: ECONNREFUSED\n", {
      onTurnStart: () => {},
      onTurnEnd: () => {},
    });

    const updated: ProviderRegistryEntry[] = JSON.parse(
      readFileSync(join(tmpDir, "config", "providers.json"), "utf-8"),
    );
    const backup = updated.find((e) => e.id === "mock-grid-backup")!;
    expect(backup.fieldMapping).toEqual(expectedMapping);
  });

  it("backup entry has priority = failed entry priority + 1", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "healer-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    mkdirSync(join(tmpDir, "config"), { recursive: true });

    const providers: ProviderRegistryEntry[] = [
      {
        id: "mock-grid",
        displayName: "Mock Grid Provider",
        endpoint: "https://grid.example.com/api",
        authMode: "none",
        pollIntervalMs: 30000,
        fieldMapping: { metric: "grid_frequency", value: "freq", unit: "Hz", timestamp: "ts" },
        priority: 7,
        enabled: true,
      },
    ];

    const backups: Record<string, ProviderRegistryEntry[]> = {
      grid_frequency: [
        {
          id: "mock-grid-backup",
          displayName: "Backup Grid",
          endpoint: "https://backup.example.com/api",
          authMode: "none",
          pollIntervalMs: 60000,
          fieldMapping: { metric: "grid_frequency", value: "x", unit: "Hz", timestamp: "ts" },
          priority: 0,
          enabled: false,
        },
      ],
    };

    writeFileSync(join(tmpDir, "config", "providers.json"), JSON.stringify(providers, null, 2) + "\n", "utf-8");
    writeFileSync(join(tmpDir, "config", "backups.json"), JSON.stringify(backups, null, 2) + "\n", "utf-8");

    const session = new SmartHealerSession();
    await session.run("Provider ID: mock-grid\nError Log: ECONNREFUSED\n", {
      onTurnStart: () => {},
      onTurnEnd: () => {},
    });

    const updated: ProviderRegistryEntry[] = JSON.parse(
      readFileSync(join(tmpDir, "config", "providers.json"), "utf-8"),
    );
    const backup = updated.find((e) => e.id === "mock-grid-backup")!;
    expect(backup.priority).toBe(8);
  });

  it("backup entry has authMode set to zeroxyz regardless of original", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "healer-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    mkdirSync(join(tmpDir, "config"), { recursive: true });

    const providers: ProviderRegistryEntry[] = [
      {
        id: "mock-grid",
        displayName: "Mock Grid Provider",
        endpoint: "https://grid.example.com/api",
        authMode: "none",
        pollIntervalMs: 30000,
        fieldMapping: { metric: "grid_frequency", value: "freq", unit: "Hz", timestamp: "ts" },
        priority: 5,
        enabled: true,
      },
    ];

    const backups: Record<string, ProviderRegistryEntry[]> = {
      grid_frequency: [
        {
          id: "mock-grid-backup",
          displayName: "Backup Grid",
          endpoint: "https://backup.example.com/api",
          authMode: "none",
          pollIntervalMs: 60000,
          fieldMapping: { metric: "grid_frequency", value: "x", unit: "Hz", timestamp: "ts" },
          priority: 0,
          enabled: false,
        },
      ],
    };

    writeFileSync(join(tmpDir, "config", "providers.json"), JSON.stringify(providers, null, 2) + "\n", "utf-8");
    writeFileSync(join(tmpDir, "config", "backups.json"), JSON.stringify(backups, null, 2) + "\n", "utf-8");

    const session = new SmartHealerSession();
    await session.run("Provider ID: mock-grid\nError Log: ECONNREFUSED\n", {
      onTurnStart: () => {},
      onTurnEnd: () => {},
    });

    const updated: ProviderRegistryEntry[] = JSON.parse(
      readFileSync(join(tmpDir, "config", "providers.json"), "utf-8"),
    );
    const backup = updated.find((e) => e.id === "mock-grid-backup")!;
    expect(backup.authMode).toBe("zeroxyz");
  });

  it("backup entry has enabled set to true", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "healer-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    mkdirSync(join(tmpDir, "config"), { recursive: true });

    const providers: ProviderRegistryEntry[] = [
      {
        id: "mock-grid",
        displayName: "Mock Grid Provider",
        endpoint: "https://grid.example.com/api",
        authMode: "none",
        pollIntervalMs: 30000,
        fieldMapping: { metric: "grid_frequency", value: "freq", unit: "Hz", timestamp: "ts" },
        priority: 5,
        enabled: true,
      },
    ];

    const backups: Record<string, ProviderRegistryEntry[]> = {
      grid_frequency: [
        {
          id: "mock-grid-backup",
          displayName: "Backup Grid",
          endpoint: "https://backup.example.com/api",
          authMode: "none",
          pollIntervalMs: 60000,
          fieldMapping: { metric: "grid_frequency", value: "x", unit: "Hz", timestamp: "ts" },
          priority: 0,
          enabled: false,
        },
      ],
    };

    writeFileSync(join(tmpDir, "config", "providers.json"), JSON.stringify(providers, null, 2) + "\n", "utf-8");
    writeFileSync(join(tmpDir, "config", "backups.json"), JSON.stringify(backups, null, 2) + "\n", "utf-8");

    const session = new SmartHealerSession();
    await session.run("Provider ID: mock-grid\nError Log: ECONNREFUSED\n", {
      onTurnStart: () => {},
      onTurnEnd: () => {},
    });

    const updated: ProviderRegistryEntry[] = JSON.parse(
      readFileSync(join(tmpDir, "config", "providers.json"), "utf-8"),
    );
    const backup = updated.find((e) => e.id === "mock-grid-backup")!;
    expect(backup.enabled).toBe(true);
  });

  it("does not add duplicate backup entries", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "healer-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    mkdirSync(join(tmpDir, "config"), { recursive: true });

    const providers: ProviderRegistryEntry[] = [
      {
        id: "mock-grid",
        displayName: "Mock Grid Provider",
        endpoint: "https://grid.example.com/api",
        authMode: "none",
        pollIntervalMs: 30000,
        fieldMapping: { metric: "grid_frequency", value: "freq", unit: "Hz", timestamp: "ts" },
        priority: 5,
        enabled: true,
      },
    ];

    const backups: Record<string, ProviderRegistryEntry[]> = {
      grid_frequency: [
        {
          id: "mock-grid-backup",
          displayName: "Backup Grid",
          endpoint: "https://backup.example.com/api",
          authMode: "none",
          pollIntervalMs: 60000,
          fieldMapping: { metric: "grid_frequency", value: "x", unit: "Hz", timestamp: "ts" },
          priority: 0,
          enabled: false,
        },
      ],
    };

    writeFileSync(join(tmpDir, "config", "providers.json"), JSON.stringify(providers, null, 2) + "\n", "utf-8");
    writeFileSync(join(tmpDir, "config", "backups.json"), JSON.stringify(backups, null, 2) + "\n", "utf-8");

    const prompt = "Provider ID: mock-grid\nError Log: ECONNREFUSED\n";
    const noop = { onTurnStart: () => {}, onTurnEnd: () => {} };

    // First heal: adds the backup
    await new SmartHealerSession().run(prompt, noop);
    // Second heal: should skip duplicate
    await new SmartHealerSession().run(prompt, noop);

    const updated: ProviderRegistryEntry[] = JSON.parse(
      readFileSync(join(tmpDir, "config", "providers.json"), "utf-8"),
    );
    const duplicateEntries = updated.filter((e) => e.id === "mock-grid-backup");
    expect(duplicateEntries.length).toBe(1);
  });

  // --- Lifecycle callback order ---

  it("calls lifecycle callbacks in exact order", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "healer-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    mkdirSync(join(tmpDir, "config"), { recursive: true });

    const providers: ProviderRegistryEntry[] = [
      {
        id: "mock-grid",
        displayName: "Mock Grid Provider",
        endpoint: "https://grid.example.com/api",
        authMode: "none",
        pollIntervalMs: 30000,
        fieldMapping: { metric: "grid_frequency", value: "freq", unit: "Hz", timestamp: "ts" },
        priority: 5,
        enabled: true,
      },
    ];

    const backups: Record<string, ProviderRegistryEntry[]> = {
      grid_frequency: [
        {
          id: "mock-grid-backup",
          displayName: "Backup Grid",
          endpoint: "https://backup.example.com/api",
          authMode: "none",
          pollIntervalMs: 60000,
          fieldMapping: { metric: "grid_frequency", value: "x", unit: "Hz", timestamp: "ts" },
          priority: 0,
          enabled: false,
        },
      ],
    };

    writeFileSync(join(tmpDir, "config", "providers.json"), JSON.stringify(providers, null, 2) + "\n", "utf-8");
    writeFileSync(join(tmpDir, "config", "backups.json"), JSON.stringify(backups, null, 2) + "\n", "utf-8");

    const session = new SmartHealerSession();
    const order: string[] = [];
    await session.run("Provider ID: mock-grid\nError Log: ECONNREFUSED\n", {
      onTurnStart: (s) => order.push(s),
      onTurnEnd: () => {},
    });

    expect(order).toEqual([
      "analysing",
      "reading-registry",
      "discovering-backup",
      "patching-registry",
    ]);
  });
});

describe("ZeroHealerSession", () => {
  it("validates a live Zero result before atomically adding the candidate", async () => {
    const tmpDir = makeTempDir();
    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      writeFileSync(resolve(tmpDir, "config", "providers.json"), JSON.stringify([{
        id: "weather", displayName: "Weather", endpoint: "https://example.com", authMode: "none",
        pollIntervalMs: 60_000, fieldMapping: { metric: "temperature" }, priority: 1, enabled: true,
      }]), "utf-8");
      const runner = {
        discover: async () => ({ id: "zero-weather", displayName: "Zero Weather", endpoint: "zero://weather", authMode: "zeroxyz" as const,
          pollIntervalMs: 300_000, fieldMapping: { metric: "temperature", value: "$value", unit: "C", timestamp: "live" }, priority: 2, enabled: true }),
        fetch: async () => ({ value: 19 }),
      };
      const session = new ZeroHealerSession(runner);
      await session.run("Provider ID: weather\nError Log: timeout", { onTurnStart: () => {}, onTurnEnd: () => {} });
      const entries = JSON.parse(readFileSync(resolve(tmpDir, "config", "providers.json"), "utf-8"));
      expect(entries).toHaveLength(2);
      expect(entries[1].endpoint).toBe("zero://weather");
    } finally {
      process.chdir(originalCwd);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
