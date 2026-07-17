import { readFileSync } from "node:fs";
import path from "node:path";

type Provider = { id: string; displayName: string; endpoint: string; fieldMapping: Record<string, string> };
type Resource = { providerId: string; sourceId: number; nexsetId: number; webhookUrl?: string };

const root = path.resolve(import.meta.dir, "..");
const providers = JSON.parse(readFileSync(path.join(root, "config/providers.json"), "utf8")) as Provider[];
const apiUrl = process.env.NEXLA_API_URL?.replace(/\/$/, "");
const token = process.env.NEXLA_TOKEN;
const restCredentialId = Number(process.env.NEXLA_CUSTOM_REST_CREDENTIAL_ID);

if (!apiUrl || !token) throw new Error("Set NEXLA_API_URL and NEXLA_TOKEN before bootstrapping Nexla resources.");
if (!Number.isInteger(restCredentialId) || restCredentialId <= 0) throw new Error("Set NEXLA_CUSTOM_REST_CREDENTIAL_ID before bootstrapping Custom REST sources.");

async function api<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${pathname}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw new Error(`Nexla API ${init?.method ?? "GET"} ${pathname} returned ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

function items(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  if (value && typeof value === "object") return items((value as Record<string, unknown>).items ?? []);
  return [];
}

function id(value: Record<string, unknown>, label: string): number {
  if (!Number.isInteger(value.id)) throw new Error(`Nexla did not return an id for ${label}`);
  return value.id as number;
}

function transformCode(provider: Provider): string {
  const mapping = provider.fieldMapping;
  const quoted = (value: string | undefined) => JSON.stringify(value ?? provider.id);
  return [
    "def get_path(record, path):",
    "    if not path.startswith('$'): return path",
    "    current = record",
    "    for part in path[1:].replace('[', '.').replace(']', '').split('.'):",
    "        if part: current = current[int(part)] if part.isdigit() else current[part]",
    "    return current",
    "",
    "def transform(record):",
    `    return {'metric': ${quoted(mapping.metric)}, 'value': get_path(record, ${quoted(mapping.value)}), 'unit': get_path(record, ${quoted(mapping.unit)}), 'timestamp': get_path(record, ${quoted(mapping.timestamp)})}`,
  ].join("\n");
}

const [sourceList, nexsetList] = await Promise.all([api<unknown>("/nexla/sources"), api<unknown>("/nexla/nexsets")]);
const sources = items(sourceList);
const nexsets = items(nexsetList);
const resources: Resource[] = [];

for (const provider of providers) {
  const sourceName = `resilynx-${provider.id}`;
  const connector = provider.id === "mock-grid" || provider.id === "mock-exchange" ? "webhook" : "custom_rest";
  let source = sources.find((item) => item.name === sourceName);
  if (!source) {
    source = await api<Record<string, unknown>>("/nexla/sources", {
      method: "POST",
      body: JSON.stringify({
        name: sourceName,
        connector,
        ...(connector === "custom_rest" ? { credential_id: restCredentialId, endpoint: provider.endpoint } : {}),
      }),
    });
  }

  const sourceId = id(source, sourceName);
  let sourceDetail = await api<Record<string, unknown>>(`/nexla/sources/${sourceId}`);
  for (let attempt = 0; !Number.isInteger(sourceDetail.source_nexset_id) && attempt < 60; attempt++) {
    await Bun.sleep(5_000);
    sourceDetail = await api<Record<string, unknown>>(`/nexla/sources/${sourceId}`);
  }
  if (!Number.isInteger(sourceDetail.source_nexset_id)) throw new Error(`Nexla source ${sourceName} did not produce a source Nexset`);

  const nexsetName = `${sourceName}-normalized`;
  let nexset = nexsets.find((item) => item.name === nexsetName);
  if (!nexset) {
    nexset = await api<Record<string, unknown>>(`/nexla/nexsets/${sourceDetail.source_nexset_id}/transform`, {
      method: "POST",
      body: JSON.stringify({ name: nexsetName, language: "python", code: transformCode(provider) }),
    });
  }

  const resource: Resource = { providerId: provider.id, sourceId, nexsetId: id(nexset, nexsetName) };
  if (connector === "webhook") {
    if (typeof sourceDetail.webhook_url !== "string") throw new Error(`Nexla webhook source ${sourceName} did not return webhook_url`);
    resource.webhookUrl = sourceDetail.webhook_url;
  }
  resources.push(resource);
}

await Bun.write(path.join(root, "config/nexla-resources.json"), JSON.stringify({ resources }, null, 2) + "\n");
console.log(`Provisioned ${resources.length} Nexla resources through ${apiUrl}.`);
