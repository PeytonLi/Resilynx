"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Radio } from "lucide-react";
import type { NetworkStatus, WsPayload } from "@resilynx/contracts";

const STATUS_COLOR: Record<NetworkStatus, string> = {
  stable: "#39d6bd",
  degraded: "#ffba5c",
  healing: "#ff637d",
  restored: "#39d6bd",
};

const FILTERS = ["All", "Stable", "Degraded", "Healing"] as const;
type FilterTab = (typeof FILTERS)[number];

interface Props {
  events: WsPayload[];
}

function formatTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function EventFeed({ events }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<FilterTab>("All");
  const filtered = filter === "All"
    ? events
    : filter === "Stable"
      ? events.filter((event) => event.status === "stable" || event.status === "restored")
      : events.filter((event) => event.status.toLowerCase() === filter.toLowerCase());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [filtered.length]);

  return (
    <div className="activity-panel relative flex h-full flex-col" style={{ background: "#060d18" }}>
      <div className="shrink-0 border-b border-[rgba(174,219,255,0.09)] px-4 py-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl border border-[rgba(170,150,255,0.24)] bg-[rgba(170,150,255,0.1)] text-[#c2b6ff]">
            <Bot size={15} />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.17em] text-[#8dabbe]" style={{ fontFamily: "'Fira Code', monospace" }}>
              <Radio size={11} className="text-[#5de8ff]" /> Live ledger
            </div>
            <h2 className="text-sm font-semibold text-[#e9f5fc]">Recovery activity</h2>
          </div>
          <span className="ml-auto rounded-md border border-[rgba(174,219,255,0.12)] bg-[rgba(255,255,255,0.035)] px-2 py-1 text-[10px] tabular-nums text-[#90a9bd]" style={{ fontFamily: "'Fira Code', monospace" }}>
            {events.length}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 gap-1.5 border-b border-[rgba(174,219,255,0.07)] px-3 py-2.5" role="tablist" aria-label="Filter activity">
        {FILTERS.map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            role="tab"
            aria-selected={filter === tab}
            className="rounded-lg px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.07em] transition duration-200"
            style={{
              fontFamily: "'Fira Code', monospace",
              background: filter === tab ? "rgba(93,232,255,0.1)" : "transparent",
              color: filter === tab ? "#a9f5ff" : "#718aa1",
              border: "1px solid transparent",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {filtered.length === 0 && (
          <div className="activity-empty flex h-full min-h-48 flex-col items-center justify-center px-5 text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-[rgba(93,232,255,0.16)] bg-[rgba(93,232,255,0.06)] text-[#76ecff]">
              <Radio size={18} />
            </div>
            <p className="text-sm font-medium text-[#c9ddea]">Listening for changes</p>
            <p className="mt-1 text-[11px] leading-relaxed text-[#70879d]">Provider health and healer actions will appear here as they happen.</p>
          </div>
        )}

        {filtered.map((event, index) => {
          const color = STATUS_COLOR[event.status];
          return (
            <article
              key={`${event.nodeId}-${event.timestamp}-${index}`}
              className="event-entry mb-2 rounded-xl border border-[rgba(174,219,255,0.08)] bg-[rgba(255,255,255,0.027)] px-3 py-3 transition duration-200 hover:border-[rgba(174,219,255,0.18)] hover:bg-[rgba(255,255,255,0.045)]"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 12px ${color}80` }} />
                <span className="min-w-0 truncate text-[12px] font-semibold text-[#e7f4fc]">{event.nodeId}</span>
                <span className="rounded-md px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em]" style={{ background: `${color}18`, color, fontFamily: "'Fira Code', monospace" }}>
                  {event.status}
                </span>
                <time className="ml-auto shrink-0 text-[9px] text-[#668096]" style={{ fontFamily: "'Fira Code', monospace" }}>
                  {formatTime(event.timestamp)}
                </time>
              </div>
              {event.message && <p className="text-[11px] leading-relaxed text-[#9ab1c4]">{event.message}</p>}
              {event.agentState && (
                <p className="mt-2 border-l border-[rgba(170,150,255,0.34)] pl-2.5 text-[10px] text-[#b9aefe]" style={{ fontFamily: "'Fira Code', monospace" }}>
                  agent / {event.agentState}
                </p>
              )}
            </article>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
