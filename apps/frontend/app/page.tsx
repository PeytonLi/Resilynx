"use client";

import dynamic from "next/dynamic";
import { useWebSocket } from "@/hooks/useWebSocket";
import { EventFeed } from "@/components/EventFeed";
import { providers } from "@/lib/providers";

const NetworkCanvas = dynamic(
  () => import("@/components/NetworkCanvas").then((mod) => mod.NetworkCanvas),
  { ssr: false }
);

export default function Home() {
  const { networkStatus, events, connected } = useWebSocket();

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

      <div style={{ flex: "0 0 70%", position: "relative" }}>
        <NetworkCanvas
          providers={providers}
          networkStatus={networkStatus}
        />
      </div>

      <div style={{ flex: "0 0 30%", borderLeft: "1px solid #1e293b" }}>
        <EventFeed events={events} />
      </div>
    </div>
  );
}
