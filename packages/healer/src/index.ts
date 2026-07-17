/**
 * @resilynx/healer — public interface for the Healing Orchestrator.
 * This package only defines the contract; the healing-agent feature branch
 * implements the real Pi Agent (DeepSeek V3/R1, Zero.xyz backup discovery)
 * behind this same `Healer` surface.
 */
import { EventEmitter } from "node:events";

/** Failure context injected into the healing agent's prompt when it wakes. */
export interface FailureEvent {
  providerId: string;
  errorLog: string;
  consecutiveFailures: number;
  timestamp: string;
}

export type HealerEventName = "healing" | "restored" | "agent-activity";

/**
 * Orchestrates a healing run for a failed provider and emits lifecycle
 * events (`healing`, `restored`, `agent-activity`) the backend rebroadcasts
 * over the `aegis-events` WebSocket channel.
 */
export class Healer extends EventEmitter {
  async heal(failure: FailureEvent): Promise<void> {
    // TODO(healing-agent): replace with a real Pi Agent session that reads
    // the provider registry, discovers a backup via Zero.xyz, and patches
    // config/providers.json using its Read/Write/Edit/Bash tools.
    this.emit("healing", failure);
    this.emit("restored", failure);
  }
}
