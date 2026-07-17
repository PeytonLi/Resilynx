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

// --- Module-level helpers for reuse across E2E tests ---

/** Resolves $ prefixed dot-paths against a payload, e.g. "$reading.frequency" → 49.95 */
function resolveDollarPath(payload: Record<string, unknown>, path: string): unknown {
  if (!path.startsWith("$")) return path;
  const segments = path.slice(1).split(".");
  let current: any = payload;
  for (const seg of segments) {
    const match = seg.match(/^([^\[]+)(?:\[(\d+)\])?$/);
    if (!match) throw new Error(`Bad segment: ${seg}`);
    current = current[match[1]];
    if (match[2] !== undefined) current = current[parseInt(match[2])];
  }
  return current;
}

function connectWs(port: number): Promise<{ messages: WsPayload[]; close: () => void }> {
  return new Promise((resolve, reject) => {
    const messages: WsPayload[] = [];
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.onmessage = (ev) => { messages.push(JSON.parse(ev.data as string) as WsPayload); };
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
      if (found) { clearTimeout(timer); clearInterval(interval); resolve(found); }
    }, 200);
  });
}

/** Creates a fetch handler for a mock that can be killed/revived via POST. */
function createKillableMockHandler() {
  let killed = false;
  return {
    fetch(req: Request): Response {
      const url = new URL(req.url);
      if (url.pathname === "/data" && req.method === "GET") {
        if (killed) return new Response("Service Unavailable", { status: 503 });
        return Response.json({
          reading: { sensor: "GRID-N1", frequency: 49.95, voltage: 231.4, unit: "Hz", ts: new Date().toISOString() },
        });
      }
      if (url.pathname === "/kill" && req.method === "POST") { killed = true; return Response.json({ killed: true }); }
      if (url.pathname === "/revive" && req.method === "POST") { killed = false; return Response.json({ killed: false }); }
      if (url.pathname === "/status") { return Response.json({ alive: !killed }); }
      return new Response("Not Found", { status: 404 });
    },
    kill: () => { killed = true; },
    revive: () => { killed = false; },
  };
}

/** Creates a fetch handler for a mock that never dies (always returns 200). */
function createHealthyMockHandler() {
  return {
    fetch(req: Request): Response {
      const url = new URL(req.url);
      if (url.pathname === "/data" && req.method === "GET") {
        return Response.json({
          reading: { sensor: "SOLAR-S1", power: 1.5, voltage: 231.4, unit: "kW", ts: new Date().toISOString() },
        });
      }
      if (url.pathname === "/status") { return Response.json({ alive: true }); }
      return new Response("Not Found", { status: 404 });
    },
  };
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

// ============================================================================
// E2E: real standardization with $ prefix resolver
// ============================================================================
describe("E2E: real standardization with $ prefix resolver", () => {
  let mockServer: Server;
  let nexlaServer: Server;
  let backendServer: Server;
  let registry: ProviderRegistry;
  let ingestion: IngestionEngine;
  const capturedRecords: NexsetRecord[] = [];
  const MOCK_PORT = 14002;
  const NEXLA_PORT = 15002;
  const BACKEND_PORT = 18081;
  const TEST_DIR_LOCAL = resolve(import.meta.dir, "../.e2e-tmp-std");

  beforeAll(async () => {
    backupRealRegistry();

    if (existsSync(TEST_DIR_LOCAL)) rmSync(TEST_DIR_LOCAL, { recursive: true });
    mkdirSync(TEST_DIR_LOCAL, { recursive: true });
    const testConfig = [
      {
        id: "mock-grid-e2e",
        displayName: "Mock Grid E2E",
        endpoint: `http://localhost:${MOCK_PORT}/data`,
        authMode: "none",
        pollIntervalMs: 2000,
        fieldMapping: { metric: "grid_frequency", value: "$reading.frequency", unit: "$reading.unit", timestamp: "$reading.ts" },
        priority: 1,
        enabled: true,
      },
    ];
    const json = JSON.stringify(testConfig, null, 2) + "\n";
    writeFileSync(join(TEST_DIR_LOCAL, "providers.json"), json);
    writeFileSync(REAL_REGISTRY, json);

    mockServer = Bun.serve({
      port: MOCK_PORT,
      fetch(req) {
        if (new URL(req.url).pathname === "/data") {
          return Response.json({
            reading: { sensor: "GRID-N1", frequency: 49.95, voltage: 231.4, unit: "Hz", ts: new Date().toISOString() },
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    // Real $ prefix resolver standardization service
    nexlaServer = Bun.serve({
      port: NEXLA_PORT,
      async fetch(req) {
        if (req.method !== "POST") return new Response("Not Found", { status: 404 });
        const body = await req.json() as {
          providerId: string; metric: string; rawPayload: Record<string, unknown>; fieldMapping: Record<string, string>;
        };
        const value = resolveDollarPath(body.rawPayload, body.fieldMapping.value);
        const unit = resolveDollarPath(body.rawPayload, body.fieldMapping.unit);
        const ts = resolveDollarPath(body.rawPayload, body.fieldMapping.timestamp);
        return Response.json({
          providerId: body.providerId,
          metric: body.metric,
          value: Number(value),
          unit: String(unit ?? "unknown"),
          timestamp: String(ts ?? new Date().toISOString()),
        } satisfies NexsetRecord);
      },
    });

    registry = new ProviderRegistry(REAL_REGISTRY);
    await registry.load();
    registry.watch();

    const store = new Store(":memory:");
    const healer = new Healer(new TestAgentSession(REAL_REGISTRY));
    const healthMonitor = new HealthMonitor(healer);
    ingestion = new IngestionEngine(registry, `http://localhost:${NEXLA_PORT}/standardize`);

    backendServer = Bun.serve({
      port: BACKEND_PORT,
      fetch(req, srv) {
        if (new URL(req.url).pathname === "/ws") {
          return srv.upgrade(req) ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
        }
        return new Response("Not Found", { status: 404 });
      },
      websocket: websocketHandlers,
    });

    ingestion.on("reading", (record: NexsetRecord) => {
      store.insertReading(record);
      healthMonitor.recordSuccess(record.providerId);
      capturedRecords.push(record);
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

    healer.on("healing", (payload: WsPayload) => publish(backendServer, payload));
    healer.on("restored", (payload: WsPayload) => publish(backendServer, payload));
    healer.on("agent-activity", (payload: WsPayload) => publish(backendServer, payload));

    ingestion.start();
  });

  afterAll(() => {
    ingestion?.stop();
    backendServer?.stop(true);
    nexlaServer?.stop(true);
    mockServer?.stop(true);
    registry?.close();
    restoreRealRegistry();
    if (existsSync(TEST_DIR_LOCAL)) rmSync(TEST_DIR_LOCAL, { recursive: true });
  });

  it("standardizes mock grid payload using $ prefix fieldMapping", async () => {
    const { messages, close } = await connectWs(BACKEND_PORT);
    const stable = await waitForStatus(messages, "stable", 15_000);
    expect(stable.status).toBe("stable");
    expect(stable.nodeId).toBe("mock-grid-e2e");

    // Wait for at least one captured reading
    for (let i = 0; i < 30; i++) {
      if (capturedRecords.length > 0) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(capturedRecords.length).toBeGreaterThan(0);
    const record = capturedRecords[0];

    // $ prefix resolved: value should be the actual frequency number, not a string
    expect(typeof record.value).toBe("number");
    expect(record.unit).toBe("Hz");

    // Timestamp should be a valid ISO string converted from the payload's ts field
    expect(typeof record.timestamp).toBe("string");
    const d = new Date(record.timestamp);
    expect(d.getTime()).not.toBeNaN();

    close();
  }, 30_000);
});

// ============================================================================
// E2E: WebSocket reconnection
// ============================================================================
describe("E2E: WebSocket reconnection", () => {
  let mockServer: Server;
  let mockHandler: ReturnType<typeof createKillableMockHandler>;
  let nexlaServer: Server;
  let backendServer: Server;
  let registry: ProviderRegistry;
  let ingestion: IngestionEngine;
  const MOCK_PORT = 14003;
  const NEXLA_PORT = 15003;
  const BACKEND_PORT = 18082;
  const TEST_DIR_LOCAL = resolve(import.meta.dir, "../.e2e-tmp-ws");

  beforeAll(async () => {
    backupRealRegistry();

    if (existsSync(TEST_DIR_LOCAL)) rmSync(TEST_DIR_LOCAL, { recursive: true });
    mkdirSync(TEST_DIR_LOCAL, { recursive: true });
    const testConfig = [
      {
        id: "mock-exchange-e2e-ws",
        displayName: "Mock Exchange E2E WS",
        endpoint: `http://localhost:${MOCK_PORT}/data`,
        authMode: "none",
        pollIntervalMs: 2000,
        fieldMapping: { metric: "stock_price", value: "price", unit: "currency", timestamp: "ts" },
        priority: 1,
        enabled: true,
      },
    ];
    const json = JSON.stringify(testConfig, null, 2) + "\n";
    writeFileSync(join(TEST_DIR_LOCAL, "providers.json"), json);
    writeFileSync(REAL_REGISTRY, json);

    mockHandler = createKillableMockHandler();
    mockServer = Bun.serve({ port: MOCK_PORT, fetch: mockHandler.fetch });

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

    registry = new ProviderRegistry(REAL_REGISTRY);
    await registry.load();
    registry.watch();

    const store = new Store(":memory:");
    const healer = new Healer(new TestAgentSession(REAL_REGISTRY));
    const healthMonitor = new HealthMonitor(healer);
    ingestion = new IngestionEngine(registry, `http://localhost:${NEXLA_PORT}/standardize`);

    backendServer = Bun.serve({
      port: BACKEND_PORT,
      fetch(req, srv) {
        const url = new URL(req.url);
        if (url.pathname === "/ws") {
          return srv.upgrade(req) ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
        }
        if (url.pathname === "/mock/kill" && req.method === "POST") {
          mockHandler.kill();
          return Response.json({ killed: true });
        }
        return new Response("Not Found", { status: 404 });
      },
      websocket: websocketHandlers,
    });

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

    healer.on("healing", (payload: WsPayload) => publish(backendServer, payload));
    healer.on("restored", (payload: WsPayload) => publish(backendServer, payload));
    healer.on("agent-activity", (payload: WsPayload) => publish(backendServer, payload));

    ingestion.start();
  });

  afterAll(() => {
    ingestion?.stop();
    backendServer?.stop(true);
    nexlaServer?.stop(true);
    mockServer?.stop(true);
    registry?.close();
    restoreRealRegistry();
    if (existsSync(TEST_DIR_LOCAL)) rmSync(TEST_DIR_LOCAL, { recursive: true });
  });

  it("reconnecting client receives current state", async () => {
    const { messages: msgs1, close: close1 } = await connectWs(BACKEND_PORT);
    await waitForStatus(msgs1, "stable", 10_000);
    close1();

    const killRes = await fetch(`http://localhost:${BACKEND_PORT}/mock/kill`, { method: "POST" });
    expect(killRes.status).toBe(200);

    // Connect client 2 shortly after kill — it should catch the lifecycle events
    await new Promise((r) => setTimeout(r, 1000));
    const { messages: msgs2, close: close2 } = await connectWs(BACKEND_PORT);

    await waitForStatus(msgs2, "degraded", 60_000);
    await waitForStatus(msgs2, "healing", 30_000);
    await waitForStatus(msgs2, "restored", 30_000);

    const providers = registry.getProviders();
    expect(providers.some((p) => p.authMode === "zeroxyz")).toBe(true);

    close2();
  }, 120_000);

  it("two simultaneous clients both receive the same events", async () => {
    mockHandler.revive();
    await new Promise((r) => setTimeout(r, 5000));

    const [c1, c2] = await Promise.all([connectWs(BACKEND_PORT), connectWs(BACKEND_PORT)]);

    const killRes = await fetch(`http://localhost:${BACKEND_PORT}/mock/kill`, { method: "POST" });
    expect(killRes.status).toBe(200);

    await waitForStatus(c1.messages, "degraded", 60_000);
    await waitForStatus(c2.messages, "degraded", 60_000);
    await waitForStatus(c1.messages, "healing", 30_000);
    await waitForStatus(c2.messages, "healing", 30_000);
    await waitForStatus(c1.messages, "restored", 30_000);
    await waitForStatus(c2.messages, "restored", 30_000);

    // Each client should have degraded → healing → restored in order
    const idx = (msgs: WsPayload[], s: WsPayload["status"]) => msgs.findIndex((m) => m.status === s);

    expect(idx(c1.messages, "degraded")).toBeGreaterThan(-1);
    expect(idx(c1.messages, "healing")).toBeGreaterThan(idx(c1.messages, "degraded"));
    expect(idx(c1.messages, "restored")).toBeGreaterThan(idx(c1.messages, "healing"));

    expect(idx(c2.messages, "degraded")).toBeGreaterThan(-1);
    expect(idx(c2.messages, "healing")).toBeGreaterThan(idx(c2.messages, "degraded"));
    expect(idx(c2.messages, "restored")).toBeGreaterThan(idx(c2.messages, "healing"));

    c1.close();
    c2.close();
  }, 120_000);
});

// ============================================================================
// E2E: healthy providers keep ingesting during failure
// ============================================================================
describe("E2E: healthy providers keep ingesting during failure", () => {
  let killableMock: Server;
  let killableHandler: ReturnType<typeof createKillableMockHandler>;
  let healthyMock: Server;
  let nexlaServer: Server;
  let backendServer: Server;
  let registry: ProviderRegistry;
  let ingestion: IngestionEngine;
  const healthyReadings: NexsetRecord[] = [];
  const MOCK_KILLABLE_PORT = 14004;
  const MOCK_HEALTHY_PORT = 14005;
  const NEXLA_PORT = 15004;
  const BACKEND_PORT = 18083;
  const TEST_DIR_LOCAL = resolve(import.meta.dir, "../.e2e-tmp-conc");

  beforeAll(async () => {
    backupRealRegistry();

    if (existsSync(TEST_DIR_LOCAL)) rmSync(TEST_DIR_LOCAL, { recursive: true });
    mkdirSync(TEST_DIR_LOCAL, { recursive: true });
    const testConfig = [
      {
        id: "mock-killable-e2e",
        displayName: "Killable Mock",
        endpoint: `http://localhost:${MOCK_KILLABLE_PORT}/data`,
        authMode: "none",
        pollIntervalMs: 2000,
        fieldMapping: { metric: "grid_frequency", value: "frequency", unit: "unit", timestamp: "ts" },
        priority: 1,
        enabled: true,
      },
      {
        id: "mock-healthy-e2e",
        displayName: "Healthy Mock",
        endpoint: `http://localhost:${MOCK_HEALTHY_PORT}/data`,
        authMode: "none",
        pollIntervalMs: 2000,
        fieldMapping: { metric: "solar_power", value: "power", unit: "unit", timestamp: "ts" },
        priority: 1,
        enabled: true,
      },
    ];
    const json = JSON.stringify(testConfig, null, 2) + "\n";
    writeFileSync(join(TEST_DIR_LOCAL, "providers.json"), json);
    writeFileSync(REAL_REGISTRY, json);

    killableHandler = createKillableMockHandler();
    killableMock = Bun.serve({ port: MOCK_KILLABLE_PORT, fetch: killableHandler.fetch });
    healthyMock = Bun.serve({ port: MOCK_HEALTHY_PORT, fetch: createHealthyMockHandler().fetch });

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

    registry = new ProviderRegistry(REAL_REGISTRY);
    await registry.load();
    registry.watch();

    const store = new Store(":memory:");
    const healer = new Healer(new TestAgentSession(REAL_REGISTRY));
    const healthMonitor = new HealthMonitor(healer);
    ingestion = new IngestionEngine(registry, `http://localhost:${NEXLA_PORT}/standardize`);

    backendServer = Bun.serve({
      port: BACKEND_PORT,
      fetch(req, srv) {
        if (new URL(req.url).pathname === "/ws") {
          return srv.upgrade(req) ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
        }
        return new Response("Not Found", { status: 404 });
      },
      websocket: websocketHandlers,
    });

    ingestion.on("reading", (record: NexsetRecord) => {
      store.insertReading(record);
      healthMonitor.recordSuccess(record.providerId);
      if (record.providerId === "mock-healthy-e2e") {
        healthyReadings.push(record);
      }
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

    healer.on("healing", (payload: WsPayload) => publish(backendServer, payload));
    healer.on("restored", (payload: WsPayload) => publish(backendServer, payload));
    healer.on("agent-activity", (payload: WsPayload) => publish(backendServer, payload));

    ingestion.start();
  });

  afterAll(() => {
    ingestion?.stop();
    backendServer?.stop(true);
    nexlaServer?.stop(true);
    killableMock?.stop(true);
    healthyMock?.stop(true);
    registry?.close();
    restoreRealRegistry();
    if (existsSync(TEST_DIR_LOCAL)) rmSync(TEST_DIR_LOCAL, { recursive: true });
  });

  it("other providers continue emitting readings while one is being healed", async () => {
    // Wait for healthy provider to accumulate readings
    for (let i = 0; i < 30; i++) {
      if (healthyReadings.length >= 2) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(healthyReadings.length).toBeGreaterThanOrEqual(2);
    const countBeforeKill = healthyReadings.length;

    // Kill only the killable mock
    killableHandler.kill();

    // Wait through the heal window
    await new Promise((r) => setTimeout(r, 20_000));

    // Healthy provider should have continued emitting
    expect(healthyReadings.length).toBeGreaterThan(countBeforeKill);

    // Killable provider should have triggered a heal
    const providers = registry.getProviders();
    expect(providers.some((p) => p.authMode === "zeroxyz")).toBe(true);
  }, 45_000);
});
