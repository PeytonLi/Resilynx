"use client";

import { useEffect, useRef } from "react";
import type { WsPayload, NetworkStatus } from "@resilynx/contracts";

const STATUS_BADGE: Record<NetworkStatus, string> = {
  stable: "#22c55e",
  degraded: "#f59e0b",
  healing: "#ef4444",
  restored: "#22c55e",
};

interface Props {
  events: WsPayload[];
}

export function EventFeed({ events }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#0f0f1a",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #1e293b",
          fontSize: "13px",
          fontWeight: 600,
          color: "#94a3b8",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        Event Feed
        <span style={{ marginLeft: 8, color: "#475569" }}>
          ({events.length})
        </span>
      </div>
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 0",
        }}
      >
        {events.length === 0 && (
          <div
            style={{
              padding: "24px 16px",
              color: "#475569",
              fontSize: "13px",
              textAlign: "center",
            }}
          >
            Waiting for events…
          </div>
        )}
        {events.map((e, i) => (
          <div
            key={`${e.nodeId}-${e.timestamp}-${i}`}
            style={{
              padding: "10px 16px",
              borderBottom: "1px solid #1e293b33",
              fontSize: "12px",
              lineHeight: 1.5,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 3,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: STATUS_BADGE[e.status],
                  flexShrink: 0,
                }}
              />
              <span style={{ fontWeight: 600, color: "#e2e8f0" }}>
                {e.nodeId}
              </span>
              <span
                style={{
                  fontSize: "11px",
                  padding: "1px 6px",
                  borderRadius: 3,
                  background: `${STATUS_BADGE[e.status]}22`,
                  color: STATUS_BADGE[e.status],
                  fontWeight: 500,
                }}
              >
                {e.status}
              </span>
            </div>
            {e.message && (
              <div style={{ color: "#94a3b8", marginBottom: 2 }}>
                {e.message}
              </div>
            )}
            {e.agentState && (
              <div style={{ color: "#64748b", fontSize: "11px" }}>
                agent: {e.agentState}
              </div>
            )}
            <div style={{ color: "#475569", fontSize: "10px", marginTop: 2 }}>
              {new Date(e.timestamp).toLocaleTimeString()}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
