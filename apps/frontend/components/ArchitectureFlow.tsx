"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity, ArrowRight, Cpu, Database, Globe, Radio,
  Server, Shield, Sparkles, Wifi, Zap, Home, AlertTriangle, CheckCircle, Timer,
} from "lucide-react";
import { useWebSocket, type NodeState } from "@/hooks/useWebSocket";

// ── helpers ──────────────────────────────────────────────────────────

function statusColor(status: string | undefined) {
  if (!status) return "#22c55e";
  if (status === "stable" || status === "restored") return "#22c55e";
  if (status === "degraded") return "#f59e0b";
  if (status === "healing") return "#ef4444";
  return "#22c55e";
}

function statusLabel(status: string | undefined) {
  if (!status) return "healthy";
  if (status === "stable" || status === "restored") return "healthy";
  if (status === "degraded") return "degraded";
  if (status === "healing") return "healing";
  return "healthy";
}

function StatusDot({ status }: { status?: string }) {
  const color = statusColor(status);
  const pulse = status === "healing" || status === "degraded";
  return (
    <span
      className="inline-block h-2 w-2 rounded-full shrink-0"
      style={{
        background: color,
        boxShadow: `0 0 8px ${color}80`,
        animation: pulse ? "pulse 1s ease-in-out infinite" : "none",
      }}
    />
  );
}

interface ProviderDef {
  id: string;
  name: string;
  endpoint: string;
  metric: string;
  unit: string;
  note: string;
}

const PROVIDERS: ProviderDef[] = [
  { id: "open-meteo", name: "Open-Meteo", endpoint: "api.open-meteo.com", metric: "temperature", unit: "°C", note: "London weather station" },
  { id: "usgs-earthquake", name: "USGS Earthquake", endpoint: "earthquake.usgs.gov", metric: "earthquake_magnitude", unit: "M", note: "Global seismicity · GeoJSON" },
  { id: "uk-carbon", name: "UK Carbon Intensity", endpoint: "api.carbonintensity.org.uk", metric: "carbon_intensity", unit: "gCO₂", note: "National Grid live feed" },
  { id: "mock-grid", name: "Mock Grid Sensor", endpoint: "localhost:4001", metric: "grid_frequency", unit: "Hz", note: "Simulated · killable for demo" },
];

function ProviderCard({ def, state }: { def: ProviderDef; state?: NodeState }) {
  const color = statusColor(state?.status);
  return (
    <div
      className="relative rounded-xl overflow-hidden transition-all duration-500"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: `1px solid ${color}30`,
        boxShadow: state?.status === "healing" ? `0 0 20px ${color}20` : "none",
      }}
    >
      {/* status bar */}
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: color }} />

      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <StatusDot status={state?.status} />
            <span className="text-[11px] font-semibold text-[#e2e8f0]" style={{ fontFamily: "'Fira Code', monospace" }}>
              {def.name}
            </span>
          </div>
          <span className="text-[8px] uppercase tracking-[0.1em] text-[#475569]" style={{ fontFamily: "'Fira Code', monospace" }}>
            {statusLabel(state?.status)}
          </span>
        </div>
        <div className="text-[9px] text-[#64748b] mb-2" style={{ fontFamily: "'Fira Code', monospace" }}>
          {def.endpoint}
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-bold tabular-nums text-[#e2e8f0]" style={{ fontFamily: "'Fira Code', monospace" }}>
            {state?.message ? (() => { try { return JSON.parse(state.message).value; } catch { return "—" } })() : "—"}
          </span>
          <span className="text-[10px] text-[#64748b]">{def.unit}</span>
        </div>
        <div className="text-[9px] text-[#475569] mt-0.5" style={{ fontFamily: "'Fira Code', monospace" }}>
          {def.note}
        </div>
      </div>
    </div>
  );
}

// ── flow arrow with animated dot ─────────────────────────────────────

function FlowArrow({ active = true }: { active?: boolean }) {
  return (
    <div className="flex items-center justify-center relative" style={{ width: 48, height: 1 }}>
      <div className="w-full h-px" style={{ background: active ? "rgba(93,232,255,0.4)" : "rgba(239,68,68,0.3)" }} />
      <ArrowRight size={10} className="absolute right-0 -translate-y-1/2" style={{ color: active ? "#5de8ff" : "#ef4444" }} />
      {active && (
        <div
          className="absolute w-1 h-1 rounded-full"
          style={{
            background: "#5de8ff",
            boxShadow: "0 0 6px #5de8ff",
            animation: "flowDot 1.5s ease-in-out infinite",
          }}
        />
      )}
    </div>
  );
}

// ── main component ───────────────────────────────────────────────────

export function ArchitectureFlow() {
  const { networkStatus } = useWebSocket();
  const mockState = networkStatus.get("mock-grid");
  const degradedAt = useRef<number | null>(null);
  const [restoreTime, setRestoreTime] = useState<number | null>(null);

  // Track restore time
  useEffect(() => {
    if (mockState?.status === "degraded" || mockState?.status === "healing") {
      if (!degradedAt.current) degradedAt.current = Date.now();
    }
    if ((mockState?.status === "stable" || mockState?.status === "restored") && degradedAt.current) {
      setRestoreTime((Date.now() - degradedAt.current) / 1000);
      degradedAt.current = null;
    }
  }, [mockState?.status]);

  const isDegraded = mockState?.status === "degraded" || mockState?.status === "healing";
  const justRestored = mockState?.status === "restored" && restoreTime !== null;

  return (
    <div className="flex h-full flex-col" style={{ background: "#060d18" }}>
      {/* Header */}
      <div className="shrink-0 px-6 py-4 flex items-center justify-between border-b" style={{ borderColor: "rgba(174,219,255,0.06)" }}>
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ background: "rgba(93,232,255,0.1)", border: "1px solid rgba(93,232,255,0.2)" }}>
            <Cpu size={15} style={{ color: "#5de8ff" }} />
          </div>
          <div>
            <h2 className="text-[13px] font-semibold text-[#edf7ff]">Live Architecture</h2>
            <p className="text-[9px] tracking-[0.1em] text-[#60748c] uppercase" style={{ fontFamily: "'Fira Code', monospace" }}>
              Each provider standardizes through the Nexla core
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-[9px] text-[#60748c]" style={{ fontFamily: "'Fira Code', monospace" }}>
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" />Healthy</span>
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#f59e0b]" />Degraded</span>
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#ef4444]" />Healing</span>
        </div>
      </div>

      {/* Architecture flow */}
      <div className="flex-1 flex flex-col min-h-0 overflow-auto">
        {/* ── HUMAN IMPACT BANNER ── */}
        <div className="shrink-0 px-8 pt-4 pb-2">
          <div className="rounded-2xl overflow-hidden transition-all duration-700"
            style={{
              background: isDegraded
                ? "linear-gradient(135deg, rgba(239,68,68,0.15), rgba(245,158,11,0.08))"
                : justRestored
                  ? "linear-gradient(135deg, rgba(34,197,94,0.15), rgba(57,214,189,0.08))"
                  : "linear-gradient(135deg, rgba(34,197,94,0.06), rgba(57,214,189,0.03))",
              border: `1px solid ${isDegraded ? "rgba(239,68,68,0.3)" : justRestored ? "rgba(34,197,94,0.3)" : "rgba(34,197,94,0.12)"}`,
            }}
          >
            <div className="flex items-center gap-6 px-6 py-5">
              {/* Icon */}
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl transition-all duration-500"
                style={{
                  background: isDegraded
                    ? "rgba(239,68,68,0.2)"
                    : justRestored
                      ? "rgba(34,197,94,0.2)"
                      : "rgba(34,197,94,0.1)",
                  border: `2px solid ${isDegraded ? "rgba(239,68,68,0.4)" : justRestored ? "rgba(34,197,94,0.4)" : "rgba(34,197,94,0.2)"}`,
                }}
              >
                {isDegraded
                  ? <AlertTriangle size={26} style={{ color: "#ef4444" }} />
                  : justRestored
                    ? <CheckCircle size={26} style={{ color: "#22c55e" }} />
                    : <Home size={26} style={{ color: "#22c55e" }} />
                }
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="text-base font-bold text-[#edf7ff]" style={{ fontFamily: "'Fira Code', monospace" }}>
                    {isDegraded
                      ? "GRID MONITORING: OFFLINE"
                      : justRestored
                        ? "GRID MONITORING: RESTORED"
                        : "GRID MONITORING: ACTIVE"
                    }
                  </h3>
                  <span className={`text-[10px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-md ${isDegraded ? "bg-[rgba(239,68,68,0.2)] text-[#fca5a5]" : justRestored ? "bg-[rgba(34,197,94,0.2)] text-[#86efac]" : "bg-[rgba(34,197,94,0.15)] text-[#86efac]"}`}
                    style={{ fontFamily: "'Fira Code', monospace" }}>
                    {isDegraded ? "OUTAGE" : justRestored ? "RECOVERED" : "HEALTHY"}
                  </span>
                </div>

                <p className="text-[13px] text-[#b9d9f0] leading-relaxed">
                  {isDegraded
                    ? "Estimated impact: 50,000 households without real-time grid monitoring. Resilynx is autonomously restoring service..."
                    : justRestored
                      ? `Service restored in ${restoreTime?.toFixed(1)}s — 50,000 households back online. Zero human intervention required.`
                      : "All systems operational. 50,000 households receiving real-time grid frequency monitoring via the national data feed."
                  }
                </p>

                {/* Stats row */}
                <div className="flex items-center gap-6 mt-3">
                  <div className="flex items-center gap-2 text-[10px]" style={{ fontFamily: "'Fira Code', monospace" }}>
                    <Home size={12} style={{ color: isDegraded ? "#fca5a5" : "#86efac" }} />
                    <span className="text-[#94a3b8]">Households:</span>
                    <span className={`font-semibold ${isDegraded ? "text-[#fca5a5]" : "text-[#86efac]"}`}>
                      {isDegraded ? "50,000 at risk" : "50,000 protected"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]" style={{ fontFamily: "'Fira Code', monospace" }}>
                    <Timer size={12} style={{ color: justRestored ? "#22c55e" : "#94a3b8" }} />
                    <span className="text-[#94a3b8]">Restore time:</span>
                    <span className={`font-semibold ${justRestored ? "text-[#22c55e]" : "text-[#94a3b8]"}`}>
                      {justRestored ? `${restoreTime?.toFixed(1)}s` : "N/A"}
                    </span>
                  </div>
                  {isDegraded && (
                    <div className="flex items-center gap-2 text-[10px]" style={{ fontFamily: "'Fira Code', monospace" }}>
                      <Activity size={12} style={{ color: "#f59e0b" }} />
                      <span className="text-[#94a3b8]">Agent:</span>
                      <span className="font-semibold text-[#fbbf24]">
                        {mockState?.agentState || "detecting..."}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── ARCHITECTURE FLOW ── */}
      <div className="flex-1 flex items-center justify-center px-8 py-4 min-h-0 overflow-auto">
        <div className="flex items-start gap-6 w-full max-w-4xl">
          {/* ── LEFT: Provider column ── */}
          <div className="flex flex-col gap-3 shrink-0" style={{ width: 240 }}>
            <div className="flex items-center gap-2 mb-1 px-1">
              <Globe size={13} style={{ color: "#5de8ff" }} />
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#94a3b8]">Providers</span>
            </div>
            {PROVIDERS.map((def) => (
              <ProviderCard key={def.id} def={def} state={networkStatus.get(def.id)} />
            ))}
          </div>

          {/* ── Flow arrows ── */}
          <div className="flex flex-col gap-3 justify-center shrink-0" style={{ paddingTop: 24 }}>
            {PROVIDERS.map((def) => {
              const state = networkStatus.get(def.id);
              const active = !state || state.status === "stable" || state.status === "restored";
              return (
                <div key={def.id} style={{ height: 104 }}>
                  <FlowArrow active={active} />
                </div>
              );
            })}
          </div>

          {/* ── CENTER: Nexla Core ── */}
          <div className="flex flex-col gap-4 shrink-0" style={{ width: 280 }}>
            <div className="rounded-xl overflow-hidden" style={{ background: "rgba(57,214,189,0.05)", border: "1px solid rgba(57,214,189,0.18)" }}>
              <div className="px-4 py-3 flex items-center gap-2.5 border-b" style={{ borderColor: "rgba(57,214,189,0.1)", background: "rgba(0,0,0,0.2)" }}>
                <Server size={14} style={{ color: "#39d6bd" }} />
                <span className="text-[11px] font-semibold text-[#39d6bd] uppercase tracking-[0.06em]" style={{ fontFamily: "'Fira Code', monospace" }}>
                  Nexla Core
                </span>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <div className="text-[10px] text-[#64748b] mb-0.5" style={{ fontFamily: "'Fira Code', monospace" }}>STANDARDIZATION</div>
                  <div className="text-[11px] text-[#b9d9f0] leading-relaxed">
                    FastAPI · $ prefix dot-path resolver
                  </div>
                  <div className="text-[9px] text-[#60748c] mt-0.5" style={{ fontFamily: "'Fira Code', monospace" }}>
                    Raw payloads → unified NexsetRecords
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[#64748b] mb-0.5" style={{ fontFamily: "'Fira Code', monospace" }}>NEXLA CLOUD</div>
                  <div className="text-[11px] text-[#b9d9f0] leading-relaxed">
                    nexla-sdk v1.0.8 · schema validation
                  </div>
                  <div className="text-[9px] text-[#60748c] mt-0.5" style={{ fontFamily: "'Fira Code', monospace" }}>
                    dataops.nexla.io
                  </div>
                </div>
              </div>
            </div>

            {/* Healer */}
            <div className="rounded-xl overflow-hidden" style={{ background: "rgba(170,150,255,0.05)", border: "1px solid rgba(170,150,255,0.18)" }}>
              <div className="px-4 py-3 flex items-center gap-2.5 border-b" style={{ borderColor: "rgba(170,150,255,0.1)", background: "rgba(0,0,0,0.2)" }}>
                <Shield size={14} style={{ color: "#aa96ff" }} />
                <span className="text-[11px] font-semibold text-[#aa96ff] uppercase tracking-[0.06em]" style={{ fontFamily: "'Fira Code', monospace" }}>
                  Healing Orchestrator
                </span>
              </div>
              <div className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[#94a3b8]" style={{ fontFamily: "'Fira Code', monospace" }}>Health monitor</span>
                  <span className="text-[9px] text-[#a78bfa]">3-fail threshold</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[#94a3b8]" style={{ fontFamily: "'Fira Code', monospace" }}>Zero.xyz discovery</span>
                  <span className="text-[9px] text-[#a78bfa]">zero CLI</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[#94a3b8]" style={{ fontFamily: "'Fira Code', monospace" }}>Smart healer fallback</span>
                  <span className="text-[9px] text-[#a78bfa]">backups.json</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Flow arrow → right ── */}
          <div className="flex items-center shrink-0" style={{ paddingTop: 24 }}>
            <div className="flex flex-col items-center gap-1">
              <FlowArrow active />
              <span className="text-[8px] text-[#60748c] -mt-1" style={{ fontFamily: "'Fira Code', monospace" }}>DATA</span>
            </div>
          </div>

          {/* ── RIGHT: Output ── */}
          <div className="flex flex-col gap-4 shrink-0" style={{ width: 220 }}>
            <div className="rounded-xl overflow-hidden" style={{ background: "rgba(93,232,255,0.05)", border: "1px solid rgba(93,232,255,0.18)" }}>
              <div className="px-4 py-3 flex items-center gap-2.5 border-b" style={{ borderColor: "rgba(93,232,255,0.1)", background: "rgba(0,0,0,0.2)" }}>
                <Database size={14} style={{ color: "#5de8ff" }} />
                <span className="text-[11px] font-semibold text-[#5de8ff] uppercase tracking-[0.06em]" style={{ fontFamily: "'Fira Code', monospace" }}>
                  SQLite Store
                </span>
              </div>
              <div className="p-4">
                <div className="text-[10px] text-[#94a3b8] leading-relaxed">
                  Bun:sqlite · readings + events
                </div>
                <div className="text-[9px] text-[#60748c] mt-1" style={{ fontFamily: "'Fira Code', monospace" }}>
                  apps/backend/data/
                </div>
              </div>
            </div>

            <div className="rounded-xl overflow-hidden" style={{ background: "rgba(255,186,92,0.05)", border: "1px solid rgba(255,186,92,0.18)" }}>
              <div className="px-4 py-3 flex items-center gap-2.5 border-b" style={{ borderColor: "rgba(255,186,92,0.1)", background: "rgba(0,0,0,0.2)" }}>
                <Wifi size={14} style={{ color: "#ffba5c" }} />
                <span className="text-[11px] font-semibold text-[#ffba5c] uppercase tracking-[0.06em]" style={{ fontFamily: "'Fira Code', monospace" }}>
                  WebSocket
                </span>
              </div>
              <div className="p-4">
                <div className="text-[10px] text-[#94a3b8] leading-relaxed">
                  Bun.serve · aegis-events
                </div>
                <div className="text-[9px] text-[#60748c] mt-1" style={{ fontFamily: "'Fira Code', monospace" }}>
                  ws://localhost:8080
                </div>
              </div>
            </div>

            <div className="rounded-xl overflow-hidden" style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.18)" }}>
              <div className="px-4 py-3 flex items-center gap-2.5 border-b" style={{ borderColor: "rgba(34,197,94,0.1)", background: "rgba(0,0,0,0.2)" }}>
                <Sparkles size={14} style={{ color: "#22c55e" }} />
                <span className="text-[11px] font-semibold text-[#22c55e] uppercase tracking-[0.06em]" style={{ fontFamily: "'Fira Code', monospace" }}>
                  Output
                </span>
              </div>
              <div className="p-4">
                <div className="text-[10px] text-[#94a3b8] leading-relaxed">
                  Next.js + 3D topology graph
                </div>
                <div className="text-[9px] text-[#60748c] mt-1" style={{ fontFamily: "'Fira Code', monospace" }}>
                  localhost:3000
                </div>
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>

      <style>{`
        @keyframes flowDot {
          0% { left: 0; opacity: 1; }
          80% { left: 36px; opacity: 0.3; }
          100% { left: 36px; opacity: 0; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.3); }
        }
      `}</style>
    </div>
  );
}
