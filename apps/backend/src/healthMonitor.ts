/**
 * Health monitor — consumes the ingestion failure stream. 3 consecutive
 * failures for a provider declares it down (emits "down") and calls
 * healer.heal(...) exactly once; a success resets the counter; no
 * re-trigger while a heal is in flight for that provider. Emits "stable"
 * on recovery or first-ever success (throttled — not every poll).
 */
import { EventEmitter } from "node:events";
import type { FailureEvent } from "@resilynx/healer";
import type { IngestionFailure } from "./ingestion";

export const FAILURE_THRESHOLD = 3;

/** Minimal shape the health monitor needs from a Healer — matches @resilynx/healer's Healer class. */
export interface HealerLike {
  heal(failure: FailureEvent): Promise<void>;
}

export class HealthMonitor extends EventEmitter {
  private readonly failureCounts = new Map<string, number>();
  private readonly healingInFlight = new Set<string>();
  private readonly seen = new Set<string>();

  constructor(private readonly healer: HealerLike) {
    super();
  }

  recordFailure(failure: IngestionFailure): void {
    const count = (this.failureCounts.get(failure.providerId) ?? 0) + 1;
    this.failureCounts.set(failure.providerId, count);

    if (count >= FAILURE_THRESHOLD && !this.healingInFlight.has(failure.providerId)) {
      this.healingInFlight.add(failure.providerId);
      this.emit("down", failure.providerId);

      const event: FailureEvent = {
        providerId: failure.providerId,
        errorLog: failure.errorLog,
        consecutiveFailures: count,
        timestamp: failure.timestamp,
      };
      void this.healer.heal(event).finally(() => {
        this.healingInFlight.delete(failure.providerId);
        this.failureCounts.set(failure.providerId, 0);
      });
    }
  }

  recordSuccess(providerId: string): void {
    const wasDegraded = (this.failureCounts.get(providerId) ?? 0) > 0;
    const firstSuccess = !this.seen.has(providerId);
    this.seen.add(providerId);
    this.failureCounts.set(providerId, 0);
    if (firstSuccess || wasDegraded) {
      this.emit("stable", providerId);
    }
  }
}
