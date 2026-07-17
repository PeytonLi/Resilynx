"use client";

import { Box, Cpu, Database, Globe, Server, Shield, Zap } from "lucide-react";

const cards = [
  {
    icon: Globe, title: "Data Sources", subtitle: "4 keyless providers", color: "#5de8ff", bg: "rgba(93,232,255,0.05)", border: "rgba(93,232,255,0.18)",
    items: [
      ["Open-Meteo", "api.open-meteo.com", "Weather · flat nested JSON"],
      ["USGS Earthquake", "earthquake.usgs.gov", "Seismic · GeoJSON array"],
      ["UK Carbon Intensity", "api.carbonintensity.org.uk", "Grid carbon · array-wrapped"],
      ["Mock Grid Sensor", "localhost:4001", "Grid frequency · killable"],
    ],
  },
  {
    icon: Cpu, title: "Standardization Engine", subtitle: "Unified NexsetRecords", color: "#39d6bd", bg: "rgba(57,214,189,0.05)", border: "rgba(57,214,189,0.18)",
    items: [
      ["Nexla Service", "localhost:5001", "Python FastAPI · $ prefix resolver"],
      ["Nexla Cloud SDK", "dataops.nexla.io", "nexla-sdk v1.0.8 · schema validation"],
    ],
  },
  {
    icon: Shield, title: "Healing Orchestrator", subtitle: "Autonomous failover", color: "#aa96ff", bg: "rgba(170,150,255,0.05)", border: "rgba(170,150,255,0.18)",
    items: [
      ["Health Monitor", "3-failure threshold", "Debounces flapping"],
      ["Zero.xyz Discovery", "zero CLI", "Searches backup APIs by metric"],
      ["Smart Healer", "backups.json fallback", "Patches providers.json"],
    ],
  },
  {
    icon: Database, title: "Persistence & Broadcast", subtitle: "Real-time delivery", color: "#ffba5c", bg: "rgba(255,186,92,0.05)", border: "rgba(255,186,92,0.18)",
    items: [
      ["SQLite Store", "Bun:sqlite", "Readings + event history"],
      ["WebSocket", "aegis-events", "Bun.serve pub/sub"],
      ["3D Frontend", "Next.js + Three.js", "Live topology visualization"],
    ],
  },
];

export function ArchitecturePanel() {
  return (
    <div className="flex h-full flex-col" style={{ background: "#060d18" }}>
      <div className="shrink-0 px-6 py-4 border-b" style={{ borderColor: "rgba(174,219,255,0.06)" }}>
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "rgba(93,232,255,0.1)", border: "1px solid rgba(93,232,255,0.2)" }}>
            <Box size={15} style={{ color: "#5de8ff" }} />
          </div>
          <div>
            <h2 className="text-[13px] font-semibold text-[#edf7ff]">System Details</h2>
            <p className="text-[9px] tracking-[0.1em] text-[#60748c] uppercase" style={{ fontFamily: "'Fira Code', monospace" }}>
              Full architecture reference
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
        {cards.map((card) => (
          <div key={card.title} className="rounded-xl overflow-hidden" style={{ background: card.bg, border: `1px solid ${card.border}` }}>
            <div className="flex items-center gap-2.5 px-4 py-2.5" style={{ borderBottom: `1px solid ${card.border}`, background: "rgba(0,0,0,0.2)" }}>
              <card.icon size={13} style={{ color: card.color }} />
              <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#e2eef9]" style={{ fontFamily: "'Fira Code', monospace" }}>{card.title}</span>
              <span className="text-[8px] text-[#60748c] ml-auto">{card.subtitle}</span>
            </div>
            <div className="divide-y" style={{ borderColor: "rgba(174,219,255,0.04)" }}>
              {card.items.map(([name, value, note]) => (
                <div key={name} className="px-4 py-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] font-medium text-[#c8dae9]">{name}</span>
                    <span className="text-[9px] text-[#60748c]" style={{ fontFamily: "'Fira Code', monospace" }}>{value}</span>
                  </div>
                  <div className="text-[9px] text-[#6f8aa3] mt-0.5">{note}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
