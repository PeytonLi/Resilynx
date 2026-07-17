/**
 * @resilynx/healer — Healing Orchestrator (Pi Agent embedded via native SDK).
 *
 * On `heal(failure)` the orchestrator immediately emits a `healing` event,
 * spawns an agent session that diagnoses the failure, discovers a backup
 * provider via Zero.xyz, and patches `config/providers.json`.  Agent
 * lifecycle boundaries emit `agent-activity` (turn_start) and `restored`
 * (agent_end).
 *
 * When the Pi Agent SDK is unavailable the orchestrator falls back to a
 * simulated agent session that demonstrates the same flow without any
 * external LLM dependency.
 */

import { EventEmitter } from "node:events";
import type {
  NetworkStatus,
  ProviderRegistryEntry,
  WsPayload,
} from "@resilynx/contracts";
import {
  ZeroHealerSession,
  SmartHealerSession,
  type AgentSession,
} from "./agent";
import { ZeroAgentRunner } from "./zero";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Failure context injected into the healing agent's prompt when it wakes. */
export interface FailureEvent {
  providerId: string;
  errorLog: string;
  consecutiveFailures: number;
  timestamp: string;
}

/** Re-export the registry entry shape so consumers need only one import. */
export type { ProviderRegistryEntry, WsPayload };
export type { ZeroRunner } from "./zero";
export { ZeroAgentRunner } from "./zero";
export { SmartHealerSession, ZeroHealerSession } from "./agent";

export type HealerEventName = "healing" | "restored" | "agent-activity";

// ---------------------------------------------------------------------------
// Prompt template
// ---------------------------------------------------------------------------

function buildAgentPrompt(failure: FailureEvent): string {
  return [
    "You are the Resilynx Healing Orchestrator (Pi Agent).",
    "Your task is to restore service after a provider failure.",
    "",
    "## Failure Context",
    `Provider ID: ${failure.providerId}`,
    `Error Log: ${failure.errorLog}`,
    `Consecutive Failures: ${failure.consecutiveFailures}`,
    `Timestamp: ${failure.timestamp}`,
    "",
    "## Instructions",
    "1. Read the current provider registry from config/providers.json",
    "2. Analyze the error log to determine what failed",
    "3. Search for a backup provider for the same data type via Zero.xyz",
    "4. Write a new enabled entry to config/providers.json with the backup endpoint,",
    "   field mapping, and auth mode \"zeroxyz\"",
    "5. Priority should be 1 below the failed provider (so next poll cycle",
    "   picks it up)",
    "",
    "## Edit Restrictions",
    "You may ONLY edit config/providers.json. No other files may be modified.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Healer
// ---------------------------------------------------------------------------

const NODE_ID = "healer";

/** Build a WsPayload-shaped event payload. */
function wsPayload(
  status: NetworkStatus,
  overrides?: { agentState?: string; message?: string },
): WsPayload {
  return {
    status,
    nodeId: NODE_ID,
    agentState: overrides?.agentState,
    message: overrides?.message,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Orchestrates a healing run for a failed provider and emits lifecycle
 * events (`healing`, `agent-activity`, `restored`) the backend
 * rebroadcasts over the `aegis-events` WebSocket channel.
 *
 * The agent session is injectable so tests can substitute a fully stubbed
 * implementation that never touches the filesystem.
 */
export class Healer extends EventEmitter {
  private agent: AgentSession;

  constructor(agent?: AgentSession) {
    super();
    this.agent = agent ?? new ZeroHealerSession(new ZeroAgentRunner(), new SmartHealerSession());
  }

  /**
   * Wake the healing agent.  Emits `healing` immediately, then runs the
   * agent session which emits `agent-activity` at each turn boundary and
   * `restored` when the session completes (success or failure).
   */
  async heal(failure: FailureEvent): Promise<void> {
    // 1. Signal that healing has begun.
    this.emit(
      "healing",
      wsPayload("healing", {
        message: `Healing started for provider ${failure.providerId}`,
      }),
    );

    // 2. Build the agent prompt with the failure context injected.
    const prompt = buildAgentPrompt(failure);

    // 3. Run the agent session, binding lifecycle events.
    try {
      await this.agent.run(prompt, {
        onTurnStart: (state: string) => {
          this.emit(
            "agent-activity",
            wsPayload("healing", { agentState: state }),
          );
        },
        onTurnEnd: () => {},
      });

      // After agent completes, surface any discovery message
      if ("discoveryMessage" in this.agent) {
        const msg = (this.agent as { discoveryMessage?: string }).discoveryMessage;
        if (msg) {
          this.emit(
            "agent-activity",
            wsPayload("healing", { agentState: "discovery-result", message: msg }),
          );
        }
      }
    } catch {
      // Agent session crashed — `restored` still fires in `finally`.
    } finally {
      // 4. Always signal completion so the backend can transition.
      this.emit(
        "restored",
        wsPayload("restored", {
          message: `Healing complete for provider ${failure.providerId}`,
        }),
      );
    }
  }
}
