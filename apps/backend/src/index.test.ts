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

  it("POST /mock/kill returns 502 when mock provider unreachable", async () => {
    const res = await handleRequest(new Request("http://localhost/mock/kill", { method: "POST" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("Mock provider unreachable");
  });

  it("GET /mock/status returns fallback when mock provider unreachable", async () => {
    const res = await handleRequest(new Request("http://localhost/mock/status"));
    const body = await res.json();
    expect(body.alive).toBe(false);
    expect(body.error).toContain("Mock provider unreachable");
  });
});
