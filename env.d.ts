/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** MapTiler API key for the run map; set it in `.env.local` (see `.env.example`) */
  readonly VITE_MAPTILER_KEY?: string
}
