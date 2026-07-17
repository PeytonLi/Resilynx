import { describe, expect, it } from "bun:test";
import { handleRequest, registry } from "./index";

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
});
