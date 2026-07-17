import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type Provider = {
  id: string;
  displayName: string;
  endpoint: string;
  pollIntervalMs: number;
  fieldMapping: Record<string, string>;
};

type Resource = { providerId: string; sourceId: number; nexsetId: number; webhookUrl?: string };

const root = import.meta.dir + "/..";
const providers = JSON.parse(readFileSync(path.join(root, "config/providers.json"), "utf8")) as Provider[];

if (!process.env.NEXLA_API_URL || !process.env.NEXLA_TOKEN) {
  throw new Error("Set NEXLA_API_URL and NEXLA_TOKEN before bootstrapping Nexla resources.");
}

const windowsCliPath = path.join(process.env.APPDATA ?? "", "npm", "node_modules", "@nexla", "nexla-cli", "bin", "nexla-bin.exe");
const cliPath = process.env.NEXLA_CLI_PATH ?? (process.platform === "win32" && existsSync(windowsCliPath) ? windowsCliPath : "nexla-cli");
const restCredentialId = Number(process.env.NEXLA_CUSTOM_REST_CREDENTIAL_ID);
if (!Number.isInteger(restCredentialId) || restCredentialId <= 0) {
  throw new Error("Set NEXLA_CUSTOM_REST_CREDENTIAL_ID to a Custom REST credential id before bootstrapping.");
}

async function cli(args: string[]): Promise<unknown> {
  const process = Bun.spawn([cliPath, "--output", "json", ...args], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
  if (exitCode !== 0) throw new Error(stderr.trim() || `nexla-cli exited ${exitCode}`);
  return JSON.parse(stdout) as unknown;
}

function items(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  if (value && typeof value === "object") return items((value as Record<string, unknown>).items ?? []);
  return [];
}

function id(value: unknown, label: string): number {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>).id : undefined;
  if (!Number.isInteger(candidate)) throw new Error(`Nexla did not return an id for ${label}`);
  return candidate as number;
}

function sourceNexsetId(value: unknown, label: string): number {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>).source_nexset_id : undefined;
  if (!Number.isInteger(candidate)) throw new Error(`Nexla source ${label} did not expose source_nexset_id`);
  return candidate as number;
}

function transformCode(provider: Provider): string {
  const mapping = provider.fieldMapping;
  const literal = (value: string | undefined) => JSON.stringify(value ?? provider.id);
  return [
    "def get_path(record, path):",
    "    if not path.startswith('$'): return path",
    "    current = record",
    "    for part in path[1:].replace('[', '.').replace(']', '').split('.'):",
    "        if not part: continue",
    "        current = current[int(part)] if part.isdigit() else current[part]",
    "    return current",
    "",
    "def transform(record):",
    `    return {'metric': ${literal(mapping.metric)}, 'value': get_path(record, ${literal(mapping.value)}), 'unit': get_path(record, ${literal(mapping.unit)}), 'timestamp': get_path(record, ${literal(mapping.timestamp)})}`,
    "",
  ].join("\\n");
}

const existingSources = items(await cli(["sources", "list"]));
const existingNexsets = items(await cli(["nexsets", "list"]));
const resources: Resource[] = [];

for (const provider of providers) {
  const name = `resilynx-${provider.id}`;
  const connector = provider.id === "mock-exchange" ? "webhook" : "custom_rest";
  let source = existingSources.find((item) => item.name === name);
  if (!source) {
    const createArgs = ["sources", "create", "--name", name, "--connector", connector];
    if (connector === "custom_rest") createArgs.push("--credential-id", String(restCredentialId));
    if (connector === "custom_rest") createArgs.push("--endpoint", provider.endpoint);
    await cli([...createArgs, "--dry-run"]);
    source = await cli(createArgs) as Record<string, unknown>;
  }

  const sourceId = id(source, name);
  const readySource = await cli(["sources", "get", String(sourceId), "--wait-until", "source_nexset_id"]);
  const parentNexsetId = sourceNexsetId(readySource, name);
  const nexsetName = `${name}-normalized`;
  let nexset = existingNexsets.find((item) => item.name === nexsetName);
  if (!nexset) {
    nexset = await cli(["nexsets", "transform", String(parentNexsetId), "--name", nexsetName, "--language", "python", "--code", transformCode(provider)]);
  }

  const resource: Resource = { providerId: provider.id, sourceId, nexsetId: id(nexset, nexsetName) };
  const webhookUrl = readySource && typeof readySource === "object" ? (readySource as Record<string, unknown>).webhook_url : undefined;
  if (provider.id === "mock-exchange") {
    if (typeof webhookUrl !== "string") throw new Error("Nexla webhook source did not return webhook_url");
    resource.webhookUrl = webhookUrl;
  }
  resources.push(resource);
}

await Bun.write(path.join(root, "config/nexla-resources.json"), JSON.stringify({ resources }, null, 2) + "\n");
console.log(`Provisioned ${resources.length} Nexla resources.`);
