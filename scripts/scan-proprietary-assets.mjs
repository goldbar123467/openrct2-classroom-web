import { execFile } from "node:child_process";
import { open, readFile, readdir, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";

const execFileAsync = promisify(execFile);
const root = resolve(".");
const violations = new Set();
const forbiddenFileNames = [
  /(^|[\\/])(ch|g1)\.dat$/i,
  /\.(sc4|sc6|sv4|sv6|park)$/i,
  /\.(td4|td6)$/i,
  /(^|[\\/])licensed(?:[\\/]|$)/i,
  /(^|[\\/])(?:snapshot-runs?|parkworks-library)(?:[\\/._-]|$)/i,
  /(?:park-library|school-park).+\.(zip|7z|tar|gz)$/i,
  /(^|[\\/])receipts?\.jsonl$/i,
];
const forbiddenArchivePaths = [
  /(^|\/)data\/(ch|g1)\.dat$/i,
  /(^|\/)objdata\//i,
  /\.(sc4|sc6|sv4|sv6|park)$/i,
  /(^|\/)scenarios\//i,
  /(^|\/)tracks\/.*\.(td4|td6)$/i,
];

async function listTrackedFiles() {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], { cwd: root, encoding: "buffer", maxBuffer: 20_000_000 });
  return stdout.toString("utf8").split("\0").filter(Boolean).map((path) => resolve(root, path));
}

async function walk(path) {
  let info;
  try {
    info = await stat(path);
  } catch {
    return [];
  }
  if (!info.isDirectory()) return [path];
  const files = [];
  for (const name of await readdir(path)) files.push(...await walk(resolve(path, name)));
  return files;
}

async function firstBytes(path, length) {
  const handle = await open(path, "r");
  try {
    const bytes = Buffer.alloc(length);
    const { bytesRead } = await handle.read(bytes, 0, length, 0);
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function inspectArchive(path, display) {
  let archive;
  try {
    archive = await JSZip.loadAsync(await readFile(path));
  } catch (error) {
    violations.add(`${display}: unreadable ZIP (${error instanceof Error ? error.message : String(error)})`);
    return;
  }
  for (const name of Object.keys(archive.files)) {
    const normalized = name.replaceAll("\\", "/");
    if (forbiddenArchivePaths.some((pattern) => pattern.test(normalized))) violations.add(`${display}:${normalized}`);
  }
}

const files = new Set(await listTrackedFiles());
for (const path of await walk(resolve(root, "dist"))) files.add(path);
for (const path of files) {
  const display = relative(root, path).replaceAll("\\", "/");
  if (forbiddenFileNames.some((pattern) => pattern.test(display))) violations.add(display);
  const prefix = await firstBytes(path, 8);
  if (prefix.subarray(0, 4).toString("ascii") === "PARK") violations.add(`${display}:PARK signature`);
  if (extname(path).toLowerCase() === ".zip" || prefix.subarray(0, 2).toString("ascii") === "PK") {
    await inspectArchive(path, display);
  }
}

if (violations.size) {
  console.error("Potential proprietary RCT/RCT2 assets found in Git-tracked files or dist:");
  for (const violation of [...violations].sort()) console.error(`- ${violation}`);
  process.exit(1);
}
console.log("No proprietary scenarios, saves, park libraries, or licensed RCT/RCT2 data found in Git-tracked files or dist.");
