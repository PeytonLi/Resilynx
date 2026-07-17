"use client";

import { useEffect, useRef, useState } from "react";
import type { WsPayload, NetworkStatus } from "@resilynx/contracts";

const STATUS_COLOR: Record<NetworkStatus, string> = {
  stable: "#22c55e",
  degraded: "#f59e0b",
  healing: "#ef4444",
  restored: "#22c55e",
};

const FILTERS = ["All", "Stable", "Degraded", "Healing"] as const;
type FilterTab = (typeof FILTERS)[number];

interface Props {
  events: WsPayload[];
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString();
}

export function EventFeed({ events }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<FilterTab>("All");

  const filtered =
    filter === "All"
      ? events
      : filter === "Stable"
        ? events.filter((e) => e.status === "stable" || e.status === "restored")
        : filter === "Degraded"
          ? events.filter((e) => e.status === "degraded")
          : events.filter((e) => e.status === "healing");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [filtered.length]);

  return (
    <div className="flex flex-col h-full" style={{ background: "rgba(15,15,26,0.98)" }}>
      {/* Header */}
      <div
        className="px-4 py-3 border-b flex items-center justify-between shrink-0"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-[#94a3b8] uppercase tracking-wider">
            Event Feed
          </span>
          <span className="text-[11px] text-[#475569] tabular-nums" style={{ fontFamily: "'Fira Code', monospace" }}>
            ({events.length})
          </span>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 px-3 py-2 shrink-0 border-b border-[rgba(255,255,255,0.04)]">
        {FILTERS.map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className="text-[11px] px-2.5 py-1 rounded transition-colors"
            style={{
              fontFamily: "'Fira Code', monospace",
              background: filter === tab ? "rgba(0,255,255,0.1)" : "transparent",
              color: filter === tab ? "#00ffff" : "#475569",
              border: filter === tab ? "1px solid rgba(0,255,255,0.2)" : "1px solid transparent",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {filtered.length === 0 && (
          <div className="py-8 text-[13px] text-[#475569] text-center">
            {events.length === 0 ? "Waiting for events…" : "No matching events"}
          </div>
        )}

        {filtered.map((e, i) => (
          <div
            key={`${e.nodeId}-${e.timestamp}-${i}`}
            className="px-3 py-2.5 mb-1 rounded-md"
            style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.04)",
            }}
          >
            {/* Row 1: node + status badge + time */}
            <div className="flex items-center gap-2 mb-1">
              <span
                className="shrink-0 w-2 h-2 rounded-full"
                style={{ background: STATUS_COLOR[e.status] }}
              />
              <span className="text-[12px] font-semibold text-[#e2e8f0] truncate">
                {e.nodeId}
              </span>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
                style={{
                  background: `${STATUS_COLOR[e.status]}22`,
                  color: STATUS_COLOR[e.status],
                  fontFamily: "'Fira Code', monospace",
                }}
              >
                {e.status}
              </span>
              <span className="ml-auto text-[10px] text-[#475569] shrink-0" style={{ fontFamily: "'Fira Code', monospace" }}>
                {formatTime(e.timestamp)}
              </span>
            </div>

            {/* Row 2: message */}
            {e.message && (
              <div className="text-[11px] text-[#94a3b8] mb-1">{e.message}</div>
            )}

            {/* Row 3: agent thought trail (indented, monospace) */}
            {e.agentState && (
              <div
                className="text-[10px] text-[#64748b] pl-3 border-l border-[rgba(255,255,255,0.06)] ml-1"
                style={{ fontFamily: "'Fira Code', monospace" }}
              >
                agent: {e.agentState}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
