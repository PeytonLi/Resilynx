import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NexsetRecord, ProviderRegistryEntry } from "@resilynx/contracts";
import type { ZeroRunner } from "@resilynx/healer";
import type { IngestionFailure, RegistrySource } from "./ingestion";

export interface NexlaResource {
  providerId: string;
  sourceId: number;
  nexsetId: number;
  webhookUrl?: string;
}

export interface NexlaResourceManifest {
  resources: NexlaResource[];
}

const DEFAULT_MANIFEST_PATH = path.resolve(import.meta.dir, "../../../config/nexla-resources.json");

export function loadNexlaResources(filePath = process.env.NEXLA_RESOURCES_PATH ?? DEFAULT_MANIFEST_PATH): NexlaResourceManifest {
  if (!process.env.NEXLA_API_URL || !process.env.NEXLA_TOKEN) {
    console.warn("[nexla] NEXLA_API_URL and NEXLA_TOKEN not set — Nexla ingestion disabled");
    return { resources: [] };
  }
  if (!existsSync(filePath)) {
    console.warn(`[nexla] Resource manifest not found at ${filePath} — Nexla ingestion disabled`);
    return { resources: [] };
  }
  const manifest = JSON.parse(readFileSync(filePath, "utf8")) as NexlaResourceManifest;
  if (!Array.isArray(manifest.resources) || manifest.resources.some((resource) => !resource.providerId || !Number.isInteger(resource.nexsetId))) {
    throw new Error(`Invalid Nexla resource manifest at ${filePath}`);
  }
  return manifest;
}

export interface NexlaApi {
  getNexset(nexsetId: number): Promise<unknown>;
}

export class NexlaApiClient implements NexlaApi {
  private readonly baseUrl: string;

  constructor(
    apiUrl = process.env.NEXLA_API_URL,
    private readonly token = process.env.NEXLA_TOKEN,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiUrl || !token) throw new Error("NEXLA_API_URL and NEXLA_TOKEN are required");
    this.baseUrl = apiUrl.replace(/\/$/, "");
  }

  async getNexset(nexsetId: number): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}/nexla/nexsets/${nexsetId}`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) throw new Error(`Nexla API returned ${response.status}`);
    return response.json();
  }
}

function recordsFromResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  if (!result || typeof result !== "object") return [];
  const value = result as Record<string, unknown>;
  const samples = value.samples ?? value.items ?? value.data;
  if (Array.isArray(samples)) return samples.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  if (samples && typeof samples === "object") return recordsFromResult(samples);
  return [];
}

function toNexsetRecord(providerId: string, sample: Record<string, unknown>): NexsetRecord {
  const record = (sample.data && typeof sample.data === "object" ? sample.data : sample) as Record<string, unknown>;
  if (typeof record.metric !== "string" || typeof record.value !== "number" || typeof record.unit !== "string" || typeof record.timestamp !== "string") {
    throw new Error(`Nexla sample for ${providerId} does not match the Resilynx NexsetRecord transform`);
  }
  return { providerId, metric: record.metric, value: record.value, unit: record.unit, timestamp: record.timestamp, raw: record };
}

export class NexlaIngestionEngine extends EventEmitter {
  private timers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    private readonly registry: RegistrySource,
    private readonly resources: NexlaResourceManifest,
    private readonly api: NexlaApi = new NexlaApiClient(),
    private readonly zeroRunner?: ZeroRunner,
  ) { super(); }

  start(): void {
    for (const provider of this.registry.getProviders()) {
      if (!provider.enabled) continue;
      if (provider.authMode === "zeroxyz") {
        void this.pollZero(provider);
        this.timers.set(provider.id, setInterval(() => void this.pollZero(provider), provider.pollIntervalMs));
        continue;
      }
      const resource = this.resources.resources.find((item) => item.providerId === provider.id);
      if (!resource) {
        this.emitFailure(provider.id, "No Nexla resource is provisioned for this provider");
        continue;
      }
      void this.poll(provider, resource);
      this.timers.set(provider.id, setInterval(() => void this.poll(provider, resource), provider.pollIntervalMs));
    }
  }

  stop(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
  }

  async pollOnce(provider: ProviderRegistryEntry): Promise<void> {
    if (provider.authMode === "zeroxyz") return this.pollZero(provider);
    const resource = this.resources.resources.find((item) => item.providerId === provider.id);
    if (!resource) return this.emitFailure(provider.id, "No Nexla resource is provisioned for this provider");
    await this.poll(provider, resource);
  }

  private async poll(provider: ProviderRegistryEntry, resource: NexlaResource): Promise<void> {
    try {
      const result = await this.api.getNexset(resource.nexsetId);
      const sample = recordsFromResult(result).at(-1);
      if (!sample) throw new Error("Nexla Nexset has no samples yet");
      this.emit("reading", toNexsetRecord(provider.id, sample));
    } catch (error) {
      this.emitFailure(provider.id, `Nexla read failed: ${(error as Error).message}`);
    }
  }

  private async pollZero(provider: ProviderRegistryEntry): Promise<void> {
    try {
      if (!this.zeroRunner) throw new Error("Zero runner is not configured");
      const payload = await this.zeroRunner.fetch(provider);
      this.emit("reading", zeroRecord(provider, payload));
    } catch (error) {
      this.emitFailure(provider.id, `Zero read failed: ${(error as Error).message}`);
    }
  }

  private emitFailure(providerId: string, errorLog: string): void {
    this.emit("failure", { providerId, errorLog, timestamp: new Date().toISOString() } satisfies IngestionFailure);
  }
}

function zeroRecord(provider: ProviderRegistryEntry, payload: unknown): NexsetRecord {
  const raw = payload as Record<string, unknown>;
  const value = mapped(payload, provider.fieldMapping.value);
  const unit = mapped(payload, provider.fieldMapping.unit);
  const timestamp = mapped(payload, provider.fieldMapping.timestamp);
  if (typeof value !== "number" || typeof unit !== "string") throw new Error("Zero payload does not match its field mapping");
  return {
    providerId: provider.id,
    metric: provider.fieldMapping.metric ?? provider.id,
    value,
    unit,
    timestamp: timestamp === "live" ? new Date().toISOString() : String(timestamp),
    raw,
  };
}

function mapped(payload: unknown, mapping: string | undefined): unknown {
  if (!mapping) return undefined;
  if (!mapping.startsWith("$")) return mapping;
  return mapping.slice(1).split(".").reduce<unknown>((value, key) =>
    value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, payload);
}

export class MockWebhookRelay extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly webhookUrl: string, private readonly pollIntervalMs = 15_000, private readonly fetchImpl: typeof fetch = fetch) { super(); }

  start(): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async poll(): Promise<void> {
    try {
      const response = await this.fetchImpl("http://localhost:4001/data");
      if (!response.ok) throw new Error(`mock provider returned ${response.status}`);
      const payload = await response.json();
      const webhook = await this.fetchImpl(this.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!webhook.ok) throw new Error(`Nexla webhook returned ${webhook.status}`);
    } catch (error) {
      this.emit("failure", { providerId: "mock-exchange", errorLog: `Nexla webhook relay failed: ${(error as Error).message}`, timestamp: new Date().toISOString() } satisfies IngestionFailure);
    }
  }
}
