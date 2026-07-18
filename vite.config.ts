import { defineConfig } from "vite";

const candidateCommit = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "development";
const buildCommit = /^[0-9a-f]{40}$/i.test(candidateCommit) ? candidateCommit.toLowerCase() : "development";

const productionHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Origin-Agent-Cluster": "?1",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'",
};

export default defineConfig({
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
  },
  plugins: [
    {
      name: "parkworks-build-provenance",
      transformIndexHtml(html) {
        return html.replace("</head>", `    <meta name="parkworks-commit" content="${buildCommit}" />\n  </head>`);
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    headers: productionHeaders,
  },
  preview: {
    host: "127.0.0.1",
    headers: productionHeaders,
  },
  build: {
    target: "es2022",
    sourcemap: false,
    assetsInlineLimit: 0,
  },
});
