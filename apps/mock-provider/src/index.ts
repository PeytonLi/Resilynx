/**
 * Killable mock provider — serves a scripted grid-sensor payload.
 * POST /kill makes subsequent GET /data return 503;
 * POST /revive restores it.
 * GET /status returns { alive: true/false }.
 */
import { PORTS } from "@resilynx/contracts";

const SENSORS = ["GRID-N1", "GRID-N2", "GRID-N3", "GRID-N4"];
const FREQUENCIES = [49.95, 49.98, 50.01, 50.02, 50.04];

let killed = false;
let cycleIdx = 0;

function makePayload(): { reading: { sensor: string; frequency: number; voltage: number; unit: string; ts: string } } {
  const sensor = SENSORS[cycleIdx % SENSORS.length];
  const frequency = FREQUENCIES[cycleIdx % FREQUENCIES.length];
  cycleIdx++;
  return {
    reading: {
      sensor,
      frequency,
      voltage: 231.4,
      unit: "Hz",
      ts: new Date().toISOString(),
    },
  };
}

export function handleRequest(req: Request): Response {
  const url = new URL(req.url);

  if (url.pathname === "/data" && req.method === "GET") {
    if (killed) return new Response("Service Unavailable", { status: 503 });
    return Response.json(makePayload());
  }

  if (url.pathname === "/status" && req.method === "GET") {
    return Response.json({ alive: !killed });
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
