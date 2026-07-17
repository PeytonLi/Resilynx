import { describe, expect, it } from "bun:test";
import { handleRequest } from "./index";

describe("backend /health", () => {
  it("returns ok", async () => {
    const res = handleRequest(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("404s on unknown routes", () => {
    const res = handleRequest(new Request("http://localhost/nope"));
    expect(res.status).toBe(404);
  });
});
