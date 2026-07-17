"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Sidebar } from "@/components/Sidebar";
import { KpiBar } from "@/components/KpiBar";
import { EventFeed } from "@/components/EventFeed";
import { providers } from "@/lib/providers";
import type { ProviderRegistryEntry } from "@resilynx/contracts";
import { X } from "lucide-react";

const NetworkCanvas = dynamic(
  () => import("@/components/NetworkCanvas").then((mod) => mod.NetworkCanvas),
  { ssr: false }
);

export default function Home() {
  const { networkStatus, events, connected } = useWebSocket();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeView, setActiveView] = useState("network");
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [mockAlive, setMockAlive] = useState<boolean | null>(null);
  const [liveProviders, setLiveProviders] = useState<ProviderRegistryEntry[]>(providers);

  useEffect(() => {
    fetch("http://localhost:8080/mock/status")
      .then((r) => r.json())
      .then((d) => setMockAlive(d.alive))
      .catch(() => setMockAlive(false));
  }, []);

  useEffect(() => {
    fetch("http://localhost:8080/providers")
      .then((r) => r.json())
      .then((d) => setLiveProviders(d))
      .catch(() => {});
  }, []);

  const handleKill = async () => {
    await fetch("http://localhost:8080/mock/kill", { method: "POST" });
    setMockAlive(false);
  };
  const handleRevive = async () => {
    await fetch("http://localhost:8080/mock/revive", { method: "POST" });
    setMockAlive(true);
  };

  return (
    <div
      className="flex h-screen"
      style={{ background: "linear-gradient(180deg, #0a0a0f 0%, #020203 100%)" }}
    >
      {/* Sidebar */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((p) => !p)}
        activeView={activeView}
        onViewChange={setActiveView}
      />

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar: KPI + actions */}
        <div className="flex items-end gap-2">
          <div className="flex-1"><KpiBar networkStatus={networkStatus} /></div>
          {/* Connection status + mock controls */}
          <div className="flex items-center gap-2 px-3 py-2 shrink-0 self-center">
            <span
              className="text-[11px] px-2 py-0.5 rounded-full font-medium"
              style={{
                fontFamily: "'Fira Code', monospace",
                background: connected ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                color: connected ? "#22c55e" : "#ef4444",
              }}
            >
              {connected ? "Connected" : "Disconnected"}
            </span>
            <button
              onClick={handleKill}
              disabled={mockAlive === false}
              className="text-[11px] px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                fontFamily: "'Fira Code', monospace",
                background: mockAlive === false ? "rgba(255,255,255,0.05)" : "rgba(239,68,68,0.2)",
                color: mockAlive === false ? "#475569" : "#ef4444",
                border: mockAlive === false ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(239,68,68,0.3)",
              }}
            >
              Kill Mock
            </button>
            <button
              onClick={handleRevive}
              disabled={mockAlive === true || mockAlive === null}
              className="text-[11px] px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                fontFamily: "'Fira Code', monospace",
                background: mockAlive === true ? "rgba(255,255,255,0.05)" : "rgba(34,197,94,0.2)",
                color: mockAlive === true ? "#475569" : "#22c55e",
                border: mockAlive === true ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(34,197,94,0.3)",
              }}
            >
              Revive Mock
            </button>
            <button
              onClick={() => setRightPanelOpen((p) => !p)}
              className="text-[11px] px-2.5 py-1.5 rounded-lg font-medium border border-[rgba(255,255,255,0.1)] text-[#94a3b8] hover:text-[#e2e8f0] hover:border-[rgba(255,255,255,0.2)] transition-colors"
              style={{ fontFamily: "'Fira Code', monospace" }}
            >
              {rightPanelOpen ? "Hide" : "Panel"}
            </button>
          </div>
        </div>

        {/* Canvas + right panel */}
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 relative">
            <NetworkCanvas providers={liveProviders} networkStatus={networkStatus} />
          </div>

          {rightPanelOpen && (
            <div
              className="w-80 shrink-0 border-l h-full"
              style={{
                borderColor: "rgba(255,255,255,0.08)",
                background: "rgba(10,10,15,0.95)",
                backdropFilter: "blur(12px)",
              }}
            >
              {/* Close button */}
              <div className="flex justify-end px-3 pt-2">
                <button
                  onClick={() => setRightPanelOpen(false)}
                  className="p-1 rounded text-[#475569] hover:text-[#94a3b8] hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
              <EventFeed events={events} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
