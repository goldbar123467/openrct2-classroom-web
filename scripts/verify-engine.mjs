import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const manifest = JSON.parse(await readFile(resolve("scripts/engine-manifest.json"), "utf8"));
let failed = false;

for (const [relativePath, expected] of Object.entries(manifest.files)) {
  const absolutePath = resolve(relativePath);
  const bytes = await readFile(absolutePath);
  const info = await stat(absolutePath);
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== expected.sha256 || info.size !== expected.bytes) {
    console.error(`${relativePath}: expected ${expected.sha256}/${expected.bytes}, got ${actualHash}/${info.size}`);
    failed = true;
  }
}

const engineJs = await readFile(resolve("public/engine/openrct2.js"), "utf8");
if (engineJs.includes("var pthreadPoolSize=120;") || engineJs.includes('||2147483648;')) {
  console.error("The low-end Chromebook engine patch is missing.");
  failed = true;
}
if (!engineJs.includes('Module["PTHREAD_POOL_SIZE"]') || !engineJs.includes('||536870912;')) {
  console.error("The classroom worker/memory controls were not found in the engine output.");
  failed = true;
}

if (failed) process.exit(1);
console.log(`Verified OpenRCT2 ${manifest.engineVersion} from ${manifest.upstreamCommit}.`);
