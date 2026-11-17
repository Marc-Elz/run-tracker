/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** MapTiler API key for the run map; set it in `.env.local` (see `.env.example`) */
  readonly VITE_MAPTILER_KEY?: string
  /** 'true' only in the web demo build for GitHub Pages (#162): sample data and a banner */
  readonly VITE_DEMO?: string
}
