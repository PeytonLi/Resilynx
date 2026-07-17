import type { ProviderRegistryEntry } from "@resilynx/contracts";

const fallbackProviders: ProviderRegistryEntry[] = [
  {
    id: "open-meteo",
    displayName: "Open-Meteo (London Weather)",
    endpoint: "https://api.open-meteo.com/v1/forecast?latitude=51.5074&longitude=-0.1278&current=temperature_2m,relative_humidity_2m,wind_speed_10m",
    authMode: "none",
    pollIntervalMs: 60000,
    fieldMapping: {
      metric: "temperature",
      value: "$current.temperature_2m",
      unit: "$current_units.temperature_2m",
      timestamp: "$current.time",
    },
    priority: 1,
    enabled: true,
  },
  {
    id: "usgs-earthquake",
    displayName: "USGS Earthquake (Global M2.5+)",
    endpoint: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
    authMode: "none",
    pollIntervalMs: 120000,
    fieldMapping: {
      metric: "earthquake_magnitude",
      value: "$features[0].properties.mag",
      unit: "magnitude",
      timestamp: "$features[0].properties.time",
    },
    priority: 2,
    enabled: true,
  },
  {
    id: "uk-carbon",
    displayName: "UK Carbon Intensity (National Grid)",
    endpoint: "https://api.carbonintensity.org.uk/intensity",
    authMode: "none",
    pollIntervalMs: 60000,
    fieldMapping: {
      metric: "carbon_intensity",
      value: "$data[0].intensity.actual",
      unit: "gCO2/kWh",
      timestamp: "$data[0].from",
    },
    priority: 3,
    enabled: true,
  },
  {
    id: "mock-grid",
    displayName: "Mock Grid Sensor (Killable)",
    endpoint: "http://localhost:4001/data",
    authMode: "none",
    pollIntervalMs: 15000,
    fieldMapping: {
      metric: "grid_frequency",
      value: "$reading.frequency",
      unit: "$reading.unit",
      timestamp: "$reading.ts",
    },
    priority: 4,
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
