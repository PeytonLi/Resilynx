import { PORTS, type NexsetRecord, type WsPayload } from "@resilynx/contracts";
import { Healer, type FailureEvent } from "@resilynx/healer";
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

/** Handles plain HTTP routes. /ws upgrades are handled separately (see Bun.serve fetch below). */
export function handleRequest(req: Request): Response {
  const url = new URL(req.url);
  if (url.pathname === "/health") {
    return Response.json({ status: "ok" });
  }
  if (url.pathname === "/providers") {
    return Response.json(registry.getProviders());
  }
  return new Response("Not Found", { status: 404 });
}

if (import.meta.main) {
  await registry.load();
  registry.watch();

  const store = new Store();
  const healer = new Healer();
  const ingestion = new IngestionEngine(registry);
  const healthMonitor = new HealthMonitor(healer);

  const broadcast = (payload: WsPayload): void => {
    publish(server, payload);
    store.insertEvent(payload);
  };

  const server = Bun.serve({
    port: PORTS.backend,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        return srv.upgrade(req) ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
      }
      return handleRequest(req);
    },
    websocket: websocketHandlers,
  });

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

  healer.on("healing", (failure: FailureEvent) => {
    broadcast({ status: "healing", nodeId: failure.providerId, timestamp: new Date().toISOString() });
  });
  healer.on("restored", (failure: FailureEvent) => {
    broadcast({ status: "restored", nodeId: failure.providerId, timestamp: new Date().toISOString() });
  });
  healer.on("agent-activity", (activity: unknown) => {
    const a = (activity ?? {}) as { providerId?: string; agentState?: string; message?: string };
    broadcast({
      status: "healing",
      nodeId: a.providerId ?? "unknown",
      agentState: a.agentState,
      message: a.message,
      timestamp: new Date().toISOString(),
    });
  });

  ingestion.start();

  console.log(`backend listening on :${server.port}`);
}
