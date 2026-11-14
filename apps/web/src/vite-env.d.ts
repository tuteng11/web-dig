/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIXTURE_MODE?: string;
  readonly VITE_FIXTURE_RESEARCH_ID?: string;
  readonly VITE_API_BASE?: string;
  readonly VITE_GATEWAY_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
