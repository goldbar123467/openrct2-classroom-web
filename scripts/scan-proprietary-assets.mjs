import { readdir, readFile, stat } from "node:fs/promises";
import { resolve, relative } from "node:path";
import JSZip from "jszip";

const forbiddenArchivePaths = [
  /(^|\/)data\/(ch|g1)\.dat$/i,
  /(^|\/)objdata\//i,
  /(^|\/)scenarios\/.*\.(sc4|sc6)$/i,
  /(^|\/)tracks\/.*\.(td4|td6)$/i,
];
const forbiddenFileNames = [/(^|[\\/])(ch|g1)\.dat$/i, /\.(sc4|sc6)$/i, /\.(td4|td6)$/i];
const root = resolve(".");
const scanRoots = [resolve("public"), resolve("src"), resolve("docs")];
const violations = [];

async function walk(path) {
  let info;
  try {
    info = await stat(path);
  } catch {
    return;
  }
  if (info.isDirectory()) {
    for (const name of await readdir(path)) await walk(resolve(path, name));
    return;
  }
  const display = relative(root, path);
  if (forbiddenFileNames.some((pattern) => pattern.test(display))) violations.push(display);
}

for (const path of scanRoots) await walk(path);

const assetZip = await JSZip.loadAsync(await readFile(resolve("public/engine/assets.zip")));
for (const name of Object.keys(assetZip.files)) {
  const normalizedName = name.replaceAll("\\", "/");
  if (forbiddenArchivePaths.some((pattern) => pattern.test(normalizedName))) {
    violations.push(`public/engine/assets.zip:${normalizedName}`);
  }
}

if (violations.length) {
  console.error("Potential proprietary RCT/RCT2 assets found:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}
console.log("No proprietary RCT/RCT2 data signatures found in distributable project assets.");
