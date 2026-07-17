/**
 * Real Zero.xyz integration — calls the `zero` CLI for provider discovery.
 *
 * Search + get are free. Fetch costs money per call and is used only for
 * validation, not during every poll cycle.
 *
 * The `zero` CLI must be installed and authenticated (zero auth whoami).
 */
import type { ProviderRegistryEntry } from "@resilynx/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ZeroCallResult {
  rawPayload: unknown;
  perCallCostUsd: number;
}

export interface ZeroRunner {
  /** Fetch live data from a Zero.xyz-backed provider endpoint. Costs money. */
  fetch(provider: ProviderRegistryEntry): Promise<unknown>;
}

export interface ZeroDiscoveryRunner extends ZeroRunner {
  /** Search Zero.xyz for backup providers matching the failed provider's data type. Free. */
  discover(failed: ProviderRegistryEntry): Promise<ProviderRegistryEntry>;
}

// ---------------------------------------------------------------------------
// Metric → search query mapping
// ---------------------------------------------------------------------------

const METRIC_SEARCH_QUERIES: Record<string, string> = {
  grid_frequency: "real-time power grid frequency data API",
  temperature: "real-time weather temperature API",
  earthquake_magnitude: "real-time earthquake seismic data API",
  carbon_intensity: "real-time carbon intensity emissions API",
};

function searchQuery(metric: string): string {
  return METRIC_SEARCH_QUERIES[metric] ?? `real-time ${metric.replace(/_/g, " ")} data API`;
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

const ZERO_CMD = process.env.ZERO_RUNNER ?? "zero";

interface SearchResult {
  token: string;
  position: number;
  slug: string;
  name: string;
  canonicalName: string;
  description: string;
  url: string;
  method: string;
  cost: { amount: string; asset: string };
  availabilityStatus: string;
}

interface SearchOutput {
  capabilities: SearchResult[];
  total: number;
}

interface GetOutput {
  slug: string;
  name: string;
  canonicalName: string;
  description: string;
  url: string;
  method: string;
  bodySchema: unknown;
  responseSchema: unknown;
  availabilityStatus: string;
  displayCostAmount: string;
  displayCostAsset: string;
}

interface FetchOutput {
  runId: string;
  ok: boolean;
  status: number;
  body: unknown;
  payment?: { amount: string; asset: string };
}

async function zero(args: string[]): Promise<string> {
  try {
    const proc = Bun.spawn([ZERO_CMD, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    if (code !== 0) {
      throw new Error(`zero ${args[0]} failed (exit ${code}): ${stderr || stdout}`);
    }
    return stdout;
  } catch (err) {
    if (err instanceof Error && err.message.includes("zero ")) throw err;
    throw new Error(`zero ${args[0]} failed: ${(err as Error).message}. Is the Zero CLI installed? (npm install -g @zeroxyz/cli)`);
  }
}

// ---------------------------------------------------------------------------
// Real Zero.xyz agent runner
// ---------------------------------------------------------------------------

export interface ZeroAgentRunnerOptions {
  /** Maximum USD per zero fetch call. Default: 0.05. */
  maxPerCallUsd?: number;
  /** Inject a mock for testing. Should accept args array and return stdout JSON. */
  runZero?: (args: string[]) => Promise<string>;
}

export class ZeroAgentRunner implements ZeroDiscoveryRunner {
  private readonly maxPerCallUsd: number;
  private readonly runZero: (args: string[]) => Promise<string>;

  constructor(options: ZeroAgentRunnerOptions = {}) {
    this.maxPerCallUsd = options.maxPerCallUsd ?? Number(process.env.ZERO_MAX_PER_CALL_USD ?? "0.10");
    this.runZero = options.runZero ?? zero;
  }

  // -------------------------------------------------------------------
  // discover — search Zero.xyz for backup providers (FREE)
  // -------------------------------------------------------------------

  async discover(failed: ProviderRegistryEntry): Promise<ProviderRegistryEntry> {
    const metric = failed.fieldMapping?.metric ?? failed.id;
    const query = searchQuery(metric);

    // Step 1: search
    const searchRaw = await this.runZero(["search", query, "--json"]);
    const searchOutput: SearchOutput = JSON.parse(searchRaw);

    if (!searchOutput.capabilities?.length) {
      throw new Error(`Zero.xyz returned no results for: ${query}`);
    }

    // Filter to healthy GET endpoints
    const candidates = searchOutput.capabilities.filter(
      (c) => c.availabilityStatus === "healthy" && c.method === "GET",
    );
    if (!candidates.length) {
      throw new Error(`Zero.xyz found ${searchOutput.capabilities.length} results but none are healthy GET endpoints for: ${query}`);
    }

    // Pick the first healthy candidate
    const best = candidates[0];

    // Step 2: get endpoint details (FREE)
    const getRaw = await this.runZero(["get", best.token]);
    const details: GetOutput = JSON.parse(getRaw);

    // Step 3: construct registry entry
    const costUsd = parseFloat(details.displayCostAmount || best.cost.amount || "0.10");
    if (!Number.isFinite(costUsd) || costUsd > this.maxPerCallUsd) {
      throw new Error(`Zero.xyz backup ${details.name} costs $${costUsd}/call, exceeds max $${this.maxPerCallUsd}`);
    }

    return {
      id: `${failed.id}-zero-backup`,
      displayName: `${details.canonicalName || details.name} (Zero.xyz)`,
      endpoint: details.url,
      authMode: "zeroxyz",
      pollIntervalMs: 300_000,
      fieldMapping: {
        metric: metric,
        value: "$value",
        unit: "$unit",
        timestamp: "$timestamp",
      },
      priority: failed.priority + 1,
      enabled: false, // Don't auto-poll — costs money. User can enable manually.
    };
  }

  // -------------------------------------------------------------------
  // fetch — call a Zero.xyz-backed API (COSTS MONEY)
  // -------------------------------------------------------------------

  async fetch(provider: ProviderRegistryEntry): Promise<unknown> {
    const fetchRaw = await this.runZero([
      "fetch",
      provider.endpoint,
      "--json",
      `--max-pay`, String(this.maxPerCallUsd),
    ]);
    const result: FetchOutput = JSON.parse(fetchRaw);

    if (!result.ok) {
      throw new Error(`Zero.xyz fetch returned status ${result.status}`);
    }

    return result.body;
  }
}
