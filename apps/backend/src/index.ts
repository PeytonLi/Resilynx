import { PORTS, type NexsetRecord, type WsPayload } from "@resilynx/contracts";
import { Healer } from "@resilynx/healer";
import { publish, websocketHandlers } from "./broadcaster";
import { Store } from "./db";
import { HealthMonitor } from "./healthMonitor";
import { IngestionEngine, type IngestionFailure } from "./ingestion";
import { ProviderRegistry } from "./registry";

export const registry = new ProviderRegistry();

export { publish, websocketHandlers } from "./broadcaster";
export { Store } from "./db";
export { HealthMonitor } from "./healthMonitor";
export { IngestionEngine, type IngestionFailure } from "./ingestion";
export { ProviderRegistry } from "./registry";

// Module-level references set during server startup so handleRequest can reach them.
let store: Store | undefined;
let healthMonitor: HealthMonitor | undefined;

/** Handles plain HTTP routes. /ws upgrades are handled separately (see Bun.serve fetch below). */
export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/health") {
    return Response.json({ status: "ok" });
  }
  if (url.pathname === "/providers") {
    return Response.json(registry.getProviders());
  }

  // Mock provider proxy routes
  if (url.pathname === "/mock/kill" && req.method === "POST") {
    try {
      const res = await fetch(`http://localhost:${PORTS.mockProvider}/kill`, { method: "POST" });
      const body = await res.text();
      return new Response(body, { status: res.status, headers: { "content-type": "application/json" } });
    } catch (e) {
      return Response.json({ error: "Mock provider unreachable" }, { status: 502 });
    }
  }
  if (url.pathname === "/mock/revive" && req.method === "POST") {
    try {
      const res = await fetch(`http://localhost:${PORTS.mockProvider}/revive`, { method: "POST" });
      const body = await res.text();
      return new Response(body, { status: res.status, headers: { "content-type": "application/json" } });
    } catch (e) {
      return Response.json({ error: "Mock provider unreachable" }, { status: 502 });
    }
  }
  if (url.pathname === "/mock/status" && req.method === "GET") {
    try {
      const res = await fetch(`http://localhost:${PORTS.mockProvider}/status`);
      const body = await res.text();
      return new Response(body, { status: res.status, headers: { "content-type": "application/json" } });
    } catch (e) {
      return Response.json({ alive: false, error: "Mock provider unreachable" });
    }
  }

  if (url.pathname === "/status" && req.method === "GET") {
    if (!healthMonitor) return new Response("Health monitor not initialized", { status: 503 });
    return Response.json(Object.fromEntries(healthMonitor.getStatus()));
  }

  if (url.pathname === "/readings" && req.method === "GET") {
    if (!store) return new Response("Store not initialized", { status: 503 });
    const limit = parseInt(url.searchParams.get("limit") || "20");
    return Response.json(store.recentReadings(limit));
  }

  return new Response("Not Found", { status: 404 });
}

if (import.meta.main) {
  await registry.load();
  registry.watch();

  store = new Store();
  const healer = new Healer();
  const ingestion = new IngestionEngine(registry);
  healthMonitor = new HealthMonitor(healer);

  const server = Bun.serve({
    port: PORTS.backend,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        return srv.upgrade(req) ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
      }
      return handleRequest(req);
    },
    websocket: websocketHandlers,
  });

  const broadcast = (payload: WsPayload): void => {
    publish(server, payload);
    store.insertEvent(payload);
  };


  // Hot-reload: restart poll loops so registry edits take effect without a process restart.
  registry.on("change", () => {
    ingestion.stop();
    ingestion.start();
  });

  ingestion.on("reading", (record: NexsetRecord) => {
    store.insertReading(record);
    healthMonitor.recordSuccess(record.providerId);
  });
  ingestion.on("failure", (failure: IngestionFailure) => {
    healthMonitor.recordFailure(failure);
  });

  healthMonitor.on("down", (providerId: string) => {
    broadcast({ status: "degraded", nodeId: providerId, timestamp: new Date().toISOString() });
  });
  healthMonitor.on("stable", (providerId: string) => {
    broadcast({ status: "stable", nodeId: providerId, timestamp: new Date().toISOString() });
  });

  healer.on("healing", (payload: WsPayload) => {
    broadcast(payload);
  });
  healer.on("restored", (payload: WsPayload) => {
    broadcast(payload);
  });
  healer.on("agent-activity", (payload: WsPayload) => {
    broadcast(payload);
  });

  ingestion.start();

  console.log(`backend listening on :${server.port}`);
}
