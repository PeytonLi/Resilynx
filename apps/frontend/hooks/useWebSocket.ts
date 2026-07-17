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
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const retryCountRef = useRef(0);
  const maxRetryMs = 30000;

  const connect = useCallback(() => {
    const ws = new WebSocket("ws://localhost:8080/ws");
    wsRef.current = ws;

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
      if (!mountedRef.current) return;
      const delay = Math.min(
        1000 * Math.pow(2, retryCountRef.current),
        maxRetryMs,
      );
      retryCountRef.current += 1;
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
    };
  }, [connect]);

  return { networkStatus, events, connected } as const;
}
