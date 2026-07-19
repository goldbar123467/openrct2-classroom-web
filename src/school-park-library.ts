import JSZip from "jszip";
import { ENGINE_COMMIT, sha256 } from "./engine-utils";
import { clearTree, pathExists, syncFileSystem, type OpenRct2Fs, type OpenRct2Module, type ProgressReporter } from "./openrct2";

const ACTIVE_ROOT = "/RCT/ParkworksLibrary";
const PREVIOUS_ROOT = "/RCT/ParkworksLibraryPrevious";
const STAGING_ROOT = "/RCT/ParkworksLibraryStaging";
const JOURNAL_PATH = "/RCT/.parkworks-library-journal.json";
const MARKER_NAME = ".parkworks-library.json";
const LEGACY_MAGIC_PATH = "/persistent/save/Six Flags Magic Mountain Browser Sandbox.park";
const LEGACY_MAGIC_MARKER = "/RCT/.parkworks-magic-mountain-patch";
const EXPECTED_PARKS = 57;
const MAX_BUNDLE_BYTES = 250_000_000;
const MAX_SNAPSHOT_BYTES = 10_000_000;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_BASENAME_PATTERN = /^[^<>:"/\\|?*\x00-\x1f.][^<>:"/\\|?*\x00-\x1f]*$/;

export interface SchoolParkManifestEntry {
  id: string;
  title: string;
  sourceBasename: string;
  sourceSha256: string;
  sourceBytes: number;
  snapshotPath: string;
  snapshotSha256: string;
  snapshotBytes: number;
  category: string;
  order: number;
}

export interface SchoolParkLibraryManifest {
  schemaVersion: 1;
  libraryVersion: string;
  engineCommit: string;
  bundle: { url: string; sha256: string; bytes: number };
  parks: SchoolParkManifestEntry[];
}

export interface InstalledSchoolParkLibrary {
  manifest: SchoolParkLibraryManifest;
  manifestSha256: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value) throw new Error(`Park library ${key} is missing.`);
  return value;
}

function requireInteger(record: Record<string, unknown>, key: string, minimum = 0): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error(`Park library ${key} is invalid.`);
  return value as number;
}

function resolveLicensedUrl(value: string, origin: string): URL {
  const url = new URL(value, origin);
  if (
    url.origin !== origin ||
    !url.pathname.startsWith("/licensed/") ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("Park library URLs must be credential-free same-origin /licensed/ URLs.");
  }
  return url;
}

export function validateSchoolParkLibraryManifest(
  value: unknown,
  expectedVersion: string,
  origin = window.location.origin,
): SchoolParkLibraryManifest {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error("Unsupported park library manifest schema.");
  const libraryVersion = requireString(value, "libraryVersion");
  if (!expectedVersion || libraryVersion !== expectedVersion) throw new Error("Park library version does not match this launcher.");
  const engineCommit = requireString(value, "engineCommit");
  if (engineCommit !== ENGINE_COMMIT) throw new Error("Park library engine identity does not match this launcher.");
  if (!isRecord(value.bundle)) throw new Error("Park library bundle metadata is missing.");
  const bundleUrl = resolveLicensedUrl(requireString(value.bundle, "url"), origin).href;
  const bundleSha256 = requireString(value.bundle, "sha256");
  const bundleBytes = requireInteger(value.bundle, "bytes", 1);
  if (!HASH_PATTERN.test(bundleSha256) || bundleBytes > MAX_BUNDLE_BYTES) throw new Error("Park library bundle identity is invalid.");
  if (!Array.isArray(value.parks) || value.parks.length !== EXPECTED_PARKS) {
    throw new Error(`Park library must contain exactly ${EXPECTED_PARKS} parks.`);
  }

  const ids = new Set<string>();
  const basenames = new Set<string>();
  const snapshotPaths = new Set<string>();
  const orders = new Set<number>();
  const parks = value.parks.map((candidate, index): SchoolParkManifestEntry => {
    if (!isRecord(candidate)) throw new Error(`Park library entry ${index} is invalid.`);
    const id = requireString(candidate, "id");
    const title = requireString(candidate, "title");
    const sourceBasename = requireString(candidate, "sourceBasename");
    const sourceSha256 = requireString(candidate, "sourceSha256");
    const sourceBytes = requireInteger(candidate, "sourceBytes", 1);
    const snapshotPath = requireString(candidate, "snapshotPath");
    const snapshotSha256 = requireString(candidate, "snapshotSha256");
    const snapshotBytes = requireInteger(candidate, "snapshotBytes", 16);
    const category = requireString(candidate, "category");
    const order = requireInteger(candidate, "order");
    if (!SAFE_ID_PATTERN.test(id) || !SAFE_BASENAME_PATTERN.test(sourceBasename)) throw new Error(`Park library entry ${index} has an unsafe identity.`);
    if (snapshotPath !== `${sourceBasename}.park`) throw new Error(`Park library entry ${index} has an unsafe snapshot path.`);
    if (!HASH_PATTERN.test(sourceSha256) || !HASH_PATTERN.test(snapshotSha256) || snapshotBytes > MAX_SNAPSHOT_BYTES) {
      throw new Error(`Park library entry ${index} has an invalid hash or size.`);
    }
    if (ids.has(id) || basenames.has(sourceBasename) || snapshotPaths.has(snapshotPath) || orders.has(order)) {
      throw new Error("Park library contains duplicate IDs, basenames, paths, or order values.");
    }
    ids.add(id);
    basenames.add(sourceBasename);
    snapshotPaths.add(snapshotPath);
    orders.add(order);
    return { id, title, sourceBasename, sourceSha256, sourceBytes, snapshotPath, snapshotSha256, snapshotBytes, category, order };
  });
  const sortedOrders = [...orders].sort((left, right) => left - right);
  if (sortedOrders.some((order, index) => order !== index)) throw new Error("Park library order must be a complete zero-based sequence.");
  return {
    schemaVersion: 1,
    libraryVersion,
    engineCommit,
    bundle: { url: bundleUrl, sha256: bundleSha256, bytes: bundleBytes },
    parks,
  };
}

function readBytes(fs: OpenRct2Fs, path: string): Uint8Array {
  const value = fs.readFile(path);
  if (typeof value === "string") return new TextEncoder().encode(value);
  return value;
}

function ensureDirectory(fs: OpenRct2Fs, path: string): void {
  let current = "";
  for (const part of path.split("/").filter(Boolean)) {
    current += `/${part}`;
    if (!pathExists(fs, current)) fs.mkdir(current);
  }
}

function removeTree(fs: OpenRct2Fs, path: string): void {
  if (!pathExists(fs, path)) return;
  clearTree(fs, path);
  fs.rmdir(path);
}

async function validateInstalledLibrary(
  fs: OpenRct2Fs,
  root: string,
  manifest: SchoolParkLibraryManifest,
  manifestSha256: string,
): Promise<boolean> {
  if (!pathExists(fs, root)) return false;
  const markerPath = `${root}/${MARKER_NAME}`;
  if (!pathExists(fs, markerPath)) return false;
  try {
    const markerText = fs.readFile(markerPath, { encoding: "utf8" });
    const marker = JSON.parse(typeof markerText === "string" ? markerText : new TextDecoder().decode(markerText));
    if (marker.libraryVersion !== manifest.libraryVersion || marker.manifestSha256 !== manifestSha256) return false;
    for (const park of manifest.parks) {
      const path = `${root}/${park.snapshotPath}`;
      if (!pathExists(fs, path) || fs.stat(path).size !== park.snapshotBytes) return false;
      const bytes = readBytes(fs, path);
      if (new TextDecoder().decode(bytes.subarray(0, 4)) !== "PARK" || await sha256(bytes) !== park.snapshotSha256) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function fetchPrivateBytes(url: URL, label: string, reporter?: ProgressReporter): Promise<Uint8Array> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error(`${label} download failed (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  reporter?.({ phase: "game-assets", message: `${label} downloaded and ready to verify.`, loaded: bytes.byteLength, total: bytes.byteLength });
  return bytes;
}

export async function migrateLegacyMagicMountainSnapshot(
  module: OpenRct2Module,
  manifest: SchoolParkLibraryManifest,
): Promise<boolean> {
  const fs = module.FS;
  if (!pathExists(fs, LEGACY_MAGIC_PATH) || !pathExists(fs, LEGACY_MAGIC_MARKER)) return false;
  const magic = manifest.parks.find((park) => park.id === "six-flags-magic-mountain");
  if (!magic) throw new Error("Verified library is missing the Magic Mountain regression park.");
  const legacy = readBytes(fs, LEGACY_MAGIC_PATH);
  if (legacy.byteLength !== magic.snapshotBytes || await sha256(legacy) !== magic.snapshotSha256) return false;
  fs.unlink(LEGACY_MAGIC_PATH);
  fs.unlink(LEGACY_MAGIC_MARKER);
  await syncFileSystem(module);
  return true;
}

async function restorePreviousLibrary(module: OpenRct2Module): Promise<void> {
  const fs = module.FS;
  let hadActive = true;
  if (pathExists(fs, JOURNAL_PATH)) {
    try {
      const journalText = fs.readFile(JOURNAL_PATH, { encoding: "utf8" });
      const journal = JSON.parse(typeof journalText === "string" ? journalText : new TextDecoder().decode(journalText));
      hadActive = journal.hadActive !== false;
    } catch {
      hadActive = true;
    }
  }
  if (pathExists(fs, PREVIOUS_ROOT)) {
    if (pathExists(fs, ACTIVE_ROOT)) removeTree(fs, ACTIVE_ROOT);
    fs.rename(PREVIOUS_ROOT, ACTIVE_ROOT);
  } else if (!hadActive && pathExists(fs, ACTIVE_ROOT)) {
    removeTree(fs, ACTIVE_ROOT);
  }
  if (pathExists(fs, STAGING_ROOT)) removeTree(fs, STAGING_ROOT);
  if (pathExists(fs, JOURNAL_PATH)) fs.unlink(JOURNAL_PATH);
  await syncFileSystem(module);
}

export async function ensureSchoolParkLibrary(
  module: OpenRct2Module,
  manifestUrlValue: string,
  expectedVersion: string,
  reporter?: ProgressReporter,
): Promise<InstalledSchoolParkLibrary> {
  const manifestUrl = resolveLicensedUrl(manifestUrlValue, window.location.origin);
  reporter?.({ phase: "game-assets", message: "Checking the protected 57-park library…" });
  const manifestBytes = await fetchPrivateBytes(manifestUrl, "Park library manifest", reporter);
  const manifestSha256 = await sha256(manifestBytes);
  const manifest = validateSchoolParkLibraryManifest(JSON.parse(new TextDecoder().decode(manifestBytes)), expectedVersion);
  if (await validateInstalledLibrary(module.FS, ACTIVE_ROOT, manifest, manifestSha256)) {
    await migrateLegacyMagicMountainSnapshot(module, manifest);
    return { manifest, manifestSha256 };
  }

  const bundleBytes = await fetchPrivateBytes(new URL(manifest.bundle.url), "Park library", reporter);
  if (bundleBytes.byteLength !== manifest.bundle.bytes || await sha256(bundleBytes) !== manifest.bundle.sha256) {
    throw new Error("Park library bundle identity does not match its manifest.");
  }
  const archive = await JSZip.loadAsync(bundleBytes, { checkCRC32: true });
  const entries = Object.values(archive.files).filter((entry) => !entry.dir);
  if (entries.length !== manifest.parks.length) throw new Error("Park library archive does not contain exactly 57 snapshots.");
  const archiveByName = new Map(entries.map((entry) => [entry.name, entry]));
  if (archiveByName.size !== entries.length || entries.some((entry) => entry.name.includes("/") || entry.name.includes("\\"))) {
    throw new Error("Park library archive contains duplicate or unsafe paths.");
  }

  const fs = module.FS;
  if (pathExists(fs, STAGING_ROOT)) removeTree(fs, STAGING_ROOT);
  ensureDirectory(fs, STAGING_ROOT);
  try {
    for (let index = 0; index < manifest.parks.length; index += 1) {
      const park = manifest.parks[index];
      if (!park) throw new Error(`Park library entry ${index} disappeared during installation.`);
      const entry = archiveByName.get(park.snapshotPath);
      if (!entry) throw new Error(`Park library snapshot is missing: ${park.id}.`);
      const bytes = await entry.async("uint8array");
      if (
        bytes.byteLength !== park.snapshotBytes ||
        new TextDecoder().decode(bytes.subarray(0, 4)) !== "PARK" ||
        await sha256(bytes) !== park.snapshotSha256
      ) {
        throw new Error(`Park library snapshot failed validation: ${park.id}.`);
      }
      fs.writeFile(`${STAGING_ROOT}/${park.snapshotPath}`, bytes);
      if (index % 5 === 0 || index === manifest.parks.length - 1) {
        reporter?.({ phase: "game-assets", message: "Installing verified park snapshots…", loaded: index + 1, total: manifest.parks.length });
        await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
      }
    }
    fs.writeFile(`${STAGING_ROOT}/${MARKER_NAME}`, JSON.stringify({
      schemaVersion: 1,
      libraryVersion: manifest.libraryVersion,
      manifestSha256,
      bundleSha256: manifest.bundle.sha256,
      installedAt: new Date().toISOString(),
    }));
    await syncFileSystem(module);

    fs.writeFile(JOURNAL_PATH, JSON.stringify({
      state: "swapping",
      libraryVersion: manifest.libraryVersion,
      manifestSha256,
      hadActive: pathExists(fs, ACTIVE_ROOT),
    }));
    if (pathExists(fs, PREVIOUS_ROOT)) removeTree(fs, PREVIOUS_ROOT);
    if (pathExists(fs, ACTIVE_ROOT)) fs.rename(ACTIVE_ROOT, PREVIOUS_ROOT);
    fs.rename(STAGING_ROOT, ACTIVE_ROOT);
    await syncFileSystem(module);
    if (!await validateInstalledLibrary(fs, ACTIVE_ROOT, manifest, manifestSha256)) throw new Error("Installed park library failed its post-swap validation.");
    if (pathExists(fs, JOURNAL_PATH)) fs.unlink(JOURNAL_PATH);
    await syncFileSystem(module);
    await migrateLegacyMagicMountainSnapshot(module, manifest);
    return { manifest, manifestSha256 };
  } catch (error) {
    if (pathExists(module.FS, JOURNAL_PATH)) await restorePreviousLibrary(module);
    else {
      if (pathExists(module.FS, STAGING_ROOT)) removeTree(module.FS, STAGING_ROOT);
      await syncFileSystem(module);
    }
    throw error;
  }
}

export async function recoverSchoolParkLibraryTransaction(module: OpenRct2Module): Promise<boolean> {
  if (!pathExists(module.FS, JOURNAL_PATH)) return false;
  await restorePreviousLibrary(module);
  return true;
}
