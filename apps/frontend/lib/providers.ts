import type { ProviderRegistryEntry } from "@resilynx/contracts";

const fallbackProviders: ProviderRegistryEntry[] = [
  {
    id: "coingecko",
    displayName: "CoinGecko (Crypto Prices)",
    endpoint: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    authMode: "none",
    pollIntervalMs: 30000,
    fieldMapping: {
      metric: "crypto_price",
      value: "bitcoin.usd",
      unit: "USD",
      timestamp: "bitcoin.usd",
    },
    priority: 1,
    enabled: true,
  },
  {
    id: "exchangerate",
    displayName: "ExchangeRate-API (Forex Rates)",
    endpoint: "https://open.er-api.com/v6/latest/USD",
    authMode: "none",
    pollIntervalMs: 30000,
    fieldMapping: {
      metric: "forex_rate",
      value: "rates.EUR",
      unit: "EUR",
      timestamp: "time_last_update_utc",
    },
    priority: 2,
    enabled: true,
  },
  {
    id: "mock-exchange",
    displayName: "Mock Financial Exchange",
    endpoint: "http://localhost:4001/data",
    authMode: "none",
    pollIntervalMs: 15000,
    fieldMapping: {
      metric: "stock_price",
      value: "price",
      unit: "currency",
      timestamp: "ts",
    },
    priority: 3,
    enabled: true,
  },
];

/**
 * Fetch the live provider registry from the backend.
 * Falls back to the hardcoded list if the backend is unreachable
 * (e.g. during SSR or before the backend starts).
 */
export async function fetchProviders(): Promise<ProviderRegistryEntry[]> {
  try {
    const res = await fetch("http://localhost:8080/providers");
    if (res.ok) return res.json();
  } catch {
    // Backend not reachable — use fallback
  }
  return fallbackProviders;
}

/** Synchronous fallback for components that can't await. */
export const providers: ProviderRegistryEntry[] = fallbackProviders;
