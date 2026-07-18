import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const [manifestPath, rawUrl] = process.argv.slice(2);
if (!manifestPath || !rawUrl) {
  throw new Error("Usage: node scripts/verify-static-deployment.mjs <dist-hashes.json> <https-url>");
}

const baseUrl = new URL(rawUrl);
if (baseUrl.protocol !== "https:") throw new Error("Deployment verification requires HTTPS.");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.schema !== "parkworks-dist-hashes-v1" || manifest.fileCount !== manifest.files?.length) {
  throw new Error("Distribution manifest schema/count is invalid.");
}

const results = [];
for (const expected of manifest.files) {
  const url = new URL(expected.path.split("/").map(encodeURIComponent).join("/"), `${baseUrl.href.replace(/\/$/, "")}/`);
  url.searchParams.set("parkworks_probe", expected.sha256.slice(0, 16));
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "cache-control": "no-cache", pragma: "no-cache" },
  });
  if (!response.ok || !response.body) throw new Error(`${expected.path} returned HTTP ${response.status}.`);
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of response.body) {
    hash.update(chunk);
    bytes += chunk.byteLength;
  }
  const sha256 = hash.digest("hex");
  if (bytes !== expected.bytes || sha256 !== expected.sha256) {
    throw new Error(`${expected.path} mismatch: expected ${expected.sha256}/${expected.bytes}, got ${sha256}/${bytes}.`);
  }

  const headers = Object.fromEntries(
    [
      "cache-control",
      "content-type",
      "cross-origin-opener-policy",
      "cross-origin-embedder-policy",
      "cross-origin-resource-policy",
      "origin-agent-cluster",
      "x-content-type-options",
    ].map((name) => [name, response.headers.get(name)]),
  );
  results.push({ path: expected.path, bytes, sha256, headers });
}

const index = results.find((result) => result.path === "index.html");
for (const [name, value] of Object.entries({
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "require-corp",
  "cross-origin-resource-policy": "same-origin",
  "origin-agent-cluster": "?1",
  "x-content-type-options": "nosniff",
})) {
  if (index?.headers[name] !== value) throw new Error(`index.html header ${name} is ${index?.headers[name] ?? "missing"}.`);
}
const wasm = results.find((result) => result.path.endsWith("openrct2.wasm"));
if (wasm?.headers["content-type"] !== "application/wasm") throw new Error("OpenRCT2 WASM MIME type is not application/wasm.");
if (!wasm?.headers["cache-control"]?.includes("immutable")) throw new Error("OpenRCT2 WASM is not immutably cached.");

process.stdout.write(
  `${JSON.stringify(
    {
      schema: "parkworks-live-probe-v1",
      baseUrl: baseUrl.href,
      checkedAt: new Date().toISOString(),
      fileCount: results.length,
      files: results,
    },
    null,
    2,
  )}\n`,
);
