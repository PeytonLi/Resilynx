"use client";

import { Shield, AlertTriangle, Activity, Layers } from "lucide-react";
import type { NodeState } from "@/hooks/useWebSocket";

interface Props {
  networkStatus: Map<string, NodeState>;
}

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}

function StatCard({ label, value, icon, color }: StatCardProps) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-lg"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}
    >
      <div className="shrink-0" style={{ color }}>{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] text-[#64748b] uppercase tracking-wider" style={{ fontFamily: "'Fira Code', monospace" }}>
          {label}
        </div>
        <div className="text-lg font-bold text-[#e2e8f0] tabular-nums" style={{ fontFamily: "'Fira Code', monospace" }}>
          {value}
        </div>
      </div>
    </div>
  );
}

export function KpiBar({ networkStatus }: Props) {
  let healthy = 0;
  let degraded = 0;
  let healing = 0;

  networkStatus.forEach((s) => {
    if (s.status === "stable" || s.status === "restored") healthy++;
    else if (s.status === "degraded") degraded++;
    else if (s.status === "healing") healing++;
  });

  const total = networkStatus.size;

  return (
    <div className="flex gap-3 px-4 py-3 shrink-0 overflow-x-auto"
      style={{
        background: "linear-gradient(180deg, rgba(10,10,15,0.98) 0%, rgba(10,10,15,0.9) 100%)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <StatCard label="Healthy" value={healthy} icon={<Shield size={18} />} color="#22c55e" />
      <StatCard label="Degraded" value={degraded} icon={<AlertTriangle size={18} />} color="#f59e0b" />
      <StatCard label="Healing" value={healing} icon={<Activity size={18} />} color="#ef4444" />
      <StatCard label="Total" value={total} icon={<Layers size={18} />} color="#00ffff" />
    </div>
  );
}
