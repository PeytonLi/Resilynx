/**
 * Killable mock provider — serves a scripted carbon-registry payload in a
 * schema deliberately different from the real APIs, to prove out
 * standardization. POST /kill makes subsequent GET /data return 503;
 * POST /revive restores it.
 */
import { PORTS } from "@resilynx/contracts";

/** Values cycle through plausible carbon-offset readings for demo motion. */
const CARBON_VALUES = [215, 198, 237, 182, 250, 203, 220, 189, 245, 210, 195, 260, 178, 232, 207];
const UNITS = ["gCO2eq/kWh", "kgCO2/MWh", "tCO2/GWh", "gCO2eq/kWh", "kgCO2/MWh",
  "tCO2/GWh", "gCO2eq/kWh", "kgCO2/MWh", "tCO2/GWh", "gCO2eq/kWh",
  "kgCO2/MWh", "tCO2/GWh", "gCO2eq/kWh", "kgCO2/MWh", "tCO2/GWh"];

let killed = false;
let cycleIdx = 0;

function makePayload(): { reading: { value: number; unit: string; ts: string } } {
  const idx = cycleIdx % CARBON_VALUES.length;
  cycleIdx++;
  return {
    reading: {
      value: CARBON_VALUES[idx],
      unit: UNITS[idx],
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
