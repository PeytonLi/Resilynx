"use client";

import { Activity, AlertTriangle, Database, ShieldCheck } from "lucide-react";
import type { ProviderRegistryEntry } from "@resilynx/contracts";
import type { NodeState } from "@/hooks/useWebSocket";

interface Props {
  networkStatus: Map<string, NodeState>;
  providers: ProviderRegistryEntry[];
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
      className="liquid-glass group flex min-w-[132px] flex-1 items-center gap-3 overflow-hidden rounded-2xl px-3.5 py-3 transition duration-300 hover:-translate-y-0.5 hover:border-[rgba(174,219,255,0.25)]"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border" style={{ color, borderColor: `${color}30`, background: `${color}16` }}>{icon}</div>
      <div className="min-w-0">
        <div className="text-[9px] font-medium uppercase tracking-[0.14em] text-[#7890a8]" style={{ fontFamily: "'Fira Code', monospace" }}>
          {label}
        </div>
        <div className="text-xl font-semibold tabular-nums text-[#edf7ff]" style={{ fontFamily: "'Fira Code', monospace" }}>
          {value}
        </div>
      </div>
    </div>
  );
}

export function KpiBar({ networkStatus, providers }: Props) {
  let healthy = providers.length;
  let degraded = 0;
  let healing = 0;

  providers.forEach((provider) => {
    const status = networkStatus.get(provider.id)?.status;
    if (status === "degraded") {
      degraded++;
      healthy--;
    } else if (status === "healing") {
      healing++;
      healthy--;
    }
  });

  const total = providers.length;

  return (
    <div className="flex gap-2.5 overflow-x-auto pb-1">
      <StatCard label="Stable sources" value={healthy} icon={<ShieldCheck size={18} />} color="#39d6bd" />
      <StatCard label="Attention" value={degraded} icon={<AlertTriangle size={18} />} color="#ffba5c" />
      <StatCard label="Healing runs" value={healing} icon={<Activity size={18} />} color="#ff637d" />
      <StatCard label="Observed" value={total} icon={<Database size={18} />} color="#5de8ff" />
    </div>
  );
}
