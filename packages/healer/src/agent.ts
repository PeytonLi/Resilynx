/**
 * Agent session simulation for the Healing Orchestrator.
 *
 * Since the Pi Agent SDK (DeepSeek V3/R1) is not available at build time,
 * this module simulates the same lifecycle a real agent session would follow:
 * turn boundaries, prompt injection, tool-call routing, and edit-surface
 * enforcement (registry file only).
 *
 * The simulation is injectable: tests swap in a fully stubbed agent that
 * never touches the filesystem but still fires every lifecycle callback.
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import type { FailureEvent, ProviderRegistryEntry } from "./index";
import type { ZeroDiscoveryRunner } from "./zero";

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

/** Callbacks the agent fires at lifecycle boundaries. */
export interface AgentCallbacks {
  /** Called when the agent begins a new reasoning/action turn. */
  onTurnStart(state: string): void;
  /** Called when the agent finishes its session (success or failure). */
  onTurnEnd(): void;
}

/**
 * An agent session that receives a prompt and orchestrates tool calls
 * through its prescribed lifecycle.
 *
 * Real implementations (Pi Agent SDK, child-process CLI, HTTP bridge)
 * conform to this same interface so the Healer never changes.
 */
export interface AgentSession {
  run(prompt: string, callbacks: AgentCallbacks): Promise<void>;
}

// ---------------------------------------------------------------------------
// Simulated agent (no LLM dependency)
// ---------------------------------------------------------------------------

const REGISTRY_PATH = resolve(import.meta.dir, "../../../", "config", "providers.json");

function configPath(filename: string): string {
  const local = resolve("config", filename);
  return existsSync(local) ? local : resolve(import.meta.dir, "../../../", "config", filename);
}

/** Approximates what a real agent would do with the prompt instructions. */
export class SimulatedAgentSession implements AgentSession {
  async run(prompt: string, callbacks: AgentCallbacks): Promise<void> {
    // ---- Turn 1: analyse the failure ----
    callbacks.onTurnStart("analysing");

    const providerId = this.extractProviderId(prompt);
    const errorLog = this.extractErrorLog(prompt);

    if (!providerId && !errorLog) {
      // Nothing actionable — still signal end so the lifecycle is clean.
      callbacks.onTurnEnd();
      return;
    }

    // ---- Turn 2: read the registry ----
    callbacks.onTurnStart("reading-registry");

    const entries: ProviderRegistryEntry[] = this.readRegistry();
    const failedIndex = entries.findIndex((e) => e.id === providerId);
    if (failedIndex === -1) {
      // Failed provider not in registry — nothing to patch.
      callbacks.onTurnEnd();
      return;
    }

    const failedEntry = entries[failedIndex];
    if (failedEntry.authMode === "zeroxyz") {
      callbacks.onTurnEnd();
      return;
    }

    // ---- Turn 3: discover backup via Zero.xyz (simulated) ----
    callbacks.onTurnStart("discovering-backup");

    const backup = this.simulateZeroXyzDiscovery(failedEntry);
    if (entries.some((entry) => entry.id === backup.id)) {
      callbacks.onTurnEnd();
      return;
    }

    // ---- Turn 4: patch the registry ----
    callbacks.onTurnStart("patching-registry");

    // Priority = 1 below the failed provider so the next poll cycle picks it up.
    backup.priority = failedEntry.priority + 1;
    backup.authMode = "zeroxyz";

    entries.push(backup);
    this.writeRegistry(entries);

    // ---- Done ----
    callbacks.onTurnEnd();
  }

  // -------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------

  private extractProviderId(prompt: string): string | undefined {
    const m = prompt.match(/Provider ID:\s*(\S+)/);
    return m?.[1];
  }

  private extractErrorLog(prompt: string): string | undefined {
    const m = prompt.match(/Error Log:\s*(.+)/);
    return m?.[1];
  }

  private readRegistry(): ProviderRegistryEntry[] {
    if (!existsSync(REGISTRY_PATH)) return [];
    const raw = readFileSync(REGISTRY_PATH, "utf-8");
    return JSON.parse(raw) as ProviderRegistryEntry[];
  }

  private writeRegistry(entries: ProviderRegistryEntry[]): void {
    writeFileSync(REGISTRY_PATH, JSON.stringify(entries, null, 2) + "\n", "utf-8");
  }

  /**
   * Simulates a Zero.xyz provider discovery.
   *
   * In production the Pi Agent would call the Zero.xyz API or use the
   * Zero MCP server. Here we construct a plausible backup entry derived
   * from the failed provider's metadata.
   */
  private simulateZeroXyzDiscovery(
    failed: ProviderRegistryEntry,
  ): ProviderRegistryEntry {
    return {
      id: `${failed.id}-zeroxyz-backup`,
      displayName: `${failed.displayName} (Zero.xyz Backup)`,
      endpoint: `https://api.zero.xyz/v1/proxy/${failed.id}`,
      authMode: "zeroxyz",
      pollIntervalMs: failed.pollIntervalMs,
      fieldMapping: { ...failed.fieldMapping },
      priority: 0, // set by caller
      enabled: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Smart healer (reads real backups.json)
// ---------------------------------------------------------------------------

/** Reads the actual backups.json to discover a real backup provider. */
export class SmartHealerSession implements AgentSession {
  private readonly registryPath: string;
  private readonly backupsPath: string;

  constructor() {
    this.registryPath = configPath("providers.json");
    this.backupsPath = configPath("backups.json");
  }

  async run(prompt: string, callbacks: AgentCallbacks): Promise<void> {
    // 1. Extract failure context
    callbacks.onTurnStart("analysing");
    const providerId = this.extractProviderId(prompt);
    const errorLog = this.extractErrorLog(prompt);
    if (!providerId) { callbacks.onTurnEnd(); return; }

    // 2. Read current registry
    callbacks.onTurnStart("reading-registry");
    const registry = this.readRegistry();
    const failedEntry = registry.find(e => e.id === providerId);
    if (!failedEntry) { callbacks.onTurnEnd(); return; }

    // Determine the metric type of the failed provider
    const metric = failedEntry.fieldMapping?.metric ?? providerId;

    // 3. Discover backup from backups.json
    callbacks.onTurnStart("discovering-backup");
    const backups = this.readBackups();
    const candidates = backups[metric];
    if (!candidates || candidates.length === 0) {
      callbacks.onTurnEnd();
      return;
    }
    const backup = { ...candidates[0] }; // shallow clone

    // ponytail: if backup already registered, re-enable it
    const existing = registry.find(e => e.id === backup.id);
    if (existing) {
      existing.enabled = true;
      this.writeRegistry(registry);
      callbacks.onTurnEnd();
      return;
    }

    // 4. Patch registry
    callbacks.onTurnStart("patching-registry");
    backup.priority = failedEntry.priority + 1;
    backup.authMode = "zeroxyz";
    backup.enabled = true;
    registry.push(backup);
    this.writeRegistry(registry);

    callbacks.onTurnEnd();
  }

  private extractProviderId(prompt: string): string | undefined {
    const m = prompt.match(/Provider ID:\s*(\S+)/);
    return m?.[1];
  }

  private extractErrorLog(prompt: string): string | undefined {
    const m = prompt.match(/Error Log:\s*(.+)/);
    return m?.[1];
  }

  private readRegistry(): ProviderRegistryEntry[] {
    if (!existsSync(this.registryPath)) return [];
    const raw = readFileSync(this.registryPath, "utf-8");
    return JSON.parse(raw) as ProviderRegistryEntry[];
  }

  private readBackups(): Record<string, ProviderRegistryEntry[]> {
    if (!existsSync(this.backupsPath)) return {};
    const raw = readFileSync(this.backupsPath, "utf-8");
    return JSON.parse(raw) as Record<string, ProviderRegistryEntry[]>;
  }

  private writeRegistry(entries: ProviderRegistryEntry[]): void {
    writeFileSync(this.registryPath, JSON.stringify(entries, null, 2) + "\n", "utf-8");
  }
}

/** Uses real Zero.xyz CLI for provider discovery, falls back to static backups.json on error. */
export class ZeroHealerSession implements AgentSession {
  private readonly registryPath: string;
  /** Set during run() so the Healer can read the discovery result. */
  discoveryMessage: string | undefined;

  constructor(private readonly zero: ZeroDiscoveryRunner, private readonly fallback?: AgentSession) {
    this.registryPath = configPath("providers.json");
  }

  async run(prompt: string, callbacks: AgentCallbacks): Promise<void> {
    callbacks.onTurnStart("analysing");
    const providerId = prompt.match(/Provider ID:\s*(\S+)/)?.[1];
    if (!providerId) { callbacks.onTurnEnd(); return; }

    callbacks.onTurnStart("reading-registry");
    const entries = this.readRegistry();
    const failed = entries.find((entry) => entry.id === providerId);
    if (!failed) { callbacks.onTurnEnd(); return; }

    // Never heal zeroxyz providers — they're backups themselves. Only heal originals.
    if (failed.authMode === "zeroxyz") { callbacks.onTurnEnd(); return; }

    // Try Zero.xyz discovery
    let candidate: ProviderRegistryEntry;
    try {
      callbacks.onTurnStart("discovering-backup");
      candidate = await this.zero.discover(failed);

      // Backup already registered from a previous heal — enable it
      const existing = entries.find((entry) => entry.id === candidate.id);
      if (existing) {
        existing.enabled = true;
        this.writeRegistry(entries);
        this.discoveryMessage = `Re-enabled existing backup: ${candidate.displayName}`;
        callbacks.onTurnEnd();
        return;
      }
      this.discoveryMessage = `Discovered: ${candidate.displayName} — ${candidate.endpoint}`;
    } catch (error) {
      // Zero.xyz failed — fall back to static backups
      this.discoveryMessage = `Zero.xyz unavailable: ${(error as Error).message}. Falling back to static backups.`;
      if (this.fallback) return this.fallback.run(prompt, callbacks);
      callbacks.onTurnEnd();
      return;
    }

    callbacks.onTurnStart("patching-registry");
    // Always enable backup so ingestion polls it — ZeroAgentRunner sets enabled:false to avoid
    // costly auto-polling, but the healer overrides that since healing means we NEED the backup.
    entries.push({ ...candidate, priority: failed.priority + 1, enabled: true });
    const tempPath = `${this.registryPath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(entries, null, 2) + "\n", "utf-8");
    renameSync(tempPath, this.registryPath);
    callbacks.onTurnEnd();
  }

  private readRegistry(): ProviderRegistryEntry[] {
    if (!existsSync(this.registryPath)) return [];
    return JSON.parse(readFileSync(this.registryPath, "utf-8")) as ProviderRegistryEntry[];
  }

  private writeRegistry(entries: ProviderRegistryEntry[]): void {
    writeFileSync(this.registryPath, JSON.stringify(entries, null, 2) + "\n", "utf-8");
  }
}
