/**
 * SQLite persistence — recent NexsetRecords and event history (status
 * transitions / heals). One gitignored DB file at apps/backend/data/resilynx.db.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { NexsetRecord, WsPayload } from "@resilynx/contracts";

const DEFAULT_DB_PATH = path.resolve(import.meta.dir, "../data/resilynx.db");

export class Store {
  private readonly db: Database;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.run(`CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      providerId TEXT NOT NULL,
      metric TEXT NOT NULL,
      value REAL NOT NULL,
      unit TEXT NOT NULL,
      timestamp TEXT NOT NULL
    )`);
    this.db.run(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      nodeId TEXT NOT NULL,
      agentState TEXT,
      message TEXT,
      timestamp TEXT NOT NULL
    )`);
  }

  insertReading(record: NexsetRecord): void {
    this.db.run(
      `INSERT INTO readings (providerId, metric, value, unit, timestamp) VALUES (?, ?, ?, ?, ?)`,
      [record.providerId, record.metric, record.value, record.unit, record.timestamp],
    );
  }

  insertEvent(event: WsPayload): void {
    this.db.run(
      `INSERT INTO events (status, nodeId, agentState, message, timestamp) VALUES (?, ?, ?, ?, ?)`,
      [event.status, event.nodeId, event.agentState ?? null, event.message ?? null, event.timestamp],
    );
  }

  recentReadings(limit = 100): NexsetRecord[] {
    return this.db
      .query(`SELECT providerId, metric, value, unit, timestamp FROM readings ORDER BY id DESC LIMIT ?`)
      .all(limit) as NexsetRecord[];
  }

  recentEvents(limit = 100): WsPayload[] {
    return this.db
      .query(`SELECT status, nodeId, agentState, message, timestamp FROM events ORDER BY id DESC LIMIT ?`)
      .all(limit) as WsPayload[];
  }

  close(): void {
    this.db.close();
  }
}
