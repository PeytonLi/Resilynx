"use client";

import { useEffect, useState } from "react";
import { PanelRightClose, PanelRightOpen, Power, RotateCcw } from "lucide-react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Sidebar } from "@/components/Sidebar";
import { KpiBar } from "@/components/KpiBar";
import { EventFeed } from "@/components/EventFeed";
import { ArchitectureFlow } from "@/components/ArchitectureFlow";
import { ArchitecturePanel } from "@/components/ArchitecturePanel";
import { providers } from "@/lib/providers";
import type { ProviderRegistryEntry } from "@resilynx/contracts";

export default function Home() {
  const { networkStatus, events, connected } = useWebSocket();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeView, setActiveView] = useState("architecture");
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [mockAlive, setMockAlive] = useState<boolean | null>(null);
  const [liveProviders, setLiveProviders] = useState<ProviderRegistryEntry[]>(providers);
  const [mockAction, setMockAction] = useState<"kill" | "revive" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    fetch("http://localhost:8080/mock/status")
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((d) => setMockAlive(d.alive))
      .catch(() => setMockAlive(false));
  }, []);

  useEffect(() => {
    fetch("http://localhost:8080/providers")
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((d) => setLiveProviders(d))
      .catch(() => {});
  }, []);

  const runMockAction = async (action: "kill" | "revive") => {
    setMockAction(action); setActionError(null);
    try {
      const r = await fetch(`http://localhost:8080/mock/${action}`, { method: "POST" });
      if (!r.ok) throw new Error("Mock service unavailable");
      setMockAlive(action === "revive");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Unable to reach mock");
    } finally { setMockAction(null); }
  };

  const setView = (view: string) => {
    setActiveView(view);
    if (view === "events") setRightPanelOpen(true);
    if (view === "architecture") setRightPanelOpen(false);
  };

  return (
    <div className="app-shell flex h-[100svh] overflow-hidden">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((c) => !c)}
        activeView={activeView} onViewChange={setView} connected={connected} />

      <main className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden p-2 md:p-3">
        {/* Header */}
        <header className="liquid-glass reveal flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-[1.35rem] px-4 py-2.5 md:px-5">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-[-0.03em] text-[#edf7ff]">Resilynx</h1>
            <p className="text-[10px] uppercase tracking-[0.15em] text-[#60748c]" style={{ fontFamily: "'Fira Code', monospace" }}>
              Self-healing data ingestion sandbox
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden sm:flex items-center gap-2 rounded-lg border border-[rgba(174,219,255,0.1)] px-3 py-1.5 text-[10px] text-[#94a3b8]" style={{ fontFamily: "'Fira Code', monospace" }}>
              <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-[#22c55e]" : "bg-[#ef4444]"}`} />
              {connected ? "Connected" : "Offline"}
            </span>
            <button onClick={() => runMockAction("kill")} disabled={mockAlive === false || mockAction !== null}
              className="flex items-center gap-1.5 rounded-lg border border-[rgba(239,68,68,0.25)] bg-[rgba(239,68,68,0.08)] px-3 py-1.5 text-[10px] font-medium text-[#fca5a5] transition hover:bg-[rgba(239,68,68,0.15)] disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ fontFamily: "'Fira Code', monospace" }}>
              <Power size={12} />{mockAction === "kill" ? "..." : "Kill Mock"}
            </button>
            <button onClick={() => runMockAction("revive")} disabled={mockAlive !== false || mockAction !== null}
              className="flex items-center gap-1.5 rounded-lg border border-[rgba(34,197,94,0.25)] bg-[rgba(34,197,94,0.08)] px-3 py-1.5 text-[10px] font-medium text-[#86efac] transition hover:bg-[rgba(34,197,94,0.15)] disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ fontFamily: "'Fira Code', monospace" }}>
              <RotateCcw size={12} />{mockAction === "revive" ? "..." : "Revive"}
            </button>
            <button onClick={() => setRightPanelOpen((p) => !p)}
              className="flex items-center gap-1.5 rounded-lg border border-[rgba(174,219,255,0.1)] px-3 py-1.5 text-[10px] text-[#94a3b8] transition hover:border-[rgba(174,219,255,0.25)]"
              style={{ fontFamily: "'Fira Code', monospace" }}>
              {rightPanelOpen ? <PanelRightClose size={12} /> : <PanelRightOpen size={12} />}Events
            </button>
          </div>
          {actionError && <p className="basis-full text-right text-[10px] text-[#fca5a5]">{actionError}</p>}
        </header>

        {/* KPI bar */}
        <section className="reveal reveal-delay-1 shrink-0">
          <KpiBar networkStatus={networkStatus} providers={liveProviders} />
        </section>

        {/* Main content */}
        <div className="reveal reveal-delay-2 relative flex min-h-0 flex-1 gap-2">
          <section className="liquid-glass flex min-w-0 flex-1 flex-col overflow-hidden rounded-[1.5rem]">
            {activeView === "architecture-detail" ? <ArchitecturePanel /> : <ArchitectureFlow />}
          </section>

          {rightPanelOpen && (
            <aside className="shrink-0 overflow-hidden rounded-[1.5rem]" style={{ width: 340, background: "#060d18", border: "1px solid rgba(174,219,255,0.1)" }}>
              <EventFeed events={events} />
            </aside>
          )}
        </div>

        {/* Footer */}
        <footer className="flex shrink-0 items-center justify-between px-1 text-[9px] uppercase tracking-[0.12em] text-[#475569]" style={{ fontFamily: "'Fira Code', monospace" }}>
          <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" />Data flowing</span>
          <span>Resilynx v0.0.1</span>
        </footer>
      </main>
    </div>
  );
}
