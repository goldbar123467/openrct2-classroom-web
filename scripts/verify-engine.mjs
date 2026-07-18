import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

const manifest = JSON.parse(await readFile(resolve("scripts/engine-manifest.json"), "utf8"));
const engineDirectory = process.argv[2] && !process.argv[2].startsWith("--") ? resolve(process.argv[2]) : null;
const skipAssets = process.argv.includes("--skip-assets");
const contractOnly = process.argv.includes("--contract-only");
let failed = false;

for (const [relativePath, expected] of Object.entries(manifest.files)) {
  if (contractOnly) continue;
  if (skipAssets && relativePath.endsWith("assets.zip")) continue;
  const absolutePath = engineDirectory ? resolve(engineDirectory, basename(relativePath)) : resolve(relativePath);
  const bytes = await readFile(absolutePath);
  const info = await stat(absolutePath);
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== expected.sha256 || info.size !== expected.bytes) {
    console.error(`${relativePath}: expected ${expected.sha256}/${expected.bytes}, got ${actualHash}/${info.size}`);
    failed = true;
  }
}

const engineJsPath = engineDirectory ? resolve(engineDirectory, "openrct2.js") : resolve("public/engine/openrct2.js");
const engineWasmPath = engineDirectory ? resolve(engineDirectory, "openrct2.wasm") : resolve("public/engine/openrct2.wasm");
const engineJs = await readFile(engineJsPath, "utf8");
if (engineJs.includes("var pthreadPoolSize=120;") || engineJs.includes('||2147483648;')) {
  console.error("The low-end Chromebook engine patch is missing.");
  failed = true;
}
if (!engineJs.includes('Module["PTHREAD_POOL_SIZE"]') || !engineJs.includes('||536870912;')) {
  console.error("The classroom worker/memory controls were not found in the engine output.");
  failed = true;
}

function readVarUint(bytes, cursor) {
  let value = 0;
  let shift = 0;
  while (true) {
    if (cursor.offset >= bytes.length || shift > 35) throw new Error("Invalid WebAssembly unsigned LEB128 value.");
    const byte = bytes[cursor.offset++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return value;
    shift += 7;
  }
}

function skipName(bytes, cursor) {
  const length = readVarUint(bytes, cursor);
  cursor.offset += length;
  if (cursor.offset > bytes.length) throw new Error("Invalid WebAssembly name length.");
}

function skipLimits(bytes, cursor) {
  const flags = readVarUint(bytes, cursor);
  readVarUint(bytes, cursor);
  if (flags & 0x01) readVarUint(bytes, cursor);
}

function findImportedMemoryLimits(bytes) {
  if (bytes.length < 8 || bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    throw new Error("Engine output is not a WebAssembly module.");
  }
  const cursor = { offset: 8 };
  while (cursor.offset < bytes.length) {
    const sectionId = bytes[cursor.offset++];
    const sectionSize = readVarUint(bytes, cursor);
    const sectionEnd = cursor.offset + sectionSize;
    if (sectionEnd > bytes.length) throw new Error("Invalid WebAssembly section length.");
    if (sectionId !== 2) {
      cursor.offset = sectionEnd;
      continue;
    }
    const count = readVarUint(bytes, cursor);
    for (let index = 0; index < count; index += 1) {
      skipName(bytes, cursor);
      skipName(bytes, cursor);
      const kind = bytes[cursor.offset++];
      if (kind === 0) readVarUint(bytes, cursor);
      else if (kind === 1) {
        cursor.offset += 1;
        skipLimits(bytes, cursor);
      } else if (kind === 2) {
        const flags = readVarUint(bytes, cursor);
        const minimum = readVarUint(bytes, cursor);
        const maximum = flags & 0x01 ? readVarUint(bytes, cursor) : null;
        return { flags, minimum, maximum };
      } else if (kind === 3) cursor.offset += 2;
      else if (kind === 4) {
        cursor.offset += 1;
        readVarUint(bytes, cursor);
      } else throw new Error(`Unknown WebAssembly import kind ${kind}.`);
    }
    break;
  }
  return null;
}

const wasmLimits = findImportedMemoryLimits(await readFile(engineWasmPath));
const expectedBuild = manifest.sourceBuild;
if (
  !wasmLimits ||
  wasmLimits.minimum !== expectedBuild.initialMemoryPages ||
  wasmLimits.maximum !== expectedBuild.maximumMemoryPages ||
  (wasmLimits.flags & 0x02) === 0
) {
  console.error(
    `WebAssembly memory import mismatch: expected shared ${expectedBuild.initialMemoryPages}/${expectedBuild.maximumMemoryPages} pages, got ${JSON.stringify(wasmLimits)}.`,
  );
  failed = true;
}

if (failed) process.exit(1);
console.log(
  `Verified OpenRCT2 ${manifest.engineVersion} from ${manifest.upstreamCommit} with shared ${expectedBuild.initialMemoryPages}/${expectedBuild.maximumMemoryPages}-page memory${contractOnly ? " (source-build contract)" : " and tracked release hashes"}.`,
);
