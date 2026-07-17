/**
 * Provider registry — loads config/providers.json, validates it against the
 * ProviderRegistryEntry shape, and hot-reloads on file change. An invalid
 * file (bad JSON or bad shape) is rejected and the last good config is kept.
 */
import { EventEmitter } from "node:events";
import { watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { REGISTRY_PATH, type AuthMode, type ProviderRegistryEntry } from "@resilynx/contracts";

// apps/backend/src -> apps/backend -> apps -> repo root
const DEFAULT_REGISTRY_PATH = path.resolve(import.meta.dir, "../../../", REGISTRY_PATH);

const AUTH_MODES: readonly AuthMode[] = ["none", "apiKey", "bearer", "zeroxyz"];

function isValidEntry(entry: unknown): entry is ProviderRegistryEntry {
  if (typeof entry !== "object" || entry === null) return false;
  const o = entry as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.displayName === "string" &&
    typeof o.endpoint === "string" &&
    typeof o.authMode === "string" &&
    AUTH_MODES.includes(o.authMode as AuthMode) &&
    typeof o.pollIntervalMs === "number" &&
    typeof o.fieldMapping === "object" &&
    o.fieldMapping !== null &&
    !Array.isArray(o.fieldMapping) &&
    typeof o.priority === "number" &&
    typeof o.enabled === "boolean"
  );
}

interface RegistryChangeEvent {
  providers: ProviderRegistryEntry[];
  timestamp: string;
}

function parseRegistry(text: string): ProviderRegistryEntry[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(data) || !data.every(isValidEntry)) return null;
  return data;
}

/** Watches and validates config/providers.json. Emits "change" with the new list on a good reload. */
export class ProviderRegistry extends EventEmitter {
  private providers: ProviderRegistryEntry[] = [];
  private watcher: FSWatcher | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly filePath: string = DEFAULT_REGISTRY_PATH) {
    super();
  }

  /** Reads the file once, validates it, and populates the in-memory list. */
  async load(): Promise<void> {
    await this.reload();
  }

  getProviders(): ProviderRegistryEntry[] {
    return this.providers;
  }

  /** Starts watching the file for changes; hot-reloads (or rejects) on each write. */
  watch(): void {
    if (this.watcher) return;
    this.watcher = watch(this.filePath, () => {
      // fs.watch can fire more than once per write; debounce to one reload.
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => void this.reload(), 25);
    });
  }

  close(): void {
    clearTimeout(this.debounceTimer);
    this.watcher?.close();
    this.watcher = undefined;
  }

  private async reload(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (err) {
      console.warn(`[registry] failed to read ${this.filePath}: ${(err as Error).message}`);
      return;
    }
    const parsed = parseRegistry(text);
    if (!parsed) {
      console.warn(`[registry] invalid config at ${this.filePath}; keeping last good config`);
      return;
    }
    this.providers = parsed;
    const event: RegistryChangeEvent = { providers: parsed, timestamp: new Date().toISOString() };
    this.emit("change", event);
  }
}
