"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Activity, CircleDot, PanelRightClose, PanelRightOpen, Power, RotateCcw } from "lucide-react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Sidebar } from "@/components/Sidebar";
import { KpiBar } from "@/components/KpiBar";
import { EventFeed } from "@/components/EventFeed";
import { ArchitecturePanel } from "@/components/ArchitecturePanel";
import { providers } from "@/lib/providers";
import type { ProviderRegistryEntry } from "@resilynx/contracts";

const NetworkCanvas = dynamic(
  () => import("@/components/NetworkCanvas").then((mod) => mod.NetworkCanvas),
  { ssr: false },
);

export default function Home() {
  const { networkStatus, events, connected } = useWebSocket();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeView, setActiveView] = useState("network");
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [mockAlive, setMockAlive] = useState<boolean | null>(null);
  const [liveProviders, setLiveProviders] = useState<ProviderRegistryEntry[]>(providers);
  const [mockAction, setMockAction] = useState<"kill" | "revive" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    fetch("http://localhost:8080/mock/status")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => setMockAlive(data.alive))
      .catch(() => setMockAlive(false));
  }, []);

  useEffect(() => {
    fetch("http://localhost:8080/providers")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => setLiveProviders(data))
      .catch(() => {});
  }, []);

  const runMockAction = async (action: "kill" | "revive") => {
    setMockAction(action);
    setActionError(null);
    try {
      const response = await fetch(`http://localhost:8080/mock/${action}`, { method: "POST" });
      if (!response.ok) throw new Error("Mock service unavailable");
      setMockAlive(action === "revive");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to reach mock service");
    } finally {
      setMockAction(null);
    }
  };

  const setView = (view: string) => {
    setActiveView(view);
    if (view === "events") {
      setRightPanelOpen(true);
    } else if (view === "architecture") {
      setRightPanelOpen(false);
    }
  };

  const toggleActivity = () => {
    setRightPanelOpen((open) => {
      const next = !open;
      setActiveView(next ? "events" : "network");
      return next;
    });
  };

  return (
    <div className="app-shell flex h-[100svh] overflow-hidden">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)}
        activeView={activeView}
        onViewChange={setView}
        connected={connected}
      />

      <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-2 md:p-3">
        <header className="liquid-glass reveal flex shrink-0 flex-wrap items-center justify-between gap-4 rounded-[1.35rem] px-4 py-3 md:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <div className="mb-0.5 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.2em] text-[#8db0c9]" style={{ fontFamily: "'Fira Code', monospace" }}>
                <span>Autonomous resilience</span>
                <span className="h-1 w-1 rounded-full bg-[#5de8ff]" />
                <span className="hidden sm:inline">Live control plane</span>
              </div>
              <h1 className="text-xl font-semibold tracking-[-0.04em] text-[#edf7ff] md:text-2xl">Network resilience, in motion.</h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="hidden items-center gap-2 rounded-xl border border-[rgba(126,211,168,0.15)] bg-[rgba(57,214,189,0.08)] px-3 py-2 sm:flex">
              <span className={`status-dot h-1.5 w-1.5 rounded-full ${connected ? "bg-[#39d6bd] text-[#39d6bd]" : "bg-[#ff637d] text-[#ff637d]"}`} />
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#b6cadc]" style={{ fontFamily: "'Fira Code', monospace" }}>
                {connected ? "Relay online" : "Relay offline"}
              </span>
            </div>
            <button
              onClick={() => runMockAction("kill")}
              disabled={mockAlive === false || mockAction !== null}
              className="flex min-h-10 items-center gap-2 rounded-xl border border-[rgba(255,99,125,0.27)] bg-[rgba(255,99,125,0.1)] px-3 text-[10px] font-medium uppercase tracking-[0.08em] text-[#ffacba] transition duration-200 hover:bg-[rgba(255,99,125,0.17)] disabled:cursor-not-allowed disabled:opacity-40"
              style={{ fontFamily: "'Fira Code', monospace" }}
            >
              <Power size={14} />
              {mockAction === "kill" ? "Simulating" : "Outage drill"}
            </button>
            <button
              onClick={() => runMockAction("revive")}
              disabled={mockAlive !== false || mockAction !== null}
              className="flex min-h-10 items-center gap-2 rounded-xl border border-[rgba(57,214,189,0.25)] bg-[rgba(57,214,189,0.1)] px-3 text-[10px] font-medium uppercase tracking-[0.08em] text-[#8cf2df] transition duration-200 hover:bg-[rgba(57,214,189,0.18)] disabled:cursor-not-allowed disabled:opacity-40"
              style={{ fontFamily: "'Fira Code', monospace" }}
            >
              <RotateCcw size={14} />
              {mockAction === "revive" ? "Restoring" : "Revive"}
            </button>
            <button
              onClick={toggleActivity}
              aria-label={rightPanelOpen ? "Hide activity ledger" : "Show activity ledger"}
              className="flex min-h-10 items-center gap-2 rounded-xl border border-[rgba(174,219,255,0.12)] bg-[rgba(255,255,255,0.035)] px-3 text-[11px] font-medium text-[#a9bed0] transition duration-200 hover:border-[rgba(125,239,255,0.32)] hover:bg-[rgba(93,232,255,0.08)] hover:text-[#e9fbff]"
              style={{ fontFamily: "'Fira Code', monospace" }}
            >
              {rightPanelOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
              <span className="hidden sm:inline">Activity</span>
            </button>
          </div>
          {actionError && <p className="basis-full text-right text-[11px] text-[#ff9aaa]">{actionError}</p>}
        </header>

        <section className="reveal reveal-delay-1 shrink-0">
          <KpiBar networkStatus={networkStatus} providers={liveProviders} />
        </section>

        <div className="reveal reveal-delay-2 relative flex min-h-0 flex-1 gap-3">
          {activeView === "architecture" ? (
            <section className="architecture-shell liquid-glass">
              <ArchitecturePanel />
            </section>
          ) : (
            <>
          <section className="network-stage liquid-glass data-grid-fade relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[1.5rem]">
            <div className="relative z-10 flex flex-wrap items-start justify-between gap-3 border-b border-[rgba(174,219,255,0.08)] px-4 py-3.5 md:px-5">
              <div>
                <div className="mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.2em] text-[#8fb4ca]" style={{ fontFamily: "'Fira Code', monospace" }}>
                  <CircleDot size={12} className="text-[#5de8ff]" />
                  Live topology
                </div>
                <h2 className="text-sm font-semibold text-[#e6f3fb]">Sources converge, normalize, and persist.</h2>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-[rgba(174,219,255,0.1)] bg-[rgba(5,14,30,0.3)] px-3 py-2">
                <Activity size={14} className="text-[#39d6bd]" />
                <span className="text-[10px] uppercase tracking-[0.13em] text-[#a6bed0]" style={{ fontFamily: "'Fira Code', monospace" }}>
                  {liveProviders.length} providers observed
                </span>
              </div>
            </div>
            <div className="relative min-h-[390px] flex-1">
              <NetworkCanvas providers={liveProviders} networkStatus={networkStatus} />
            </div>
            <div className="relative z-10 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[rgba(174,219,255,0.08)] bg-[rgba(5,13,26,0.35)] px-4 py-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[#7890a8] md:px-5" style={{ fontFamily: "'Fira Code', monospace" }}>
              <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#5de8ff]" />Ingest</span>
              <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#39d6bd]" />Standardize</span>
              <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#aa96ff]" />Protect</span>
              <span className="ml-auto hidden text-[#9eb7c9] lg:block">Drag to orbit · scroll to zoom</span>
            </div>
          </section>
            </>
          )}

          {rightPanelOpen && (
            <aside className="absolute inset-0 z-30 overflow-hidden rounded-[1.5rem] 2xl:static 2xl:w-[22rem] 2xl:shrink-0"
              style={{ background: "#060d18", border: "1px solid rgba(174,219,255,0.1)" }}>
              <EventFeed events={events} />
            </aside>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-between px-1 text-[10px] uppercase tracking-[0.15em] text-[#60748c]" style={{ fontFamily: "'Fira Code', monospace" }}>
          <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#39d6bd]" />Live ingestion fabric</span>
          <span>Resilynx / sandbox</span>
        </footer>
      </main>
    </div>
  );
}
