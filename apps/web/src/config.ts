export const DEFAULT_FIXTURE_RESEARCH_ID = "fixture-riverbend";
export const DEFAULT_API_BASE = "/api/v1";

export const LIVE_NOT_IMPLEMENTED_MESSAGE =
  "Live research is not implemented in this milestone.";

export const NEW_RESEARCH_LIMITATION =
  "New research is unavailable: live discovery and question orchestration are not implemented in this milestone.";

export const QUESTION_DISABLED_EXPLANATION =
  "LLM question orchestration is not implemented in this milestone.";

export interface RuntimeConfig {
  fixtureMode: boolean;
  researchId: string;
  apiBase: string;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Read the explicit runtime mode. Fixture mode is never inferred: the exact
 * string "true" must be configured, and live mode remains a visible
 * not-implemented state rather than a silent fallback to synthetic data.
 */
export function readRuntimeConfig(): RuntimeConfig {
  const configuredResearchId = import.meta.env.VITE_FIXTURE_RESEARCH_ID?.trim();
  const configuredApiBase = import.meta.env.VITE_API_BASE?.trim();
  const apiBase =
    trimTrailingSlashes(configuredApiBase || "") || DEFAULT_API_BASE;

  return {
    fixtureMode: import.meta.env.VITE_FIXTURE_MODE === "true",
    researchId: configuredResearchId || DEFAULT_FIXTURE_RESEARCH_ID,
    apiBase,
  };
}
