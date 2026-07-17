import { afterEach, describe, expect, it } from "bun:test";
import { handleRequest, resetForTests } from "./index";

afterEach(() => resetForTests());

describe("mock provider", () => {
  it("GET /data returns payload with reading.sensor, reading.frequency, reading.voltage, reading.unit, reading.ts", async () => {
    const res = handleRequest(new Request("http://localhost/data"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.reading.sensor).toBe("string");
    expect(typeof body.reading.frequency).toBe("number");
    expect(typeof body.reading.voltage).toBe("number");
    expect(body.reading.unit).toBe("Hz");
    expect(typeof body.reading.ts).toBe("string");
  });

  it("GET /status returns { alive: true } when not killed", async () => {
    const res = handleRequest(new Request("http://localhost/status"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alive).toBe(true);
  });

  it("POST /kill makes subsequent GET /data return 503", async () => {
    const killRes = handleRequest(new Request("http://localhost/kill", { method: "POST" }));
    expect(killRes.status).toBe(200);

    const dataRes = handleRequest(new Request("http://localhost/data"));
    expect(dataRes.status).toBe(503);
  });

  it("GET /status returns { alive: false } after kill", async () => {
    handleRequest(new Request("http://localhost/kill", { method: "POST" }));
    const res = handleRequest(new Request("http://localhost/status"));
    const body = await res.json();
    expect(body.alive).toBe(false);
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

  it("cycles through different sensors on successive calls", async () => {
    const sensors = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const res = handleRequest(new Request("http://localhost/data"));
      const body = await res.json();
      sensors.add(body.reading.sensor);
    }
    expect(sensors.size).toBeGreaterThanOrEqual(2);
  });
});
