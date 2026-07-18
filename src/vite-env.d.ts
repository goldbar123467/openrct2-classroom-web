/// <reference types="vite/client" />

declare const __BUILD_COMMIT__: string;

interface ImportMetaEnv {
  readonly VITE_SCHOOL_ASSET_URL?: string;
  readonly VITE_SCHOOL_ASSET_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
