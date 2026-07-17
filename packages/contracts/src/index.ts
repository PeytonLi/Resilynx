/**
 * @resilynx/contracts — the pinned shared types every Resilynx module builds against.
 * Keep this package small and stable; everything else may churn (see PRD.md).
 */

/** How the ingestion engine authenticates against a provider endpoint. */
export type AuthMode = "none" | "apiKey" | "bearer" | "zeroxyz";

/** One entry in the provider registry config file (config/providers.json). */
export interface ProviderRegistryEntry {
  id: string;
  displayName: string;
  endpoint: string;
  authMode: AuthMode;
  pollIntervalMs: number;
  /** Maps Nexset field name -> dot-path into the provider's raw payload. */
  fieldMapping: Record<string, string>;
  priority: number;
  enabled: boolean;
}

/** A standardized reading produced by the Nexla standardization service. */
export interface NexsetRecord {
  providerId: string;
  metric: string;
  value: number;
  unit: string;
  timestamp: string;
  raw?: Record<string, unknown>;
}

/** Network/node lifecycle states broadcast over the WebSocket channel. */
export type NetworkStatus = "stable" | "degraded" | "healing" | "restored";

/** Payload shape published on the `aegis-events` WebSocket channel. */
export interface WsPayload {
  status: NetworkStatus;
  nodeId: string;
  agentState?: string;
  message?: string;
  timestamp: string;
}

/** Global WebSocket pub/sub channel name all clients subscribe to. */
export const WS_CHANNEL = "aegis-events";

/** Fixed local ports for each service, so apps never guess each other's address. */
export const PORTS = {
  backend: 8080,
  frontend: 3000,
  mockProvider: 4001,
  nexlaService: 5001,
} as const;

/** Path to the provider registry config file, relative to the repo root. */
export const REGISTRY_PATH = "config/providers.json";
