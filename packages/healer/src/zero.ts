import type { ProviderRegistryEntry } from "@resilynx/contracts";

export interface ZeroCallResult {
  rawPayload: unknown;
  perCallCostUsd: number;
}

export interface ZeroRunner {
  fetch(provider: ProviderRegistryEntry): Promise<unknown>;
}

export interface ZeroDiscoveryRunner extends ZeroRunner {
  discover(failed: ProviderRegistryEntry): Promise<ProviderRegistryEntry>;
}

export interface ZeroAgentRunnerOptions {
  maxPerCallUsd?: number;
  maxMonthlyUsd?: number;
  execute?: (prompt: string) => Promise<string>;
}

/**
 * Calls Zero through the user's supported Codex setup. Codex is read-only;
 * it returns data and never receives permission to edit the registry.
 */
export class ZeroAgentRunner implements ZeroDiscoveryRunner {
  private readonly maxPerCallUsd: number;
  private readonly maxMonthlyUsd: number;
  private spentUsd = 0;
  private readonly execute: (prompt: string) => Promise<string>;

  constructor(options: ZeroAgentRunnerOptions = {}) {
    this.maxPerCallUsd = options.maxPerCallUsd ?? Number(process.env.ZERO_MAX_PER_CALL_USD ?? "0.05");
    this.maxMonthlyUsd = options.maxMonthlyUsd ?? Number(process.env.ZERO_MAX_MONTHLY_USD ?? "5");
    this.execute = options.execute ?? this.runCodex;
  }

  async fetch(provider: ProviderRegistryEntry): Promise<unknown> {
    const output = await this.execute([
      "Use the installed Zero capability to fetch one current live-data response.",
      `Service hint: ${provider.endpoint}`,
      `Metric: ${provider.fieldMapping.metric ?? provider.id}`,
      "Return only JSON: {\"rawPayload\": <provider response>, \"perCallCostUsd\": <number>}.",
      "Refuse the request if Zero cannot show the service price before calling it.",
    ].join("\n"));
    const result = parseResult(output);
    if (!Number.isFinite(result.perCallCostUsd) || result.perCallCostUsd < 0) {
      throw new Error("Zero call has no valid quoted price");
    }
    if (result.perCallCostUsd > this.maxPerCallUsd || this.spentUsd + result.perCallCostUsd > this.maxMonthlyUsd) {
      throw new Error("Zero call exceeds configured budget");
    }
    this.spentUsd += result.perCallCostUsd;
    return result.rawPayload;
  }

  async discover(failed: ProviderRegistryEntry): Promise<ProviderRegistryEntry> {
    const output = await this.execute([
      "Use the installed Zero capability to discover one priced live-data service that replaces this failed source.",
      `Metric: ${failed.fieldMapping.metric ?? failed.id}`,
      "Return only JSON: {\"id\": string, \"displayName\": string, \"serviceHint\": string, \"fieldMapping\": object, \"perCallCostUsd\": number}.",
      "The field mapping must use $ prefixes for payload paths. Refuse services without a visible price.",
    ].join("\n"));
    const result = parseDiscovery(output);
    if (!Number.isFinite(result.perCallCostUsd) || result.perCallCostUsd < 0 || result.perCallCostUsd > this.maxPerCallUsd) {
      throw new Error("Zero discovery exceeds configured budget");
    }
    return {
      id: result.id,
      displayName: result.displayName,
      endpoint: `zero://${result.serviceHint}`,
      authMode: "zeroxyz",
      pollIntervalMs: 300_000,
      fieldMapping: result.fieldMapping,
      priority: failed.priority + 1,
      enabled: true,
    };
  }

  private async runCodex(prompt: string): Promise<string> {
    const child = Bun.spawn([
      "codex", "exec", "--json", "--ephemeral", "--sandbox", "read-only", "--cd", process.cwd(), prompt,
    ], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`Codex/Zero worker failed: ${stderr || stdout}`);
    return stdout;
  }
}

interface ZeroDiscoveryResult {
  id: string;
  displayName: string;
  serviceHint: string;
  fieldMapping: Record<string, string>;
  perCallCostUsd: number;
}

function parseResult(output: string): ZeroCallResult {
  const candidates = [output, ...output.split(/\r?\n/).reverse()];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const result = findResult(parsed);
      if (result) return result;
    } catch { /* try the next JSONL event */ }
  }
  throw new Error("Codex/Zero worker did not return the required JSON result");
}

function findResult(value: unknown): ZeroCallResult | undefined {
  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      try { return findResult(JSON.parse(value)); } catch { return undefined; }
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if ("rawPayload" in record && typeof record.perCallCostUsd === "number") {
    return { rawPayload: record.rawPayload, perCallCostUsd: record.perCallCostUsd };
  }
  for (const nested of Object.values(record)) {
    const result = findResult(nested);
    if (result) return result;
  }
  return undefined;
}

function parseDiscovery(output: string): ZeroDiscoveryResult {
  const candidates = [output, ...output.split(/\r?\n/).reverse()];
  for (const candidate of candidates) {
    try {
      const found = findDiscovery(JSON.parse(candidate));
      if (found) return found;
    } catch { /* try the next JSONL event */ }
  }
  throw new Error("Codex/Zero worker did not return a provider discovery result");
}

function findDiscovery(value: unknown): ZeroDiscoveryResult | undefined {
  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      try { return findDiscovery(JSON.parse(value)); } catch { return undefined; }
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id === "string" && typeof record.displayName === "string" && typeof record.serviceHint === "string" &&
    typeof record.perCallCostUsd === "number" && record.fieldMapping && typeof record.fieldMapping === "object") {
    return { id: record.id, displayName: record.displayName, serviceHint: record.serviceHint,
      fieldMapping: record.fieldMapping as Record<string, string>, perCallCostUsd: record.perCallCostUsd };
  }
  for (const nested of Object.values(record)) {
    const result = findDiscovery(nested);
    if (result) return result;
  }
  return undefined;
}
