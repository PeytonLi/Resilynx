/**
 * Ingestion engine — polls every enabled provider on its pollIntervalMs,
 * forwards the raw payload to the standardization service, and emits
 * "reading" (NexsetRecord) on success or "failure" (IngestionFailure) on
 * fetch error / non-2xx / timeout. If the standardization service itself is
 * unreachable that is logged and skipped — it is never counted as a
 * provider failure.
 */
import { EventEmitter } from "node:events";
import type { NexsetRecord, ProviderRegistryEntry } from "@resilynx/contracts";
import type { ZeroRunner } from "@resilynx/healer";

export interface IngestionFailure {
  providerId: string;
  errorLog: string;
  timestamp: string;
}

export interface RegistrySource {
  getProviders(): ProviderRegistryEntry[];
}

const DEFAULT_STANDARDIZE_URL = "http://localhost:5001/standardize";
const FETCH_TIMEOUT_MS = 10_000;

export class IngestionEngine extends EventEmitter {
  private timers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    private readonly registry: RegistrySource,
    private readonly standardizeUrl: string = DEFAULT_STANDARDIZE_URL,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly zeroRunner?: ZeroRunner,
  ) {
    super();
  }

  /** Starts a poll loop for every enabled, authMode:"none" provider currently in the registry. */
  start(): void {
    for (const provider of this.registry.getProviders()) {
      this.startProvider(provider);
    }
  }

  stop(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
  }

  /** Polls a single provider immediately, for tests that don't want to wait on a timer. */
  async pollOnce(provider: ProviderRegistryEntry): Promise<void> {
    await this.poll(provider);
  }

  private startProvider(provider: ProviderRegistryEntry): void {
    if (!provider.enabled) return;
    if (this.timers.has(provider.id)) return;
    const run = () => void this.poll(provider);
    run();
    this.timers.set(provider.id, setInterval(run, provider.pollIntervalMs));
  }

  private async poll(provider: ProviderRegistryEntry): Promise<void> {
    let payload: unknown;
    try {
      if (provider.authMode === "zeroxyz") {
        if (!this.zeroRunner) throw new Error("Zero runner is not configured");
        payload = await this.zeroRunner.fetch(provider);
      } else {
        const res = await this.fetchWithTimeout(provider.endpoint);
        if (!res.ok) {
          this.emitFailure(provider.id, `HTTP ${res.status} from ${provider.endpoint}`);
          return;
        }
        payload = await res.json();
      }
    } catch (err) {
      this.emitFailure(provider.id, `fetch error: ${(err as Error).message}`);
      return;
    }

    let record: NexsetRecord;
    try {
      const res = await this.fetchWithTimeout(this.standardizeUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: provider.id, metric: provider.fieldMapping.metric ?? provider.id, rawPayload: payload, fieldMapping: provider.fieldMapping }),
      });
      if (!res.ok) {
        console.warn(`[ingestion] standardization service returned ${res.status}; skipping ${provider.id} this cycle`);
        return;
      }
      record = (await res.json()) as NexsetRecord;
    } catch (err) {
      console.warn(`[ingestion] standardization service unreachable; skipping ${provider.id} this cycle: ${(err as Error).message}`);
      return;
    }

    // Timestamp smart injection — standardization may return non-standard timestamps
    const ts = record.timestamp;
    if (ts === "live" || ts === "now") {
      record.timestamp = new Date().toISOString();
    } else if (typeof ts === "number") {
      record.timestamp = new Date(ts).toISOString();
    } else if (typeof ts === "string") {
      const d = new Date(ts);
      if (isNaN(d.getTime())) {
        record.timestamp = new Date().toISOString();
      }
      // else keep the valid ISO string
    } else {
      record.timestamp = new Date().toISOString();
    }

    this.emit("reading", record);
  }

  private emitFailure(providerId: string, errorLog: string): void {
    const failure: IngestionFailure = { providerId, errorLog, timestamp: new Date().toISOString() };
    this.emit("failure", failure);
  }

  private async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
