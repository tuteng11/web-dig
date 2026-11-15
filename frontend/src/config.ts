export type AppMode = "fixture" | "live";
export type DemoTransport = "gateway" | "bundled";

export interface RuntimeConfig {
  mode: AppMode;
  apiBase: string;
  fixtureResearchId: string;
  demoTransport: DemoTransport;
}

export const DEFAULT_API_BASE = "/api/v1";
export const DEFAULT_FIXTURE_RESEARCH_ID = "fixture-riverbend";

/**
 * Environment-shaped input for the runtime config resolver. Values are unknown
 * because Vite injects strings at build time and tests may pass anything.
 */
export interface RuntimeEnv {
  VITE_FIXTURE_MODE?: unknown;
  VITE_API_BASE?: unknown;
  VITE_FIXTURE_RESEARCH_ID?: unknown;
  VITE_DEMO_TRANSPORT?: unknown;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parse an explicit demo transport. Only "gateway" and "bundled" are accepted
 * after trimming and lowercasing; anything else is ignored.
 */
export function parseDemoTransport(value: unknown): DemoTransport | null {
  const text = readString(value);
  if (text === null) {
    return null;
  }
  const normalized = text.toLowerCase();
  return normalized === "gateway" || normalized === "bundled"
    ? normalized
    : null;
}

/**
 * Resolve runtime configuration from environment-like values.
 *
 * Demo transport precedence:
 * 1. VITE_DEMO_TRANSPORT when it is exactly "gateway" or "bundled"
 *    (trimmed, case-insensitive).
 * 2. VITE_FIXTURE_MODE=true (case-insensitive) for the fully offline bundle.
 * 3. Otherwise the read-only gateway demo.
 *
 * Mode is "live" only when VITE_FIXTURE_MODE is exactly "false"; every other
 * value keeps the synthetic-fixture default that disables live discovery.
 */
export function resolveRuntimeConfig(env: RuntimeEnv): RuntimeConfig {
  const fixtureFlag = readString(env.VITE_FIXTURE_MODE);
  const fixtureMode = fixtureFlag?.toLowerCase() ?? null;
  const mode: AppMode = fixtureMode === "false" ? "live" : "fixture";
  const explicitTransport = parseDemoTransport(env.VITE_DEMO_TRANSPORT);
  const demoTransport: DemoTransport =
    explicitTransport ??
    (fixtureMode === "true" ? "bundled" : "gateway");

  return {
    mode,
    apiBase: readString(env.VITE_API_BASE) ?? DEFAULT_API_BASE,
    fixtureResearchId:
      readString(env.VITE_FIXTURE_RESEARCH_ID) ??
      DEFAULT_FIXTURE_RESEARCH_ID,
    demoTransport,
  };
}

export function readRuntimeConfig(): RuntimeConfig {
  // Access each VITE_* member directly. Vite only performs its static env
  // replacement for direct `import.meta.env.NAME` reads; reading the whole
  // `import.meta.env` object leaves a runtime-only expression in the bundle and
  // silently drops configured values in a production build.
  return resolveRuntimeConfig({
    VITE_FIXTURE_MODE: import.meta.env.VITE_FIXTURE_MODE,
    VITE_API_BASE: import.meta.env.VITE_API_BASE,
    VITE_FIXTURE_RESEARCH_ID: import.meta.env.VITE_FIXTURE_RESEARCH_ID,
    VITE_DEMO_TRANSPORT: import.meta.env.VITE_DEMO_TRANSPORT,
  });
}
