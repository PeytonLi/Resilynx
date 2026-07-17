import { describe, expect, it } from "bun:test";
import { handleRequest, registry } from "./index";

describe("backend HTTP routes", () => {
  it("GET /health returns ok", async () => {
    const res = handleRequest(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /providers returns the provider list", async () => {
    const res = handleRequest(new Request("http://localhost/providers"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("404s on unknown routes", () => {
    const res = handleRequest(new Request("http://localhost/nope"));
    expect(res.status).toBe(404);
  });
});
