/**
 * WebSocket broadcaster — pass `websocketHandlers` as Bun.serve's `websocket`
 * option so every connected client subscribes to WS_CHANNEL; publish() sends
 * a WsPayload to every subscriber as JSON.
 */
import type { Server, ServerWebSocket } from "bun";
import { WS_CHANNEL, type WsPayload } from "@resilynx/contracts";

export const websocketHandlers = {
  open(ws: ServerWebSocket<unknown>): void {
    ws.subscribe(WS_CHANNEL);
  },
};

/** Publishes a WsPayload to every subscriber of WS_CHANNEL. */
export function publish(server: Server, payload: WsPayload): void {
  server.publish(WS_CHANNEL, JSON.stringify(payload));
}
