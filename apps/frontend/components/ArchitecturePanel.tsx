"use client";

import { ArrowRight, Database, Globe, Shield, Sparkles, Zap } from "lucide-react";

const layers = [
  {
    icon: Globe,
    title: "Data Sources",
    color: "#5de8ff",
    items: [
      { name: "Open-Meteo", desc: "London weather — temperature, humidity, wind", endpoint: "api.open-meteo.com" },
      { name: "USGS Earthquake", desc: "Global M2.5+ seismic events — GeoJSON", endpoint: "earthquake.usgs.gov" },
      { name: "UK Carbon Intensity", desc: "National Grid carbon intensity — gCO2/kWh", endpoint: "api.carbonintensity.org.uk" },
      { name: "Mock Grid Sensor", desc: "Simulated grid frequency — killable", endpoint: "localhost:4001" },
    ],
  },
  {
    icon: Zap,
    title: "Standardization Engine",
    color: "#39d6bd",
    items: [
      { name: "Nexla Service", desc: "FastAPI — $ prefix dot-path resolver extracts values from incompatible payloads into unified NexsetRecords", endpoint: "localhost:5001" },
      { name: "Nexla Cloud", desc: "nexla-sdk v1.0.8 — schema registry and field mapping validation", endpoint: "dataops.nexla.io" },
    ],
  },
  {
    icon: Shield,
    title: "Healing Orchestrator",
    color: "#aa96ff",
    items: [
      { name: "Health Monitor", desc: "3-consecutive-failure debounce — triggers healing on provider outage" },
      { name: "Zero.xyz Discovery", desc: "zero CLI — searches for backup APIs, fetches endpoint details" },
      { name: "Smart Healer", desc: "Patches config/providers.json with backup entry — registry hot-reloads" },
    ],
  },
  {
    icon: Database,
    title: "Persistence & Delivery",
    color: "#ffba5c",
    items: [
      { name: "SQLite Store", desc: "Bun:sqlite — readings and event history persisted locally" },
      { name: "WebSocket Broadcaster", desc: "Bun.serve — aegis-events channel pushes stable/degraded/healing/restored" },
      { name: "Next.js Frontend", desc: "Three.js 3D topology + EventFeed — live provider network visualization" },
    ],
  },
];

const flow = [
  "Data sources poll every 15–120s",
  "Raw payloads POST to Nexla standardization",
  "$-prefix resolver extracts value, unit, timestamp",
  "NexsetRecords emitted to WebSocket + SQLite",
  "Health monitor tracks consecutive failures",
  "3 failures → healer wakes, searches Zero.xyz",
  "Backup entry written to providers.json",
  "Registry hot-reloads, ingestion resumes",
];

export function ArchitecturePanel() {
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[rgba(7,17,33,0.62)]">
      <div className="shrink-0 border-b border-[rgba(174,219,255,0.09)] px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[rgba(93,232,255,0.24)] bg-[rgba(93,232,255,0.1)] text-[#8df2ff]">
            <Sparkles size={16} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#e9f5fc]">System Architecture</h2>
            <p className="text-[10px] uppercase tracking-[0.12em] text-[#6f8aa3]" style={{ fontFamily: "'Fira Code', monospace" }}>
              Self-healing data ingestion pipeline
            </p>
          </div>
        </div>
      </div>

      {/* Flow diagram */}
      <div className="shrink-0 border-b border-[rgba(174,219,255,0.07)] px-5 py-4">
        <h3 className="mb-3 text-[10px] font-medium uppercase tracking-[0.14em] text-[#7890a8]" style={{ fontFamily: "'Fira Code', monospace" }}>
          Healing Flow
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {flow.map((step, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              <span className="rounded-md border border-[rgba(174,219,255,0.12)] bg-[rgba(255,255,255,0.03)] px-2 py-1 text-[10px] leading-relaxed text-[#b0c6d8]" style={{ fontFamily: "'Fira Code', monospace" }}>
                {i + 1}. {step}
              </span>
              {i < flow.length - 1 && (
                <ArrowRight size={10} className="shrink-0 text-[#5de8ff]" />
              )}
            </span>
          ))}
        </div>
      </div>

      {/* Layer cards */}
      <div className="flex-1 space-y-3 px-4 py-4">
        {layers.map((layer) => (
          <div
            key={layer.title}
            className="overflow-hidden rounded-2xl border border-[rgba(174,219,255,0.09)] bg-[rgba(255,255,255,0.025)]"
          >
            <div className="flex items-center gap-2.5 border-b border-[rgba(174,219,255,0.06)] px-4 py-3">
              <layer.icon size={15} style={{ color: layer.color }} />
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: layer.color, fontFamily: "'Fira Code', monospace" }}>
                {layer.title}
              </span>
            </div>
            <div className="divide-y divide-[rgba(174,219,255,0.04)]">
              {layer.items.map((item) => (
                <div key={item.name} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] font-medium text-[#e2eef9]">{item.name}</span>
                    {"endpoint" in item && (
                      <span className="shrink-0 text-[9px] text-[#60748c]" style={{ fontFamily: "'Fira Code', monospace" }}>
                        {(item as { endpoint?: string }).endpoint}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-[#829cb4]">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-[rgba(174,219,255,0.07)] px-5 py-3 text-center">
        <p className="text-[9px] uppercase tracking-[0.14em] text-[#60748c]" style={{ fontFamily: "'Fira Code', monospace" }}>
          Turborepo monorepo · Bun/TS · Python/FastAPI · Next.js/Three.js · Zero.xyz · Nexla SDK
        </p>
      </div>
    </div>
  );
}
