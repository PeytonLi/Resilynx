"use client";
import { useState, useEffect, useRef } from "react";
import type { NexsetRecord } from "@resilynx/contracts";

export function ReadingsPanel() {
  const [readings, setReadings] = useState<NexsetRecord[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchReadings = () => {
      fetch("http://localhost:8080/readings?limit=30")
        .then(r => r.json())
        .then(d => setReadings(d))
        .catch(() => {});
    };
    fetchReadings();
    const interval = setInterval(fetchReadings, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [readings.length]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#0f0f1a" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #1e293b", fontSize: "13px", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Live Readings ({readings.length})
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {readings.length === 0 && (
          <div style={{ padding: "24px 16px", color: "#475569", fontSize: "13px", textAlign: "center" }}>
            Waiting for data...
          </div>
        )}
        {readings.map((r, i) => (
          <div key={`${r.providerId}-${r.timestamp}-${i}`} style={{ padding: "8px 16px", borderBottom: "1px solid #1e293b33", fontSize: "12px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span style={{ color: "#22c55e", fontWeight: 600 }}>{r.providerId}</span>
              <span style={{ color: "#94a3b8" }}>{r.metric}:</span>
              <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{r.value}</span>
              <span style={{ color: "#64748b" }}>{r.unit}</span>
            </div>
            <div style={{ color: "#475569", fontSize: "10px", marginTop: 2 }}>{new Date(r.timestamp).toLocaleTimeString()}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
