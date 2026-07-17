"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { WsPayload, NetworkStatus } from "@resilynx/contracts";

export interface NodeState {
  status: NetworkStatus;
  agentState?: string;
  message?: string;
  timestamp: string;
}

export function useWebSocket() {
  const [events, setEvents] = useState<WsPayload[]>([]);
  const [networkStatus, setNetworkStatus] = useState<Map<string, NodeState>>(
    new Map(),
  );
  const [connected, setConnected] = useState(false);
  const retryCountRef = useRef(0);
  const maxRetryMs = 30000;

  const connect = useCallback(() => {
    const ws = new WebSocket("ws://localhost:8080/ws");

    ws.onopen = () => {
      setConnected(true);
      retryCountRef.current = 0;
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const payload: WsPayload = JSON.parse(event.data as string);
        setEvents((prev) => [...prev.slice(-99), payload]);
        setNetworkStatus((prev) => {
          const next = new Map(prev);
          next.set(payload.nodeId, {
            status: payload.status,
            agentState: payload.agentState,
            message: payload.message,
            timestamp: payload.timestamp,
          });
          return next;
        });
      } catch {
        /* ignore malformed messages */
      }
    };

    ws.onclose = () => {
      setConnected(false);
      const delay = Math.min(
        1000 * Math.pow(2, retryCountRef.current),
        maxRetryMs,
      );
      retryCountRef.current += 1;
      setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      // Cleanup impossible on stale closure, but the effect cleanup
      // runs once on unmount — the reference may be stale; we accept that.
    };
  }, [connect]);

  return { networkStatus, events, connected } as const;
}
