import { afterEach, describe, expect, it } from "bun:test";
import { handleRequest, resetForTests } from "./index";

afterEach(() => resetForTests());

describe("mock provider", () => {
  it("GET /data returns payload with reading.value, reading.unit, reading.ts", async () => {
    const res = handleRequest(new Request("http://localhost/data"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.reading).toBe("object");
    expect(typeof body.reading.value).toBe("number");
    expect(typeof body.reading.unit).toBe("string");
    expect(typeof body.reading.ts).toBe("string");
  });

  it("POST /kill makes subsequent GET /data return 503", async () => {
    const killRes = handleRequest(new Request("http://localhost/kill", { method: "POST" }));
    expect(killRes.status).toBe(200);

    const dataRes = handleRequest(new Request("http://localhost/data"));
    expect(dataRes.status).toBe(503);
  });

  it("POST /revive restores GET /data after a kill", async () => {
    handleRequest(new Request("http://localhost/kill", { method: "POST" }));
    const reviveRes = handleRequest(new Request("http://localhost/revive", { method: "POST" }));
    expect(reviveRes.status).toBe(200);

    const dataRes = handleRequest(new Request("http://localhost/data"));
    expect(dataRes.status).toBe(200);
  });

  it("404s on unknown routes", () => {
    const res = handleRequest(new Request("http://localhost/nope"));
    expect(res.status).toBe(404);
  });

  it("cycles through different values on successive calls", async () => {
    const vals = new Set<number>();
    for (let i = 0; i < 5; i++) {
      const res = handleRequest(new Request("http://localhost/data"));
      const body = await res.json();
      vals.add(body.reading.value);
    }
    expect(vals.size).toBeGreaterThanOrEqual(2);
  });
});
