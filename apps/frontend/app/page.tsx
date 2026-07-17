"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useWebSocket } from "@/hooks/useWebSocket";
import { EventFeed } from "@/components/EventFeed";
import { ReadingsPanel } from "@/components/ReadingsPanel";
import { providers } from "@/lib/providers";
import type { ProviderRegistryEntry } from "@resilynx/contracts";

const NetworkCanvas = dynamic(
  () => import("@/components/NetworkCanvas").then((mod) => mod.NetworkCanvas),
  { ssr: false }
);

export default function Home() {
  const { networkStatus, events, connected } = useWebSocket();
  const [mockAlive, setMockAlive] = useState<boolean | null>(null);
  const [liveProviders, setLiveProviders] = useState<ProviderRegistryEntry[]>(providers);
  const [showReadings, setShowReadings] = useState(false);

  useEffect(() => {
    fetch("http://localhost:8080/mock/status")
      .then(r => r.json())
      .then(d => setMockAlive(d.alive))
      .catch(() => setMockAlive(false));
  }, []);

  useEffect(() => {
    fetch("http://localhost:8080/providers")
      .then(r => r.json())
      .then(d => setLiveProviders(d))
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
    <div style={{ display: "flex", height: "100vh", background: "#0a0a0f" }}>
      <header
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          background: "linear-gradient(180deg, #0a0a0fdd 60%, transparent)",
          pointerEvents: "none",
        }}
      >
        <h1
          style={{
            fontSize: "18px",
            fontWeight: 700,
            color: "#e2e8f0",
            letterSpacing: "-0.02em",
          }}
        >
          Resilynx — Provider Network Sandbox
        </h1>
        <span
          style={{
            fontSize: "12px",
            padding: "2px 10px",
            borderRadius: 999,
            background: connected ? "#22c55e22" : "#ef444422",
            color: connected ? "#22c55e" : "#ef4444",
            fontWeight: 500,
          }}
        >
          {connected ? "Connected" : "Disconnected"}
        </span>
      </header>

      <div style={{
        position: "absolute", top: 50, left: 0, right: 0, zIndex: 10,
        padding: "8px 24px", display: "flex", gap: 12, alignItems: "center",
        pointerEvents: "auto"
      }}>
        <button onClick={handleKill} disabled={mockAlive === false}
          style={{ padding: "6px 16px", borderRadius: 6, border: "none",
            background: mockAlive === false ? "#334155" : "#dc2626",
            color: "#fff", cursor: mockAlive === false ? "default" : "pointer",
            fontSize: "13px", fontWeight: 600 }}>
          Kill Mock Grid
        </button>
        <button onClick={handleRevive} disabled={mockAlive === true || mockAlive === null}
          style={{ padding: "6px 16px", borderRadius: 6, border: "none",
            background: mockAlive === true ? "#334155" : "#16a34a",
            color: "#fff", cursor: mockAlive === true ? "default" : "pointer",
            fontSize: "13px", fontWeight: 600 }}>
          Revive Mock Grid
        </button>
        <button onClick={() => setShowReadings(!showReadings)}
          style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid #334155",
            background: "transparent", color: "#94a3b8", cursor: "pointer",
            fontSize: "13px" }}>
          {showReadings ? "Events" : "Readings"}
        </button>
      </div>

      <div style={{ flex: "0 0 70%", position: "relative" }}>
        <NetworkCanvas
          providers={liveProviders}
          networkStatus={networkStatus}
        />
      </div>

      <div style={{ flex: "0 0 30%", borderLeft: "1px solid #1e293b" }}>
        {showReadings ? <ReadingsPanel /> : <EventFeed events={events} />}
      </div>
    </div>
  );
}
