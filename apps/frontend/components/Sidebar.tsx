"use client";

import { Globe, Activity, Settings, PanelLeftClose, PanelLeftOpen } from "lucide-react";

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  activeView: string;
  onViewChange: (view: string) => void;
}

const navItems = [
  { id: "network", label: "Network", icon: Globe },
  { id: "events", label: "Events", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Sidebar({ collapsed, onToggle, activeView, onViewChange }: Props) {
  return (
    <aside
      className={`sidebar-transition flex flex-col border-r shrink-0 h-screen overflow-hidden`}
      style={{
        width: collapsed ? 56 : 240,
        background: "var(--surface)",
        borderColor: "var(--glass-border)",
      }}
    >
      {/* Logo area */}
      <div className="flex items-center gap-2 px-3 py-4 border-b border-[rgba(255,255,255,0.08)]">
        <div className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
          style={{ background: "linear-gradient(135deg, #00ffff, #0ea5e9)", color: "#0a0a0f" }}>
          R
        </div>
        {!collapsed && (
          <span className="font-bold text-[#e2e8f0] tracking-tight whitespace-nowrap" style={{ fontFamily: "'Fira Code', monospace" }}>
            Resilynx
          </span>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-2">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onViewChange(id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm transition-colors duration-150 hover-glow ${
              activeView === id
                ? "text-[#00ffff]"
                : "text-[#94a3b8] hover:text-[#e2e8f0]"
            }`}
            style={{
              background: activeView === id ? "rgba(0,255,255,0.08)" : "transparent",
              borderLeft: activeView === id ? "2px solid #00ffff" : "2px solid transparent",
            }}
          >
            <Icon size={18} className="shrink-0" />
            {!collapsed && <span className="whitespace-nowrap">{label}</span>}
          </button>
        ))}
      </nav>

      {/* Status + collapse toggle */}
      <div className="border-t border-[rgba(255,255,255,0.08)] p-3 flex flex-col gap-2">
        {/* Status indicator */}
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#22c55e] shrink-0 animate-pulse" />
          {!collapsed && (
            <span className="text-[11px] text-[#475569] whitespace-nowrap" style={{ fontFamily: "'Fira Code', monospace" }}>
              System Online
            </span>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          onClick={onToggle}
          className="flex items-center justify-center p-1.5 rounded-md text-[#475569] hover:text-[#94a3b8] hover:bg-[rgba(255,255,255,0.05)] transition-colors"
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
    </aside>
  );
}
