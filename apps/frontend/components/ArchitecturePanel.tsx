"use client";

import { Activity, ArrowRight, Box, Cpu, Database, Globe, Layers, Radio, Server, Shield, Sparkles, Zap } from "lucide-react";

const flowSteps = [
  { icon: Globe, label: "Poll", desc: "Providers polled every 15–120s" },
  { icon: ArrowRight, label: "", desc: "" },
  { icon: Server, label: "Standardize", desc: "Raw payload → Nexla $ resolver → NexsetRecord" },
  { icon: ArrowRight, label: "", desc: "" },
  { icon: Zap, label: "Monitor", desc: "Health monitor tracks consecutive failures" },
  { icon: ArrowRight, label: "", desc: "" },
  { icon: Shield, label: "Heal", desc: "3 failures → Zero.xyz discovery → patch registry" },
  { icon: ArrowRight, label: "", desc: "" },
  { icon: Database, label: "Persist", desc: "Readings + events → SQLite + WebSocket" },
];

const architectureCards = [
  {
    icon: Globe,
    title: "Data Sources",
    subtitle: "4 keyless providers, 4 incompatible schemas",
    color: "#5de8ff",
    bg: "rgba(93,232,255,0.06)",
    border: "rgba(93,232,255,0.18)",
    details: [
      { label: "Open-Meteo", value: "api.open-meteo.com", note: "Weather · flat nested JSON" },
      { label: "USGS Earthquake", value: "earthquake.usgs.gov", note: "Seismic · GeoJSON features array" },
      { label: "UK Carbon Intensity", value: "api.carbonintensity.org.uk", note: "Grid carbon · array-wrapped" },
      { label: "Mock Grid Sensor", value: "localhost:4001", note: "Grid frequency · killable for demo" },
    ],
  },
  {
    icon: Cpu,
    title: "Standardization Engine",
    subtitle: "Unified NexsetRecord output",
    color: "#39d6bd",
    bg: "rgba(57,214,189,0.06)",
    border: "rgba(57,214,189,0.18)",
    details: [
      { label: "Nexla Service", value: "localhost:5001", note: "Python FastAPI · $ prefix dot-path resolver" },
      { label: "Nexla Cloud SDK", value: "dataops.nexla.io", note: "nexla-sdk v1.0.8 · schema validation" },
    ],
  },
  {
    icon: Shield,
    title: "Healing Orchestrator",
    subtitle: "Autonomous provider failover",
    color: "#aa96ff",
    bg: "rgba(170,150,255,0.06)",
    border: "rgba(170,150,255,0.18)",
    details: [
      { label: "Health Monitor", value: "3-failure threshold", note: "Debounces flapping, prevents duplicate heals" },
      { label: "Zero.xyz Discovery", value: "zero CLI", note: "Searches for backup APIs by metric type · $0.08/call avg" },
      { label: "Smart Healer", value: "backups.json fallback", note: "Patches config/providers.json · registry hot-reloads" },
    ],
  },
  {
    icon: Database,
    title: "Persistence & Broadcast",
    subtitle: "Real-time state delivery",
    color: "#ffba5c",
    bg: "rgba(255,186,92,0.06)",
    border: "rgba(255,186,92,0.18)",
    details: [
      { label: "SQLite Store", value: "Bun:sqlite", note: "Readings + event history · local file at apps/backend/data/" },
      { label: "WebSocket", value: "aegis-events channel", note: "Bun.serve pub/sub · stable/degraded/healing/restored" },
      { label: "3D Frontend", value: "Next.js + Three.js", note: "Live topology graph · animated data flow particles" },
    ],
  },
];

export function ArchitecturePanel() {
  return (
    <div className="flex h-full flex-col" style={{ background: "#060d18" }}>
      {/* Header */}
      <div className="shrink-0 px-6 py-5" style={{ borderBottom: "1px solid rgba(93,232,255,0.1)" }}>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{ background: "linear-gradient(135deg, rgba(93,232,255,0.2), rgba(57,214,189,0.1))", border: "1px solid rgba(93,232,255,0.25)" }}>
            <Box size={18} style={{ color: "#8df2ff" }} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#edf7ff]">Resilynx Architecture</h2>
            <p className="text-[10px] tracking-[0.12em] text-[#6f8aa3] uppercase" style={{ fontFamily: "'Fira Code', monospace" }}>
              Self-healing data ingestion pipeline
            </p>
          </div>
        </div>
      </div>

      {/* Flow diagram */}
      <div className="shrink-0 px-6 py-4" style={{ borderBottom: "1px solid rgba(174,219,255,0.06)" }}>
        <h3 className="mb-3 text-[10px] font-medium uppercase tracking-[0.14em] text-[#5de8ff]" style={{ fontFamily: "'Fira Code', monospace" }}>
          Data Flow
        </h3>
        <div className="flex items-center overflow-x-auto pb-1 gap-0">
          {flowSteps.map((step, i) => (
            step.label ? (
              <div key={i} className="flex flex-col items-center shrink-0 px-2" style={{ minWidth: 80 }}>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg mb-1.5"
                  style={{ background: "rgba(93,232,255,0.08)", border: "1px solid rgba(93,232,255,0.15)" }}>
                  <step.icon size={14} style={{ color: "#5de8ff" }} />
                </div>
                <span className="text-[10px] font-semibold text-[#b9d9f0] text-center" style={{ fontFamily: "'Fira Code', monospace" }}>
                  {step.label}
                </span>
                <span className="text-[8px] text-[#60748c] text-center mt-0.5 leading-tight">{step.desc}</span>
              </div>
            ) : (
              <ArrowRight key={i} size={12} className="shrink-0 text-[#5de8ff] mx-0.5" />
            )
          ))}
        </div>
      </div>

      {/* Architecture cards */}
      <div className="flex-1 space-y-2.5 overflow-y-auto px-5 py-4">
        {architectureCards.map((card) => (
          <div key={card.title} className="rounded-xl overflow-hidden"
            style={{ background: card.bg, border: `1px solid ${card.border}` }}>
            {/* Card header */}
            <div className="flex items-center gap-2.5 px-4 py-3"
              style={{ borderBottom: `1px solid ${card.border}`, background: "rgba(0,0,0,0.15)" }}>
              <card.icon size={14} style={{ color: card.color }} />
              <div>
                <span className="text-[11px] font-semibold text-[#e2eef9] block leading-tight">{card.title}</span>
                <span className="text-[9px] text-[#60748c]" style={{ fontFamily: "'Fira Code', monospace" }}>{card.subtitle}</span>
              </div>
            </div>
            {/* Card body */}
            <div className="divide-y" style={{ borderColor: "rgba(174,219,255,0.04)" }}>
              {card.details.map((d) => (
                <div key={d.label} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-medium text-[#c8dae9]">{d.label}</span>
                    <span className="shrink-0 text-[9px] text-[#7890a8]" style={{ fontFamily: "'Fira Code', monospace" }}>
                      {d.value}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-[#6f8aa3]">{d.note}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="shrink-0 px-5 py-3 text-center" style={{ borderTop: "1px solid rgba(174,219,255,0.06)" }}>
        <p className="text-[8px] uppercase tracking-[0.16em] text-[#4a6078]" style={{ fontFamily: "'Fira Code', monospace" }}>
          Turborepo monorepo · Bun/TypeScript · Python/FastAPI · Next.js/Three.js · Zero.xyz · Nexla SDK
        </p>
      </div>
    </div>
  );
}
