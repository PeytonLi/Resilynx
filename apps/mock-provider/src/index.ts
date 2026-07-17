/**
 * Killable mock provider — serves a scripted financial-exchange payload in a
 * schema deliberately different from the real APIs, to prove out
 * standardization. POST /kill makes subsequent GET /data return 503;
 * POST /revive restores it.
 */
import { PORTS } from "@resilynx/contracts";

const TICKERS = ["MOCK", "ALPHA", "BETA", "GAMMA"];
const PRICES = [215.5, 198.3, 227.1, 203.7, 241.2];

let killed = false;
let cycleIdx = 0;

function makePayload(): { ticker: string; price: number; currency: string; ts: string } {
  const ticker = TICKERS[cycleIdx % TICKERS.length];
  const price = PRICES[cycleIdx % PRICES.length];
  cycleIdx++;
  return {
    ticker,
    price,
    currency: "USD",
    ts: new Date().toISOString(),
  };
}

export function handleRequest(req: Request): Response {
  const url = new URL(req.url);

  if (url.pathname === "/data" && req.method === "GET") {
    if (killed) return new Response("Service Unavailable", { status: 503 });
    return Response.json(makePayload());
  }

  if (url.pathname === "/kill" && req.method === "POST") {
    killed = true;
    return Response.json({ killed: true });
  }

  if (url.pathname === "/revive" && req.method === "POST") {
    killed = false;
    return Response.json({ killed: false });
  }

  return new Response("Not Found", { status: 404 });
}

/** Test-only hook to reset the in-memory kill switch between tests. */
export function resetForTests(): void {
  killed = false;
  cycleIdx = 0;
}

if (import.meta.main) {
  const server = Bun.serve({ port: PORTS.mockProvider, fetch: handleRequest });
  console.log(`mock-provider listening on :${server.port}`);
}
