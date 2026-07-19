import { createHash } from "node:crypto";
import { chmod, mkdir, open, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import JSZip from "jszip";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const privateRunRoot = resolve(args.get("--private-run-root") ?? "");
const projectRoot = resolve(args.get("--project-root") ?? process.cwd());
const privateRelative = relative(projectRoot, privateRunRoot);
if (!privateRelative.startsWith("..") || isAbsolute(privateRelative)) throw new Error("Protected library output must remain outside the Git workspace.");

const sha256Bytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function sha256File(path) { return sha256Bytes(await readFile(path)); }
async function writeImmutable(path, bytes) {
  const handle = await open(path, "wx", 0o400);
  try { await handle.writeFile(bytes); } finally { await handle.close(); }
  await chmod(path, 0o400);
}

const manifests = [];
const receipts = [];
for (const shard of ["A", "B", "C"]) {
  const manifestPath = resolve(privateRunRoot, `shard-${shard}`, "shard-manifest.json");
  const manifestBytes = await readFile(manifestPath);
  const manifestSha256 = sha256Bytes(manifestBytes);
  const sidecar = (await readFile(`${manifestPath}.sha256`, "utf8")).trim().toLowerCase();
  if (!sidecar.startsWith(manifestSha256)) throw new Error(`Shard ${shard} manifest seal failed.`);
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schemaVersion !== 1 || manifest.sealed !== true || manifest.shard !== shard || manifest.parks.length !== 19) {
    throw new Error(`Shard ${shard} manifest shape failed.`);
  }
  manifests.push({ shard, manifest, manifestSha256 });

  const receiptPath = resolve(privateRunRoot, `worker-${shard}`, "receipts.jsonl");
  const receiptText = await readFile(receiptPath, "utf8");
  const lines = receiptText.trim().split(/\r?\n/);
  if (lines.length !== 19) throw new Error(`Shard ${shard} must have exactly 19 no-retry receipts.`);
  receipts.push({ shard, receiptPath, receiptSha256: sha256Bytes(Buffer.from(receiptText)), rows: lines.map((line) => JSON.parse(line)) });
}

const identityText = JSON.stringify(manifests[0].manifest.releaseIdentity);
if (manifests.some(({ manifest }) => JSON.stringify(manifest.releaseIdentity) !== identityText)) throw new Error("Shard release identities differ.");
const releaseIdentity = manifests[0].manifest.releaseIdentity;
if (releaseIdentity.inventoryCount !== 57 || releaseIdentity.inventoryBytes !== 28_194_642) throw new Error("Frozen inventory identity is wrong.");

const manifestParks = manifests.flatMap(({ shard, manifest, manifestSha256 }) =>
  manifest.parks.map((park) => ({ ...park, shard, manifestSha256 })));
if (manifestParks.length !== 57 || new Set(manifestParks.map((park) => park.id)).size !== 57 ||
  new Set(manifestParks.map((park) => park.sourceBasename)).size !== 57) throw new Error("Shards do not form one unique 57-park inventory.");
if (!manifestParks.some((park) => park.id === "electric-fields") || !manifestParks.some((park) => park.id === "six-flags-magic-mountain")) {
  throw new Error("Mandatory regression parks are missing.");
}

const receiptById = new Map();
for (const group of receipts) {
  for (const receipt of group.rows) {
    if (receipt.status !== "pass" || receipt.mode !== "release" || receipt.shard !== group.shard || receipt.render?.result !== "pass" ||
      receipt.render.width !== 1280 || receipt.render.height !== 720 || !receipt.simulationChecksums?.after1000 || !receipt.simulationChecksums?.afterReopen500) {
      throw new Error(`Receipt validation failed for ${receipt.scenario?.id ?? group.shard}.`);
    }
    if (receiptById.has(receipt.scenario.id)) throw new Error(`Duplicate receipt for ${receipt.scenario.id}.`);
    receiptById.set(receipt.scenario.id, receipt);
  }
}
if (receiptById.size !== 57) throw new Error("Release receipts do not cover exactly 57 parks.");

const sorted = manifestParks.slice().sort((left, right) => left.order - right.order || left.title.localeCompare(right.title));
const zip = new JSZip();
const parks = [];
for (let order = 0; order < sorted.length; order += 1) {
  const park = sorted[order];
  const receipt = receiptById.get(park.id);
  if (!receipt || receipt.manifestSha256 !== park.manifestSha256 || receipt.scenario.sourceSha256 !== park.sourceSha256 ||
    receipt.snapshot.name !== park.snapshotName) throw new Error(`Receipt identity mismatch for ${park.id}.`);
  const snapshotPath = resolve(privateRunRoot, `worker-${park.shard}`, "snapshots", park.snapshotName);
  const snapshotBytes = await readFile(snapshotPath);
  if (snapshotBytes.subarray(0, 4).toString("ascii") !== "PARK" || snapshotBytes.byteLength !== receipt.snapshot.bytes ||
    sha256Bytes(snapshotBytes) !== receipt.snapshot.sha256) throw new Error(`Snapshot identity mismatch for ${park.id}.`);
  zip.file(park.snapshotName, snapshotBytes, { binary: true, date: new Date("1980-01-01T00:00:00.000Z"), createFolders: false });
  parks.push({
    id: park.id,
    title: park.title,
    sourceBasename: park.sourceBasename,
    sourceSha256: park.sourceSha256,
    sourceBytes: park.sourceBytes,
    snapshotPath: park.snapshotName,
    snapshotSha256: receipt.snapshot.sha256,
    snapshotBytes: receipt.snapshot.bytes,
    category: park.category,
    order,
  });
}

const outputRoot = resolve(privateRunRoot, "protected-library");
await mkdir(outputRoot, { recursive: false });
const bundleName = `park-library-${releaseIdentity.libraryVersion}.zip`;
const bundleBytes = await zip.generateAsync({ type: "nodebuffer", compression: "STORE", platform: "DOS" });
const bundleSha256 = sha256Bytes(bundleBytes);
const manifest = {
  schemaVersion: 1,
  libraryVersion: releaseIdentity.libraryVersion,
  engineCommit: releaseIdentity.engineCommit,
  bundle: { url: `/licensed/${bundleName}`, sha256: bundleSha256, bytes: bundleBytes.byteLength },
  parks,
};
const manifestName = `park-library-${releaseIdentity.libraryVersion}.json`;
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
await writeImmutable(resolve(outputRoot, bundleName), bundleBytes);
await writeImmutable(resolve(outputRoot, manifestName), manifestBytes);

const aggregateReceipt = {
  schemaVersion: 1,
  status: "pass",
  releaseIdentity,
  parkCount: parks.length,
  mandatoryParkIds: ["electric-fields", "six-flags-magic-mountain"],
  workerReceipts: receipts.map(({ shard, receiptSha256 }) => ({ shard, receiptSha256, parks: 19 })),
  bundle: { name: bundleName, bytes: bundleBytes.byteLength, sha256: bundleSha256 },
  manifest: { name: manifestName, bytes: manifestBytes.byteLength, sha256: sha256Bytes(manifestBytes) },
  createdAt: new Date().toISOString(),
};
const receiptBytes = Buffer.from(`${JSON.stringify(aggregateReceipt, null, 2)}\n`);
await writeImmutable(resolve(outputRoot, "aggregate-receipt.json"), receiptBytes);
console.log(JSON.stringify(aggregateReceipt, null, 2));
