/**
 * E2E smoke test: mock-provider kill → degraded → healing → restored → revive.
 *
 * Starts mock-provider and backend (with ingestion + healer), connects a
 * WebSocket client, kills the mock, asserts the full lifecycle, and
 * verifies the healer added a backup entry to config/providers.json.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PORTS, type NexsetRecord, type WsPayload } from "@resilynx/contracts";
import { Healer, type FailureEvent } from "@resilynx/healer";
import type { AgentSession, AgentCallbacks } from "../../../packages/healer/src/agent";
import type { ProviderRegistryEntry } from "@resilynx/contracts";
import { handleRequest as mockHandleRequest, resetForTests } from "../../mock-provider/src/index";
import { publish, websocketHandlers } from "./broadcaster";
import { Store } from "./db";
import { HealthMonitor } from "./healthMonitor";
import { IngestionEngine, type IngestionFailure } from "./ingestion";
import { ProviderRegistry } from "./registry";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import type { Server } from "bun";

const TEST_DIR = resolve(import.meta.dir, "../.e2e-tmp");
const TEST_REGISTRY = join(TEST_DIR, "providers.json");
const MOCK_PORT = 14001;
const NEXLA_PORT = 15001;
const BACKEND_E2E_PORT = 18080;

// The healer uses the real config/providers.json path. Save/restore it.
const REAL_REGISTRY = resolve(import.meta.dir, "../../../config/providers.json");
let realRegistryBackup: string | null = null;

function backupRealRegistry(): void {
  if (existsSync(REAL_REGISTRY)) {
    realRegistryBackup = readFileSync(REAL_REGISTRY, "utf-8");
  }
}

function restoreRealRegistry(): void {
  if (realRegistryBackup !== null) {
    writeFileSync(REAL_REGISTRY, realRegistryBackup, "utf-8");
  }
}

function setupTestRegistry(): void {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
  const testConfig = [
    {
      id: "mock-exchange-e2e",
      displayName: "Mock Exchange E2E",
      endpoint: `http://localhost:${MOCK_PORT}/data`,
      authMode: "none",
      pollIntervalMs: 2000,
      fieldMapping: { metric: "stock_price", value: "price", unit: "currency", timestamp: "ts" },
      priority: 1,
      enabled: true,
    },
  ];
  const json = JSON.stringify(testConfig, null, 2) + "\n";
  writeFileSync(TEST_REGISTRY, json);
  // Also write to real path so the healer sees the same config
  writeFileSync(REAL_REGISTRY, json);
}

/** Custom agent that uses the test registry path instead of the hardcoded one. */
class TestAgentSession implements AgentSession {
  constructor(private readonly registryPath: string) {}

  async run(prompt: string, callbacks: AgentCallbacks): Promise<void> {
    callbacks.onTurnStart("analysing");
    const providerId = this.extractProviderId(prompt);
    const errorLog = this.extractErrorLog(prompt);
    if (!providerId && !errorLog) { callbacks.onTurnEnd(); return; }

    callbacks.onTurnStart("reading-registry");
    const entries: ProviderRegistryEntry[] = this.readRegistry();
    const failedIndex = entries.findIndex((e) => e.id === providerId);
    if (failedIndex === -1) { callbacks.onTurnEnd(); return; }

    const failedEntry = entries[failedIndex];
    if (failedEntry.authMode === "zeroxyz") { callbacks.onTurnEnd(); return; }

    callbacks.onTurnStart("discovering-backup");
    const backup: ProviderRegistryEntry = {
      id: `${failedEntry.id}-zeroxyz-backup`,
      displayName: `${failedEntry.displayName} (Zero.xyz Backup)`,
      endpoint: `https://api.zero.xyz/v1/proxy/${failedEntry.id}`,
      authMode: "zeroxyz",
      pollIntervalMs: failedEntry.pollIntervalMs,
      fieldMapping: { ...failedEntry.fieldMapping },
      priority: 0,
      enabled: true,
    };
    if (entries.some((entry) => entry.id === backup.id)) { callbacks.onTurnEnd(); return; }

    callbacks.onTurnStart("patching-registry");
    backup.priority = failedEntry.priority + 1;
    entries.push(backup);
    writeFileSync(this.registryPath, JSON.stringify(entries, null, 2) + "\n", "utf-8");
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
}

describe("E2E: kill → degraded → healing → restored → revive", () => {
  let mockServer: Server;
  let nexlaServer: Server;
  let backendServer: Server;
  let registry: ProviderRegistry;
  let ingestion: IngestionEngine;

  beforeAll(async () => {
    backupRealRegistry();
    setupTestRegistry();

    // 1. Mock provider
    mockServer = Bun.serve({
      port: MOCK_PORT,
      fetch: mockHandleRequest,
    });
    resetForTests();

    // 2. Minimal standardization echo service
    nexlaServer = Bun.serve({
      port: NEXLA_PORT,
      async fetch(req) {
        if (req.method === "POST") {
          const body = await req.json() as Record<string, unknown>;
          return Response.json({
            providerId: body.providerId,
            metric: body.metric,
            value: 42,
            unit: "USD",
            timestamp: new Date().toISOString(),
          } satisfies NexsetRecord);
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    // 3. Backend stack — registry uses real path so healer writes to the same file
    registry = new ProviderRegistry(REAL_REGISTRY);
    await registry.load();
    registry.watch();

    const store = new Store(":memory:");
    const healer = new Healer(new TestAgentSession(REAL_REGISTRY));
    const healthMonitor = new HealthMonitor(healer);
    ingestion = new IngestionEngine(registry, `http://localhost:${NEXLA_PORT}/standardize`);

    backendServer = Bun.serve({
      port: BACKEND_E2E_PORT,
      async fetch(req, srv) {
        const url = new URL(req.url);
        if (url.pathname === "/ws") {
          return srv.upgrade(req) ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
        }
        if (url.pathname === "/mock/kill" && req.method === "POST") {
          try {
            const res = await fetch(`http://localhost:${MOCK_PORT}/kill`, { method: "POST" });
            return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
          } catch {
            return Response.json({ error: "Mock provider unreachable" }, { status: 502 });
          }
        }
        if (url.pathname === "/mock/revive" && req.method === "POST") {
          try {
            const res = await fetch(`http://localhost:${MOCK_PORT}/revive`, { method: "POST" });
            return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
          } catch {
            return Response.json({ error: "Mock provider unreachable" }, { status: 502 });
          }
        }
        if (url.pathname === "/mock/status" && req.method === "GET") {
          try {
            const res = await fetch(`http://localhost:${MOCK_PORT}/data`);
            return Response.json({ alive: res.ok });
          } catch {
            return Response.json({ alive: false });
          }
        }
        return new Response("Not Found", { status: 404 });
      },
      websocket: websocketHandlers,
    });

    // Wire events
    ingestion.on("reading", (record: NexsetRecord) => {
      store.insertReading(record);
      healthMonitor.recordSuccess(record.providerId);
    });
    ingestion.on("failure", (failure: IngestionFailure) => {
      healthMonitor.recordFailure(failure);
    });

    healthMonitor.on("down", (providerId: string) => {
      publish(backendServer, { status: "degraded", nodeId: providerId, timestamp: new Date().toISOString() });
    });
    healthMonitor.on("stable", (providerId: string) => {
      publish(backendServer, { status: "stable", nodeId: providerId, timestamp: new Date().toISOString() });
    });

    healer.on("healing", (payload: WsPayload) => {
      publish(backendServer, payload);
    });
    healer.on("restored", (payload: WsPayload) => {
      publish(backendServer, payload);
    });
    healer.on("agent-activity", (payload: WsPayload) => {
      publish(backendServer, payload);
    });

    ingestion.start();
  });

  afterAll(() => {
    ingestion?.stop();
    backendServer?.stop(true);
    nexlaServer?.stop(true);
    mockServer?.stop(true);
    registry?.close();
    restoreRealRegistry();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  function connectWs(): Promise<{ messages: WsPayload[]; close: () => void }> {
    return new Promise((resolve, reject) => {
      const messages: WsPayload[] = [];
      const ws = new WebSocket(`ws://localhost:${BACKEND_E2E_PORT}/ws`);
      ws.onmessage = (ev) => {
        messages.push(JSON.parse(ev.data as string) as WsPayload);
      };
      ws.onopen = () => resolve({ messages, close: () => ws.close() });
      ws.onerror = () => reject(new Error("WebSocket error"));
      setTimeout(() => reject(new Error("WebSocket connect timeout")), 5000);
    });
  }

  function waitForStatus(
    messages: WsPayload[],
    status: WsPayload["status"],
    timeoutMs: number,
  ): Promise<WsPayload> {
    return new Promise((resolve, reject) => {
      const existing = messages.find((m) => m.status === status);
      if (existing) { resolve(existing); return; }
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${status}`)), timeoutMs);
      const interval = setInterval(() => {
        const found = messages.find((m) => m.status === status);
        if (found) {
          clearTimeout(timer);
          clearInterval(interval);
          resolve(found);
        }
      }, 200);
    });
  }

  it("receives a stable event after backend startup", async () => {
    const { messages, close } = await connectWs();
    const stable = await waitForStatus(messages, "stable", 10_000);
    expect(stable.status).toBe("stable");
    expect(stable.nodeId).toBe("mock-exchange-e2e");
    close();
  }, 15_000);

  it("after POST /mock/kill, emits degraded → healing → restored", async () => {
    const { messages, close } = await connectWs();

    // Kill the mock provider via the backend proxy
    const killRes = await fetch(`http://localhost:${BACKEND_E2E_PORT}/mock/kill`, { method: "POST" });
    expect(killRes.status).toBe(200);

    const degraded = await waitForStatus(messages, "degraded", 60_000);
    expect(degraded.status).toBe("degraded");
    expect(degraded.nodeId).toBe("mock-exchange-e2e");

    const healing = await waitForStatus(messages, "healing", 30_000);
    expect(healing.status).toBe("healing");

    const restored = await waitForStatus(messages, "restored", 30_000);
    expect(restored.status).toBe("restored");

    close();
  }, 90_000);

  it("registry gained a backup entry with authMode zeroxyz", async () => {
    await new Promise((r) => setTimeout(r, 100));
    const providers = registry.getProviders();
    const backup = providers.find((e) => e.authMode === "zeroxyz");
    expect(backup).toBeDefined();
    expect(backup!.id).toContain("mock-exchange-e2e");
    const raw = readFileSync(REAL_REGISTRY, "utf-8");
    const entries = JSON.parse(raw) as Array<{ id: string; authMode: string }>;
    const fileBackup = entries.find((e) => e.authMode === "zeroxyz");
    expect(fileBackup).toBeDefined();
  });

  it("POST /mock/revive restores the mock to 200 OK", async () => {
    const reviveRes = await fetch(`http://localhost:${BACKEND_E2E_PORT}/mock/revive`, { method: "POST" });
    expect(reviveRes.status).toBe(200);

    // Verify the mock itself returns 200 on /data
    const dataRes = await fetch(`http://localhost:${MOCK_PORT}/data`);
    expect(dataRes.status).toBe(200);
  });
});
