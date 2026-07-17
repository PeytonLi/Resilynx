"use client";

import { ArrowRight, Database, Globe, Shield, Sparkles, Zap } from "lucide-react";

const dataFlow = [
  {
    icon: Globe,
    color: "#5de8ff",
    title: "External providers",
    detail: "Open-Meteo · USGS · Carbon · Mock Grid",
    meta: "poll every 15–120 seconds",
  },
  {
    icon: Zap,
    color: "#ffba5c",
    title: "Ingestion engine",
    detail: "Fetch, timeout, and failure stream",
    meta: "backend / Bun + TypeScript",
  },
  {
    icon: Sparkles,
    color: "#39d6bd",
    title: "Nexla standardizer",
    detail: "Field mapping → NexsetRecord",
    meta: "Python / FastAPI",
  },
  {
    icon: Database,
    color: "#aa96ff",
    title: "Store + broadcast",
    detail: "SQLite readings and WebSocket events",
    meta: "dashboard receives live state",
  },
];

const recoveryFlow = [
  { number: "01", title: "Failure threshold", detail: "Three consecutive failed polls", color: "#ffba5c" },
  { number: "02", title: "Healing session", detail: "Failure context and lifecycle events", color: "#ff637d" },
  { number: "03", title: "Backup discovery", detail: "Zero.xyz lookup or static backup", color: "#aa96ff" },
  { number: "04", title: "Registry reload", detail: "Provider configuration is re-read", color: "#5de8ff" },
];

const connectorLabels = ["raw payload", "normalized record", "readings + events"];

export function ArchitecturePanel() {
  return (
    <div className="architecture-panel">
      <header className="architecture-panel__header">
        <div className="architecture-panel__badge"><Sparkles size={16} /></div>
        <div>
          <p className="architecture-panel__eyebrow">System map</p>
          <h2>Data path and recovery loop</h2>
          <p className="architecture-panel__intro">The top lane carries data forward. The lower lane reacts only when ingestion fails.</p>
        </div>
      </header>

      <figure className="architecture-diagram" aria-labelledby="architecture-flow-title">
        <figcaption id="architecture-flow-title" className="architecture-diagram__title">
          <span>Primary data flow</span>
          <p>Each source is standardized before persistence and live delivery.</p>
        </figcaption>

        <div className="architecture-flow" role="list" aria-label="Primary data flow">
          {dataFlow.map((stage, index) => {
            const Icon = stage.icon;
            return (
              <div className="architecture-flow__item" role="listitem" key={stage.title}>
                <article className="architecture-stage" style={{ borderColor: `${stage.color}4d` }}>
                  <div className="architecture-stage__icon" style={{ color: stage.color, background: `${stage.color}14`, borderColor: `${stage.color}3d` }}>
                    <Icon size={17} />
                  </div>
                  <div>
                    <h3>{stage.title}</h3>
                    <p>{stage.detail}</p>
                  </div>
                  <span style={{ color: stage.color }}>{stage.meta}</span>
                </article>
                {index < connectorLabels.length && (
                  <div className="architecture-connector" aria-hidden="true">
                    <span>{connectorLabels[index]}</span>
                    <i />
                    <ArrowRight size={15} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="architecture-output">
          <span className="architecture-output__dot" />
          <strong>Unified outcome</strong>
          <p>One consistent record shape, a local audit trail, and a live operator view.</p>
        </div>
      </figure>

      <section className="recovery-loop" aria-labelledby="recovery-title">
        <div className="recovery-loop__heading">
          <div><Shield size={15} /></div>
          <div>
            <p id="recovery-title">Recovery feedback loop</p>
            <span>This branch is activated by failures, not every successful reading.</span>
          </div>
        </div>
        <div className="recovery-loop__track" role="list" aria-label="Recovery feedback loop">
          {recoveryFlow.map((step, index) => (
            <div className="recovery-loop__item" role="listitem" key={step.number}>
              <article className="recovery-card" style={{ borderColor: `${step.color}42` }}>
                <span style={{ color: step.color }}>{step.number}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.detail}</p>
                </div>
              </article>
              {index < recoveryFlow.length - 1 && <ArrowRight className="recovery-loop__arrow" size={15} aria-hidden="true" />}
            </div>
          ))}
        </div>
        <p className="recovery-loop__return"><ArrowRight size={14} /> Registry changes restart the polling loops; successful readings return to the primary data flow.</p>
      </section>

      <footer className="architecture-panel__legend">
        <span><i className="architecture-panel__legend-dot architecture-panel__legend-dot--cyan" />data in motion</span>
        <span><i className="architecture-panel__legend-dot architecture-panel__legend-dot--amber" />failure signal</span>
        <span><i className="architecture-panel__legend-dot architecture-panel__legend-dot--violet" />recovery action</span>
      </footer>
    </div>
  );
}
