import { describe, expect, it } from "bun:test";
import { handleRequest, registry, setHealthMonitor, setStore } from "./index";
import { HealthMonitor } from "./healthMonitor";
import { Store } from "./db";
import type { NexsetRecord } from "@resilynx/contracts";

function makeHealer() {
  return { async heal() {} };
}

describe("backend HTTP routes", () => {
  it("GET /health returns ok", async () => {
    const res = await handleRequest(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /providers returns the provider list", async () => {
    const res = await handleRequest(new Request("http://localhost/providers"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("404s on unknown routes", async () => {
    const res = await handleRequest(new Request("http://localhost/nope"));
    expect(res.status).toBe(404);
  });

  it("GET /status returns 503 when health monitor not initialized", async () => {
    const res = await handleRequest(new Request("http://localhost/status"));
    expect(res.status).toBe(503);
  });

  it("GET /readings returns 503 when store not initialized", async () => {
    const res = await handleRequest(new Request("http://localhost/readings"));
    expect(res.status).toBe(503);
  });

  it("POST /mock/kill proxies to mock provider (or 502 if unreachable)", async () => {
    const res = await handleRequest(new Request("http://localhost/mock/kill", { method: "POST" }));
    // When mock is running on port 4001 (dev mode), expect 200. When not, expect 502.
    expect([200, 502]).toContain(res.status);
    const body = await res.json();
    if (res.status === 502) {
      expect(body.error).toContain("Mock provider unreachable");
    } else {
      expect(body).toHaveProperty("killed");
    }
  });

  it("GET /mock/status returns mock state (or fallback if unreachable)", async () => {
    const res = await handleRequest(new Request("http://localhost/mock/status"));
    const body = await res.json();
    if (res.status === 200 && body.alive !== undefined && !body.error) {
      // Mock is running — body is the proxied response
      expect(typeof body.alive).toBe("boolean");
    } else {
      // Mock unreachable — fallback
      expect(body.alive).toBe(false);
      expect(body.error).toContain("Mock provider unreachable");
    }
  });

  it("all routes include Access-Control-Allow-Origin: *", async () => {
    const routes = ["/health", "/providers", "/status", "/readings"];
    for (const path of routes) {
      const res = await handleRequest(new Request(`http://localhost${path}`));
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    }
  });

  it("OPTIONS preflight returns 204 with CORS headers", async () => {
    const res = await handleRequest(new Request("http://localhost/providers", { method: "OPTIONS" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
  });

  it("/status returns live data when health monitor is initialized", async () => {
    const monitor = new HealthMonitor(makeHealer());
    monitor.recordSuccess("p1");
    monitor.recordSuccess("p2");
    setHealthMonitor(monitor);

    const res = await handleRequest(new Request("http://localhost/status"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("p1");
    expect(body).toHaveProperty("p2");
    expect(body.p1.status).toBe("stable");
  });

  it("/readings returns data when store is initialized", async () => {
    const s = new Store(":memory:");
    const record: NexsetRecord = {
      providerId: "p1",
      metric: "test",
      value: 99,
      unit: "USD",
      timestamp: new Date().toISOString(),
    };
    s.insertReading(record);
    setStore(s);

    const res = await handleRequest(new Request("http://localhost/readings"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as NexsetRecord[];
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].providerId).toBe("p1");
    expect(body[0].value).toBe(99);

    s.close();
  });

  it("/readings respects limit query parameter", async () => {
    const s = new Store(":memory:");
    for (let i = 0; i < 5; i++) {
      s.insertReading({
        providerId: `p${i}`,
        metric: "test",
        value: i,
        unit: "USD",
        timestamp: new Date().toISOString(),
      });
    }
    setStore(s);

    const res = await handleRequest(new Request("http://localhost/readings?limit=2"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as NexsetRecord[];
    expect(body.length).toBe(2);

    s.close();
  });

  it("POST /mock/kill returns proxied JSON on success", async () => {
    // When mock is reachable, expect 200 + {killed:true}. When not, expect 502.
    const res = await handleRequest(new Request("http://localhost/mock/kill", { method: "POST" }));
    expect([200, 502]).toContain(res.status);
    const body = await res.json();
    if (res.status === 200) {
      expect(body.killed).toBe(true);
    }
    // status 502 → mock unreachable, already covered by existing test
  });
});
