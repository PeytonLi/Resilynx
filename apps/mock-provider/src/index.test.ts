import { afterEach, describe, expect, it } from "bun:test";
import { handleRequest, resetForTests } from "./index";

afterEach(() => resetForTests());

describe("mock provider", () => {
  it("GET /data returns payload with ticker, price, currency, ts", async () => {
    const res = handleRequest(new Request("http://localhost/data"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.ticker).toBe("string");
    expect(typeof body.price).toBe("number");
    expect(body.currency).toBe("USD");
    expect(typeof body.ts).toBe("string");
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

  it("cycles through different tickers on successive calls", async () => {
    const tickers = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const res = handleRequest(new Request("http://localhost/data"));
      const body = await res.json();
      tickers.add(body.ticker);
    }
    expect(tickers.size).toBeGreaterThanOrEqual(2);
  });
});
