/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google OAuth 2.0 Client ID — public, safe to expose in the built bundle.
   *  Not the same as the GOOGLE_CLIENT_ID Worker secret (server-side only). */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
