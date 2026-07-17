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

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { FailureEvent, ProviderRegistryEntry } from "./index";

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
