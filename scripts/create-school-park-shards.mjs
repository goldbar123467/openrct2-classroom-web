import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_COUNT = 57;
const EXPECTED_BYTES = 28_194_642;
const GENERATOR_VERSION = "parkworks-native-snapshot-v1";
const SHARD_IDS = ["A", "B", "C"];
const FORCED_SHARDS = new Map([
  ["Electric Fields", "A"],
  ["Six Flags Magic Mountain", "B"],
]);
const SCENARIO_METADATA_ALIASES = new Map([
  ["Mythological - Cradle of Civilization", "Mythological - Cradle of Civilisation"],
  ["N America - Extreme Hawaiian Island", "N. America - Extreme Hawaiian Island"],
]);

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Expected --name value arguments; received ${key ?? "<end>"}.`);
    }
    values.set(key.slice(2), value);
  }
  return values;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function walkScenarios(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const fullPath = resolve(root, entry.name);
    if (entry.isDirectory()) paths.push(...await walkScenarios(fullPath));
    else if (entry.isFile() && extname(entry.name).toLowerCase() === ".sc6") paths.push(fullPath);
  }
  return paths;
}

function parseScenarioMetadata(source) {
  const result = new Map();
  const pattern = /\{\s*[^,]+,\s*"([^"]+)"\s*,\s*Scenario::Category::([A-Za-z0-9_]+)/g;
  let order = 0;
  for (const match of source.matchAll(pattern)) {
    const [, title, category] = match;
    if (!result.has(title)) result.set(title, { category, order: order++ });
  }
  return result;
}

async function makeInventory(scenarioRoot, metadata) {
  const paths = (await walkScenarios(scenarioRoot)).sort((left, right) => left.localeCompare(right, "en"));
  const byHash = new Map();
  for (const sourcePath of paths) {
    const bytes = await readFile(sourcePath);
    const sourceHash = sha256(bytes);
    const sourceBasename = basename(sourcePath, extname(sourcePath));
    const existing = byHash.get(sourceHash);
    const metadataTitle = SCENARIO_METADATA_ALIASES.get(sourceBasename) ?? sourceBasename;
    const entry = {
      id: slugify(sourceBasename),
      title: sourceBasename,
      sourceBasename,
      sourcePath,
      sourceSha256: sourceHash,
      sourceBytes: bytes.length,
      snapshotName: `${sourceBasename}.park`,
      ...(metadata.get(metadataTitle) ?? { category: "unknown", order: Number.MAX_SAFE_INTEGER }),
    };
    if (!existing || dirname(existing.sourcePath).toLowerCase().endsWith("\\install\\scenarios")) {
      byHash.set(sourceHash, entry);
    }
  }

  const inventory = [...byHash.values()];
  const ids = new Set(inventory.map((entry) => entry.id));
  if (ids.size !== inventory.length || inventory.some((entry) => !entry.id)) {
    throw new Error("Scenario IDs are empty or duplicate after slug generation.");
  }
  const totalBytes = inventory.reduce((sum, entry) => sum + entry.sourceBytes, 0);
  if (inventory.length !== EXPECTED_COUNT || totalBytes !== EXPECTED_BYTES) {
    throw new Error(`Licensed inventory mismatch: expected ${EXPECTED_COUNT}/${EXPECTED_BYTES}, received ${inventory.length}/${totalBytes}.`);
  }
  for (const [title] of FORCED_SHARDS) {
    if (!inventory.some((entry) => entry.title === title)) throw new Error(`Mandatory scenario is missing: ${title}.`);
  }
  if (inventory.some((entry) => entry.category === "unknown")) {
    const missing = inventory.filter((entry) => entry.category === "unknown").map((entry) => entry.title);
    throw new Error(`Pinned engine metadata is missing scenarios: ${missing.join(", ")}.`);
  }
  return inventory;
}

function assignShards(inventory) {
  const shards = new Map(SHARD_IDS.map((id) => [id, { id, sourceBytes: 0, parks: [] }]));
  const sorted = [...inventory].sort((left, right) => right.sourceBytes - left.sourceBytes || left.title.localeCompare(right.title, "en"));
  for (const park of sorted) {
    const forced = FORCED_SHARDS.get(park.title);
    const shard = forced
      ? shards.get(forced)
      : [...shards.values()].sort((left, right) => left.sourceBytes - right.sourceBytes || left.id.localeCompare(right.id))[0];
    shard.parks.push(park);
    shard.sourceBytes += park.sourceBytes;
  }
  return [...shards.values()];
}

async function writeImmutable(path, bytes) {
  await writeFile(path, bytes, { flag: "wx" });
  await chmod(path, 0o444);
}

const args = parseArgs(process.argv.slice(2));
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const scenarioRoot = resolve(args.get("scenario-root") ?? "");
const engineSource = resolve(args.get("engine-source") ?? "");
const engineManifestPath = resolve(args.get("engine-manifest") ?? resolve(projectRoot, "scripts/engine-manifest.json"));
const privateRoot = resolve(args.get("private-root") ?? "");
const libraryVersion = args.get("library-version") ?? new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);

for (const [label, path] of [["scenario root", scenarioRoot], ["engine source", engineSource], ["private root", privateRoot]]) {
  if (!isAbsolute(path)) throw new Error(`${label} must be absolute.`);
}
const privateRelative = relative(projectRoot, privateRoot);
if (!privateRelative.startsWith("..") || isAbsolute(privateRelative)) {
  throw new Error("Private run root must remain outside the Git working tree.");
}
if (!(await stat(scenarioRoot)).isDirectory()) throw new Error("Scenario root is not a directory.");

const engineManifest = JSON.parse(await readFile(engineManifestPath, "utf8"));
const metadata = parseScenarioMetadata(await readFile(engineSource, "utf8"));
const inventory = await makeInventory(scenarioRoot, metadata);
const inventoryLines = [...inventory]
  .sort((left, right) => left.sourceBasename.localeCompare(right.sourceBasename, "en"))
  .map((entry) => `${entry.sourceBasename}.SC6\t${entry.sourceBytes}\t${entry.sourceSha256}\n`)
  .join("");
const inventorySha256 = sha256(Buffer.from(inventoryLines, "utf8"));
const runId = args.get("run-id") ?? `${libraryVersion}-${inventorySha256.slice(0, 12)}`;
const runRoot = resolve(privateRoot, runId);
await mkdir(runRoot, { recursive: false });

const releaseIdentity = {
  runId,
  libraryVersion,
  engineCommit: engineManifest.upstreamCommit,
  engineVersion: engineManifest.engineVersion,
  generatorVersion: GENERATOR_VERSION,
  inventoryCount: inventory.length,
  inventoryBytes: inventory.reduce((sum, entry) => sum + entry.sourceBytes, 0),
  inventorySha256,
};
const shards = assignShards(inventory);

await writeImmutable(resolve(runRoot, "inventory.tsv"), inventoryLines);
for (const shard of shards) {
  const shardDirectory = resolve(runRoot, `shard-${shard.id}`);
  await mkdir(shardDirectory);
  const manifest = {
    schemaVersion: 1,
    sealed: true,
    releaseIdentity,
    shard: shard.id,
    sourceBytes: shard.sourceBytes,
    parks: shard.parks,
  };
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestPath = resolve(shardDirectory, "shard-manifest.json");
  await writeImmutable(manifestPath, manifestBytes);
  await writeImmutable(`${manifestPath}.sha256`, `${sha256(Buffer.from(manifestBytes))}  shard-manifest.json\n`);
}

const summary = {
  schemaVersion: 1,
  sealed: true,
  releaseIdentity,
  shards: shards.map((shard) => ({ id: shard.id, parks: shard.parks.length, sourceBytes: shard.sourceBytes })),
};
const summaryBytes = `${JSON.stringify(summary, null, 2)}\n`;
await writeImmutable(resolve(runRoot, "release-summary.json"), summaryBytes);
await writeImmutable(resolve(runRoot, "release-summary.json.sha256"), `${sha256(Buffer.from(summaryBytes))}  release-summary.json\n`);
console.log(JSON.stringify({ runRoot, ...summary }, null, 2));
