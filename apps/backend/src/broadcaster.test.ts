import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { publish, websocketHandlers } from "./broadcaster";
import type { WsPayload } from "@resilynx/contracts";
import type { Server } from "bun";

describe("WebSocket Broadcaster", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    server = Bun.serve({
      port: 0,
      fetch(_req, srv) {
        return srv.upgrade(_req) ? undefined : new Response("upgrade failed", { status: 400 });
      },
      websocket: websocketHandlers,
    });
    port = server.port;
  });

  afterEach(() => {
    server.stop(true);
  });

  function connect(): Promise<{ ws: WebSocket; messages: WsPayload[] }> {
    return new Promise((resolve, reject) => {
      const messages: WsPayload[] = [];
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      ws.onmessage = (ev) => {
        messages.push(JSON.parse(ev.data as string) as WsPayload);
      };
      ws.onopen = () => resolve({ ws, messages });
      ws.onerror = (ev) => reject(new Error(`WebSocket error: ${JSON.stringify(ev)}`));
      // short timeout for connection
      setTimeout(() => reject(new Error("WebSocket connect timeout")), 3000);
    });
  }

  it("publishes a correctly shaped WsPayload to connected clients", async () => {
    const { messages } = await connect();

    const payload: WsPayload = {
      status: "stable",
      nodeId: "p1",
      timestamp: new Date().toISOString(),
    };
    publish(server, payload);

    // Wait for message delivery
    await new Promise((r) => setTimeout(r, 100));

    expect(messages.length).toBeGreaterThanOrEqual(1);
    const received = messages[0];
    expect(received.status).toBe("stable");
    expect(received.nodeId).toBe("p1");
    expect(typeof received.timestamp).toBe("string");
  });

  it("publishes all lifecycle transitions (stable, degraded, healing, restored)", async () => {
    const { messages } = await connect();

    const statuses: Array<WsPayload["status"]> = ["stable", "degraded", "healing", "restored"];
    for (const status of statuses) {
      publish(server, {
        status,
        nodeId: "p1",
        timestamp: new Date().toISOString(),
      });
    }

    await new Promise((r) => setTimeout(r, 100));

    expect(messages.length).toBeGreaterThanOrEqual(4);
    const receivedStatuses = messages.map((m) => m.status);
    expect(receivedStatuses).toEqual(statuses);
  });

  it("includes agentState and message in healing payloads", async () => {
    const { messages } = await connect();

    publish(server, {
      status: "healing",
      nodeId: "p1",
      agentState: "searching",
      message: "Looking for backup providers...",
      timestamp: new Date().toISOString(),
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0].agentState).toBe("searching");
    expect(messages[0].message).toBe("Looking for backup providers...");
  });
});
