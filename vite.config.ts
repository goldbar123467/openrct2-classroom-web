import { defineConfig } from "vite";

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Origin-Agent-Cluster": "?1",
};

export default defineConfig({
  server: {
    host: "127.0.0.1",
    headers: isolationHeaders,
  },
  preview: {
    host: "127.0.0.1",
    headers: isolationHeaders,
  },
  build: {
    target: "es2022",
    sourcemap: true,
    assetsInlineLimit: 0,
  },
});
