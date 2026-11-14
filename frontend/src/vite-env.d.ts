/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIXTURE_MODE?: string
  readonly VITE_FIXTURE_RESEARCH_ID?: string
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
