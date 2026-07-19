import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFile, copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PHASE_TIMEOUT_MS = 90_000;
const FILE_STABLE_MS = 750;
const POLL_MS = 250;

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`Expected --name value arguments; received ${key ?? "<end>"}.`);
    values.set(key.slice(2), value);
  }
  return values;
}

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const quoteJs = (value) => JSON.stringify(value);

async function sha256File(path) {
  return sha256(await readFile(path));
}

async function assertPark(path) {
  const bytes = await readFile(path);
  if (bytes.length < 4 || bytes.subarray(0, 4).toString("ascii") !== "PARK") {
    throw new Error("snapshot-signature: output does not begin with PARK");
  }
  return { bytes: bytes.length, sha256: sha256(bytes) };
}

async function assertPng(path, width, height) {
  const bytes = await readFile(path);
  const signature = bytes.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") throw new Error("render-signature: output is not a PNG");
  const actualWidth = bytes.readUInt32BE(16);
  const actualHeight = bytes.readUInt32BE(20);
  if (actualWidth !== width || actualHeight !== height) {
    throw new Error(`render-dimensions: expected ${width}x${height}, received ${actualWidth}x${actualHeight}`);
  }
  return { bytes: bytes.length, sha256: sha256(bytes), width: actualWidth, height: actualHeight };
}

async function findFile(root, name) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const fullPath = resolve(root, entry.name);
    if (entry.isFile() && entry.name === name) return fullPath;
    if (entry.isDirectory()) {
      const nested = await findFile(fullPath, name);
      if (nested) return nested;
    }
  }
  return null;
}

async function waitForStableFile(root, name, outputState, marker) {
  const started = Date.now();
  let lastPath = null;
  let lastSize = -1;
  let stableSince = 0;
  while (Date.now() - started < PHASE_TIMEOUT_MS) {
    if (outputState.exited && outputState.exitCode !== null && outputState.exitCode !== 0) {
      throw new Error(`native-exit: process exited ${outputState.exitCode}; ${outputState.lastError || "no diagnostic"}`);
    }
    const path = await findFile(root, name);
    if (path) {
      const size = (await stat(path)).size;
      if (path === lastPath && size === lastSize && size > 0) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= FILE_STABLE_MS && (!marker || outputState.stdout.includes(marker))) return path;
      } else {
        lastPath = path;
        lastSize = size;
        stableSince = 0;
      }
    }
    await delay(POLL_MS);
  }
  throw new Error(`native-timeout: ${name} or completion marker was not stable within ${PHASE_TIMEOUT_MS} ms; ${outputState.lastError || "no diagnostic"}`);
}

function generatorPlugin(park) {
  const marker = `PARKWORKS_GENERATOR_SAVED:${park.id}`;
  return {
    marker,
    source: `
var parkworksGeneratorDone = false;
function parkworksGeneratorMain() {
  context.subscribe("map.save", function () {
    if (parkworksGeneratorDone) console.log(${quoteJs(marker)});
  });
  context.subscribe("interval.tick", function () {
    if (parkworksGeneratorDone || context.mode !== "normal") return;
    parkworksGeneratorDone = true;
    context.paused = true;
    cheats.sandboxMode = true;
    cheats.ignoreResearchStatus = true;
    cheats.enableAllDrawableTrackPieces = true;
    cheats.showAllOperatingModes = true;
    park.setFlag("noMoney", true);
    park.setFlag("unlockAllPrices", true);
    if (!context.paused || !cheats.sandboxMode || !cheats.ignoreResearchStatus || !cheats.enableAllDrawableTrackPieces || !park.getFlag("noMoney") || !park.getFlag("unlockAllPrices")) {
      console.log("PARKWORKS_GENERATOR_STATE_FAILURE");
      return;
    }
    context.saveGame({ filename: ${quoteJs(park.sourceBasename)} });
  });
}
registerPlugin({
  name: "Parkworks Native Snapshot Generator",
  version: "1.0.0",
  authors: ["Parkworks"],
  type: "intransient",
  licence: "GPL-3.0-or-later",
  targetApiVersion: 116,
  minApiVersion: 116,
  main: parkworksGeneratorMain
});
`,
  };
}

function simulationPlugin(park, ticks, outputBasename) {
  const marker = `PARKWORKS_SIMULATION_SAVED:${park.id}:${ticks}`;
  return {
    marker,
    source: `
var parkworksSimulationStarted = false;
var parkworksSimulationDone = false;
var parkworksSimulationTicks = 0;
function parkworksSimulationStart() {
  if (context.mode !== "normal" || parkworksSimulationStarted) return;
  parkworksSimulationStarted = true;
  context.paused = false;
}
function parkworksSimulationWake() {
  parkworksSimulationStart();
  if (!parkworksSimulationStarted) context.setTimeout(parkworksSimulationWake, 50);
}
function parkworksSimulationMain() {
  context.subscribe("map.changed", parkworksSimulationStart);
  context.subscribe("map.save", function () {
    if (parkworksSimulationDone) console.log(${quoteJs(marker)});
  });
  context.subscribe("interval.tick", function () {
    parkworksSimulationStart();
    if (!parkworksSimulationStarted || parkworksSimulationDone || context.mode !== "normal") return;
    parkworksSimulationTicks += 1;
    if (parkworksSimulationTicks < ${ticks}) return;
    parkworksSimulationDone = true;
    context.paused = true;
    context.saveGame({ filename: ${quoteJs(outputBasename)} });
  });
  parkworksSimulationWake();
}
registerPlugin({
  name: "Parkworks Native Snapshot Simulation",
  version: "1.0.0",
  authors: ["Parkworks"],
  type: "intransient",
  licence: "GPL-3.0-or-later",
  targetApiVersion: 116,
  minApiVersion: 116,
  main: parkworksSimulationMain
});
`,
  };
}

function renderPlugin(park, filename) {
  const marker = `PARKWORKS_RENDER_REQUESTED:${park.id}`;
  return {
    marker,
    source: `
var parkworksRenderDone = false;
function parkworksRenderCapture() {
  if (parkworksRenderDone || context.mode !== "normal") return;
  parkworksRenderDone = true;
  context.paused = true;
  context.captureImage({
    filename: ${quoteJs(filename)},
    width: 1280,
    height: 720,
    position: { x: map.size.x * 16, y: map.size.y * 16 },
    zoom: 0,
    rotation: 0
  });
  console.log(${quoteJs(marker)});
}
function parkworksRenderWake() {
  parkworksRenderCapture();
  if (!parkworksRenderDone) context.setTimeout(parkworksRenderWake, 50);
}
function parkworksRenderMain() {
  context.subscribe("map.changed", parkworksRenderCapture);
  context.subscribe("interval.tick", parkworksRenderCapture);
  parkworksRenderWake();
}
registerPlugin({
  name: "Parkworks Native Diagnostic Renderer",
  version: "1.0.0",
  authors: ["Parkworks"],
  type: "intransient",
  licence: "GPL-3.0-or-later",
  targetApiVersion: 116,
  minApiVersion: 116,
  main: parkworksRenderMain
});
`,
  };
}

async function runPhase({ inputPath, profilePath, plugin, expectedName, nativeExe, portableData, rct2Root }) {
  await mkdir(resolve(profilePath, "plugin"), { recursive: true });
  await writeFile(resolve(profilePath, "plugin", "parkworks-native-worker.js"), plugin.source, { flag: "wx" });
  const args = [
    inputPath,
    "--no-install",
    `--user-data-path=${profilePath}`,
    `--openrct2-data-path=${portableData}`,
    `--rct2-data-path=${rct2Root}`,
    "--silent-breakpad",
  ];
  const child = spawn(nativeExe, args, { cwd: dirname(nativeExe), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const outputState = { stdout: "", lastError: "", exited: false, exitCode: null };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { outputState.stdout = `${outputState.stdout}${chunk}`.slice(-32_768); });
  child.stderr.on("data", (chunk) => { outputState.lastError = `${outputState.lastError}${chunk}`.slice(-2_048).replace(/[\r\n]+/g, " "); });
  child.on("exit", (code) => { outputState.exited = true; outputState.exitCode = code; });
  try {
    return await waitForStableFile(profilePath, expectedName, outputState, plugin.marker);
  } finally {
    if (!outputState.exited) {
      child.kill();
      await Promise.race([new Promise((resolveExit) => child.once("exit", resolveExit)), delay(2_000)]);
    }
  }
}

function classifyFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  const classification = message.split(":", 1)[0].replace(/[^a-z0-9-]/gi, "-").toLowerCase() || "unknown";
  return { classification, detail: message.slice(0, 1_000) };
}

const args = parseArgs(process.argv.slice(2));
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const manifestPath = resolve(args.get("manifest") ?? "");
const privateRunRoot = resolve(args.get("private-run-root") ?? dirname(dirname(manifestPath)));
const portableRoot = resolve(args.get("portable-root") ?? resolve(projectRoot, ".upstream-portable-extracted"));
const rct2Root = resolve(args.get("rct2-root") ?? "");
const mode = args.get("mode") ?? "release";
const pilotParkId = args.get("park-id") ?? null;
const attemptId = args.get("attempt-id") ?? null;
if (!isAbsolute(manifestPath) || !isAbsolute(privateRunRoot) || !isAbsolute(portableRoot) || !isAbsolute(rct2Root)) {
  throw new Error("Manifest, private run root, portable root, and RCT2 root must be absolute.");
}
const privateRelative = relative(projectRoot, privateRunRoot);
if (!privateRelative.startsWith("..") || isAbsolute(privateRelative)) throw new Error("Worker output must remain outside the Git working tree.");
if (!new Set(["release", "pilot"]).has(mode)) throw new Error("Mode must be release or pilot.");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.schemaVersion !== 1 || manifest.sealed !== true || !Array.isArray(manifest.parks) || !manifest.releaseIdentity) {
  throw new Error("Shard manifest is invalid or unsealed.");
}
const manifestDigest = await sha256File(manifestPath);
const expectedDigestLine = await readFile(`${manifestPath}.sha256`, "utf8");
if (!expectedDigestLine.toLowerCase().startsWith(manifestDigest)) throw new Error("Shard manifest hash sidecar does not match.");
let parks = manifest.parks;
if (mode === "pilot") {
  if (!pilotParkId) throw new Error("Pilot mode requires --park-id.");
  if (!attemptId || !/^[a-z0-9][a-z0-9-]*$/i.test(attemptId)) throw new Error("Pilot mode requires a safe --attempt-id.");
  parks = parks.filter((park) => park.id === pilotParkId);
  if (parks.length !== 1) throw new Error(`Pilot park ${pilotParkId} is not in shard ${manifest.shard}.`);
} else if (pilotParkId) {
  throw new Error("Release mode does not accept a park filter.");
}

const nativeExe = resolve(portableRoot, "openrct2.com");
const portableData = resolve(portableRoot, "data");
const workerRoot = resolve(
  privateRunRoot,
  mode === "pilot" ? `pilot-${manifest.shard}-${pilotParkId}-${attemptId}` : `worker-${manifest.shard}`,
);
const snapshotsRoot = resolve(workerRoot, "snapshots");
const validationRoot = resolve(workerRoot, "validation");
const runtimeRoot = resolve(workerRoot, "runtime");
const receiptsPath = resolve(workerRoot, "receipts.jsonl");
await mkdir(workerRoot, { recursive: false });
await mkdir(snapshotsRoot, { recursive: false });
await mkdir(validationRoot);
await mkdir(runtimeRoot);
const nativeBinary = { bytes: (await stat(nativeExe)).size, sha256: await sha256File(nativeExe) };

let failures = 0;
for (const park of parks) {
  const startedAt = new Date().toISOString();
  const phaseTimingsMs = {};
  const receipt = {
    schemaVersion: 1,
    runId: manifest.releaseIdentity.runId,
    shard: manifest.shard,
    mode,
    manifestSha256: manifestDigest,
    releaseIdentity: manifest.releaseIdentity,
    scenario: {
      id: park.id,
      title: park.title,
      sourceBasename: park.sourceBasename,
      sourceSha256: park.sourceSha256,
      sourceBytes: park.sourceBytes,
      category: park.category,
      order: park.order,
    },
    nativeBinary,
    startedAt,
    status: "failure",
  };
  try {
    if (await sha256File(park.sourcePath) !== park.sourceSha256 || (await stat(park.sourcePath)).size !== park.sourceBytes) {
      throw new Error("source-identity: licensed source changed after manifest sealing");
    }

    let phaseStart = Date.now();
    const generationProfile = resolve(runtimeRoot, park.id, "generate");
    const generatedPath = await runPhase({
      inputPath: park.sourcePath,
      profilePath: generationProfile,
      plugin: generatorPlugin(park),
      expectedName: park.snapshotName,
      nativeExe,
      portableData,
      rct2Root,
    });
    phaseTimingsMs.generate = Date.now() - phaseStart;
    const snapshotPath = resolve(snapshotsRoot, park.snapshotName);
    await copyFile(generatedPath, snapshotPath, 0x1);
    receipt.snapshot = { name: park.snapshotName, ...(await assertPark(snapshotPath)) };

    phaseStart = Date.now();
    const sim1000Name = `${park.id}-after-1000.park`;
    const sim1000Profile = resolve(runtimeRoot, park.id, "simulate-1000");
    const sim1000Generated = await runPhase({
      inputPath: snapshotPath,
      profilePath: sim1000Profile,
      plugin: simulationPlugin(park, 1000, basename(sim1000Name, extname(sim1000Name))),
      expectedName: sim1000Name,
      nativeExe,
      portableData,
      rct2Root,
    });
    phaseTimingsMs.simulate1000 = Date.now() - phaseStart;
    const sim1000Path = resolve(validationRoot, sim1000Name);
    await copyFile(sim1000Generated, sim1000Path, 0x1);
    const sim1000 = await assertPark(sim1000Path);

    phaseStart = Date.now();
    const sim1500Name = `${park.id}-after-reopen-500.park`;
    const sim500Profile = resolve(runtimeRoot, park.id, "reopen-500");
    const sim1500Generated = await runPhase({
      inputPath: sim1000Path,
      profilePath: sim500Profile,
      plugin: simulationPlugin(park, 500, basename(sim1500Name, extname(sim1500Name))),
      expectedName: sim1500Name,
      nativeExe,
      portableData,
      rct2Root,
    });
    phaseTimingsMs.reopen500 = Date.now() - phaseStart;
    const sim1500Path = resolve(validationRoot, sim1500Name);
    await copyFile(sim1500Generated, sim1500Path, 0x1);
    const sim1500 = await assertPark(sim1500Path);
    receipt.simulationChecksums = { after1000: sim1000.sha256, afterReopen500: sim1500.sha256 };

    phaseStart = Date.now();
    const renderName = `${park.id}-1280x720.png`;
    const renderProfile = resolve(runtimeRoot, park.id, "render");
    const renderGenerated = await runPhase({
      inputPath: snapshotPath,
      profilePath: renderProfile,
      plugin: renderPlugin(park, renderName),
      expectedName: renderName,
      nativeExe,
      portableData,
      rct2Root,
    });
    phaseTimingsMs.render = Date.now() - phaseStart;
    const renderPath = resolve(validationRoot, renderName);
    await copyFile(renderGenerated, renderPath, 0x1);
    receipt.render = { result: "pass", name: renderName, ...(await assertPng(renderPath, 1280, 720)) };
    receipt.status = "pass";
  } catch (error) {
    failures += 1;
    receipt.failure = classifyFailure(error);
  }
  receipt.phaseTimingsMs = phaseTimingsMs;
  receipt.finishedAt = new Date().toISOString();
  await appendFile(receiptsPath, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "a" });
  console.log(`${manifest.shard} ${park.id}: ${receipt.status}${receipt.failure ? ` (${receipt.failure.classification})` : ""}`);
}

console.log(JSON.stringify({ shard: manifest.shard, mode, parks: parks.length, failures, receiptsPath }, null, 2));
if (failures) process.exitCode = 1;
