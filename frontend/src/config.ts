export type AppMode = "fixture" | "live";

export interface RuntimeConfig {
  mode: AppMode;
  apiBase: string;
  fixtureResearchId: string;
}

export const DEFAULT_API_BASE = "/api/v1";
export const DEFAULT_FIXTURE_RESEARCH_ID = "fixture-riverbend";

interface ViteEnvLike {
  VITE_FIXTURE_MODE?: unknown;
  VITE_API_BASE?: unknown;
  VITE_FIXTURE_RESEARCH_ID?: unknown;
}

function readViteEnv(): ViteEnvLike {
  const meta = import.meta as ImportMeta & { env?: ViteEnvLike };
  return meta.env ?? {};
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Fixture mode is the safe default and the only fully wired mode in this
 * milestone. Live mode is opted into explicitly with VITE_FIXTURE_MODE=false.
 */
export function readRuntimeConfig(): RuntimeConfig {
  const env = readViteEnv();
  const fixtureFlag = readString(env.VITE_FIXTURE_MODE);
  const mode: AppMode =
    fixtureFlag !== null && fixtureFlag.toLowerCase() === "false"
      ? "live"
      : "fixture";

  return {
    mode,
    apiBase: readString(env.VITE_API_BASE) ?? DEFAULT_API_BASE,
    fixtureResearchId:
      readString(env.VITE_FIXTURE_RESEARCH_ID) ??
      DEFAULT_FIXTURE_RESEARCH_ID,
  };
}
