"use client";

import { Layers, Network, PanelLeftClose, PanelLeftOpen, Radio } from "lucide-react";

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  activeView: string;
  onViewChange: (view: string) => void;
  connected: boolean;
}

const navItems = [
  { id: "architecture", label: "Architecture", icon: Layers },
  { id: "architecture-detail", label: "Details", icon: Network },
];

export function Sidebar({ collapsed, onToggle, activeView, onViewChange, connected }: Props) {
  return (
    <aside
      className="sidebar-transition liquid-glass z-20 m-3 mr-0 flex h-[calc(100svh-1.5rem)] shrink-0 flex-col overflow-hidden rounded-[1.35rem]"
      style={{
        width: collapsed ? 60 : 224,
      }}
    >
      <div className="flex items-center gap-2 border-b border-[rgba(174,219,255,0.09)] px-3 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[rgba(125,239,255,0.42)] bg-[linear-gradient(145deg,#76edff,#3789d9)] text-sm font-bold text-[#06101e] shadow-[0_0_24px_rgba(93,232,255,0.24)]" style={{ fontFamily: "'Fira Code', monospace" }}>
          R
        </div>
        {!collapsed && (
          <div className="min-w-0 whitespace-nowrap">
            <span className="block font-semibold tracking-[-0.03em] text-[#eaf7ff]">Resilynx</span>
            <span className="block text-[9px] uppercase tracking-[0.16em] text-[#6f8aa3]" style={{ fontFamily: "'Fira Code', monospace" }}>Control plane</span>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 px-2 py-3" aria-label="Dashboard views">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onViewChange(id)}
            aria-label={label}
            title={collapsed ? label : undefined}
            className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm transition duration-200 ${
              activeView === id
                ? "border border-[rgba(93,232,255,0.24)] bg-[rgba(93,232,255,0.1)] text-[#b9f7ff] shadow-[0_8px_24px_rgba(24,161,188,0.08)]"
                : "border border-transparent text-[#829cb4] hover:bg-[rgba(255,255,255,0.045)] hover:text-[#e7f5ff]"
            }`}
          >
            <Icon size={18} className="shrink-0" />
            {!collapsed && <span className="whitespace-nowrap">{label}</span>}
          </button>
        ))}
      </nav>

      <div className="flex flex-col gap-2 border-t border-[rgba(174,219,255,0.09)] p-3">
        <div className="flex items-center gap-2 rounded-lg px-1.5 py-1.5">
          <Radio size={14} className={connected ? "text-[#39d6bd]" : "text-[#ff637d]"} />
          {!collapsed && (
            <span className="whitespace-nowrap text-[10px] uppercase tracking-[0.12em] text-[#758ea5]" style={{ fontFamily: "'Fira Code', monospace" }}>
              {connected ? "Relay live" : "Relay offline"}
            </span>
          )}
        </div>

        <button
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex min-h-9 items-center justify-center rounded-lg text-[#6e879f] transition hover:bg-[rgba(255,255,255,0.05)] hover:text-[#dceefa]"
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
    </aside>
  );
}
