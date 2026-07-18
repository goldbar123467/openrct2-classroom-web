import JSZip from "jszip";
import {
  ENGINE_COMMIT,
  ENGINE_VERSION,
  MAX_RCT_ENTRIES,
  MAX_RCT_UNCOMPRESSED_BYTES,
  MAX_RCT_ZIP_BYTES,
  findRctRoot,
  safeRelativeZipPath,
  type PerformanceProfile,
} from "./engine-utils";

const ENGINE_BASE = "/engine";
const ENGINE_QUERY = `?v=${ENGINE_COMMIT.slice(0, 12)}-classroom2`;
const ENGINE_ASSET_LIMIT = 250_000_000;
const ENGINE_ASSET_ENTRY_LIMIT = 5_000;

export type ProgressPhase = "checking" | "engine" | "open-assets" | "game-assets" | "storage" | "ready";

export interface ProgressUpdate {
  phase: ProgressPhase;
  message: string;
  loaded?: number;
  total?: number;
}

export type ProgressReporter = (update: ProgressUpdate) => void;

export interface OpenRct2Fs {
  filesystems: { IDBFS: unknown };
  mkdir(path: string): void;
  mount(type: unknown, options: Record<string, unknown>, mountpoint: string): void;
  syncfs(populate: boolean, callback: (error?: unknown) => void): void;
  analyzePath(path: string): { exists: boolean };
  readFile(path: string, options?: { encoding?: "utf8" }): Uint8Array | string;
  writeFile(path: string, data: Uint8Array | string): void;
  readdir(path: string): string[];
  stat(path: string): { mode: number; size: number };
  isDir(mode: number): boolean;
  unlink(path: string): void;
  rmdir(path: string): void;
  rename(oldPath: string, newPath: string): void;
}

export interface OpenRct2Module {
  FS: OpenRct2Fs;
  canvas: HTMLCanvasElement;
  callMain(args: string[]): number;
  pauseMainLoop?: () => void;
  resumeMainLoop?: () => void;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
}

interface OpenRct2FactoryOptions {
  noInitialRun: boolean;
  canvas: HTMLCanvasElement;
  INITIAL_MEMORY: number;
  PTHREAD_POOL_SIZE: number;
  mainScriptUrlOrBlob: string;
  locateFile: (fileName: string) => string;
  print: (message: string) => void;
  printErr: (message: string) => void;
}

declare global {
  interface Window {
    OPENRCT2_WEB?: (options: OpenRct2FactoryOptions) => Promise<OpenRct2Module>;
    __parkworksModule?: OpenRct2Module;
  }
}

let modulePromise: Promise<OpenRct2Module> | null = null;
let syncPromise: Promise<void> | null = null;
let gameStarted = false;

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const candidate = error as {
      code?: unknown;
      errno?: unknown;
      message?: unknown;
      name?: unknown;
      target?: { error?: { message?: unknown; name?: unknown } };
    };
    if (typeof candidate.message === "string") return candidate.message;
    if (typeof candidate.target?.error?.message === "string") return candidate.target.error.message;
    if (typeof candidate.target?.error?.name === "string") return candidate.target.error.name;
    if (typeof candidate.code === "string") return candidate.code;
    if (typeof candidate.errno === "number") return `Errno ${candidate.errno}`;
    if (typeof candidate.name === "string") return candidate.name;
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Fall through to a stable generic message.
    }
  }
  return String(error);
}

function assertBrowserCapabilities(): void {
  if (!window.isSecureContext && location.hostname !== "127.0.0.1" && location.hostname !== "localhost") {
    throw new Error("Parkworks needs a secure HTTPS connection.");
  }
  if (!window.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") {
    throw new Error("This page is missing the browser isolation required by OpenRCT2. Ask your teacher to check the site headers.");
  }
  if (typeof WebAssembly === "undefined" || typeof indexedDB === "undefined") {
    throw new Error("This browser is missing WebAssembly or local database support. Update ChromeOS and try again.");
  }
}

async function loadEngineScript(): Promise<void> {
  if (window.OPENRCT2_WEB) return;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${ENGINE_BASE}/openrct2.js${ENGINE_QUERY}`;
    script.async = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("The OpenRCT2 engine could not be downloaded.")), { once: true });
    document.head.append(script);
  });
  if (!window.OPENRCT2_WEB) throw new Error("The OpenRCT2 engine loaded without its browser entry point.");
}

function ensureDirectory(fs: OpenRct2Fs, path: string): void {
  const parts = path.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    if (!fs.analyzePath(current).exists) fs.mkdir(current);
  }
}

export function pathExists(fs: OpenRct2Fs, path: string): boolean {
  return fs.analyzePath(path).exists;
}

export function syncFileSystem(module: OpenRct2Module): Promise<void> {
  if (syncPromise) return syncPromise;
  syncPromise = new Promise<void>((resolve, reject) => {
    module.FS.syncfs(false, (error) => {
      syncPromise = null;
      if (error) {
        console.error("IDBFS save flush failed", error);
        reject(new Error(`Local save storage could not be written: ${describeUnknownError(error)}`));
      }
      else resolve();
    });
  });
  return syncPromise;
}

function populateFileSystems(module: OpenRct2Module): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    module.FS.syncfs(true, (error) => {
      if (error) {
        console.error("IDBFS startup failed", error);
        reject(new Error(`Local save storage could not be opened: ${describeUnknownError(error)}`));
      } else {
        resolve();
      }
    });
  });
}

export function clearTree(fs: OpenRct2Fs, root: string, preserve: string[] = []): void {
  if (!pathExists(fs, root)) return;
  const preserved = new Set(preserve);
  const visit = (path: string): void => {
    for (const name of fs.readdir(path)) {
      if (name === "." || name === ".." || (path === root && preserved.has(name))) continue;
      const child = `${path}/${name}`.replaceAll("//", "/");
      const stat = fs.stat(child);
      if (fs.isDir(stat.mode)) {
        visit(child);
        fs.rmdir(child);
      } else {
        fs.unlink(child);
      }
    }
  };
  visit(root);
}

export function walkFiles(fs: OpenRct2Fs, root: string): string[] {
  if (!pathExists(fs, root)) return [];
  const files: string[] = [];
  const visit = (path: string): void => {
    for (const name of fs.readdir(path)) {
      if (name === "." || name === "..") continue;
      const child = `${path}/${name}`.replaceAll("//", "/");
      const stat = fs.stat(child);
      if (fs.isDir(stat.mode)) visit(child);
      else files.push(child);
    }
  };
  visit(root);
  return files;
}

async function fetchBytes(url: string, reporter: ProgressReporter, phase: ProgressPhase, label: string): Promise<Uint8Array> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`${label} download failed (${response.status}).`);
  const total = Number(response.headers.get("content-length")) || undefined;
  if (!response.body) return new Uint8Array(await response.arrayBuffer());

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
    loaded += result.value.byteLength;
    reporter({ phase, message: `Downloading ${label}…`, loaded, total });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function installOpenAssets(module: OpenRct2Module, reporter: ProgressReporter): Promise<void> {
  const fs = module.FS;
  const markerPath = "/OpenRCT2/version";
  if (pathExists(fs, markerPath)) {
    const existing = fs.readFile(markerPath, { encoding: "utf8" });
    if (existing === ENGINE_VERSION) return;
  }

  reporter({ phase: "open-assets", message: "Preparing OpenRCT2’s open-source park objects…" });
  const archiveBytes = await fetchBytes(
    `${ENGINE_BASE}/assets.zip${ENGINE_QUERY}`,
    reporter,
    "open-assets",
    "open-source park objects",
  );
  const archive = await JSZip.loadAsync(archiveBytes, { checkCRC32: true });
  const entries = Object.values(archive.files).filter((entry) => !entry.dir && !/[\\/]$/.test(entry.name));
  if (entries.length > ENGINE_ASSET_ENTRY_LIMIT) throw new Error("The engine asset pack contains too many files.");

  clearTree(fs, "/OpenRCT2");
  let installedBytes = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    const relative = safeRelativeZipPath(entry.name, "");
    if (!relative) throw new Error("The engine asset pack contains an unsafe path.");
    const data = await entry.async("uint8array");
    installedBytes += data.byteLength;
    if (installedBytes > ENGINE_ASSET_LIMIT) throw new Error("The engine asset pack expands beyond its safety limit.");
    const outputPath = `/OpenRCT2/${relative}`;
    ensureDirectory(fs, outputPath.slice(0, outputPath.lastIndexOf("/")));
    fs.writeFile(outputPath, data);
    if (index % 40 === 0 || index === entries.length - 1) {
      reporter({
        phase: "open-assets",
        message: "Installing open-source park objects…",
        loaded: index + 1,
        total: entries.length,
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }
  fs.writeFile(markerPath, ENGINE_VERSION);
  await syncFileSystem(module);
}

function mountPersistentFileSystems(module: OpenRct2Module): void {
  const fs = module.FS;
  for (const path of ["/persistent", "/RCT", "/RCT-staging", "/OpenRCT2"]) {
    try {
      if (!pathExists(fs, path)) fs.mkdir(path);
      fs.mount(fs.filesystems.IDBFS, { autoPersist: true }, path);
    } catch (error) {
      console.error(`Failed to mount browser storage at ${path}`, error);
      throw new Error(`Local browser storage could not be mounted at ${path}: ${describeUnknownError(error)}`);
    }
  }
}

function registerSaveFlush(module: OpenRct2Module): void {
  const flush = (): void => {
    void syncFileSystem(module).catch((error: unknown) => console.error("Save flush failed", error));
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
  window.setInterval(flush, 15_000);
}

export async function initializeOpenRct2(
  profile: PerformanceProfile,
  reporter: ProgressReporter,
): Promise<OpenRct2Module> {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    reporter({ phase: "checking", message: "Checking this Chromebook…" });
    assertBrowserCapabilities();
    await loadEngineScript();
    const factory = window.OPENRCT2_WEB;
    if (!factory) throw new Error("The OpenRCT2 browser factory is unavailable.");

    const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
    if (!canvas) throw new Error("The game canvas is missing.");
    reporter({ phase: "engine", message: `Starting ${ENGINE_VERSION} in ${profile.label.toLowerCase()} mode…` });

    const module = await factory({
      noInitialRun: true,
      canvas,
      INITIAL_MEMORY: profile.memoryMiB * 1024 * 1024,
      PTHREAD_POOL_SIZE: profile.workers,
      mainScriptUrlOrBlob: `${ENGINE_BASE}/openrct2.js${ENGINE_QUERY}`,
      locateFile: (fileName) =>
        fileName === "openrct2.wasm" ? `${ENGINE_BASE}/openrct2.wasm${ENGINE_QUERY}` : `${ENGINE_BASE}/${fileName}${ENGINE_QUERY}`,
      print: (message) => console.info(`[OpenRCT2] ${message}`),
      printErr: (message) => console.error(`[OpenRCT2] ${message}`),
    });

    mountPersistentFileSystems(module);
    reporter({ phase: "storage", message: "Opening local saves…" });
    await populateFileSystems(module);
    await installOpenAssets(module, reporter);
    registerSaveFlush(module);
    window.__parkworksModule = module;
    reporter({ phase: "ready", message: "OpenRCT2 is ready on this Chromebook." });
    return module;
  })().catch((error) => {
    modulePromise = null;
    throw error;
  });
  return modulePromise;
}

function canonicalizeRctPath(path: string): string {
  const [first, ...rest] = path.split("/");
  const canonicalTopLevel: Record<string, string> = {
    data: "Data",
    objdata: "ObjData",
    scenarios: "Scenarios",
    tracks: "Tracks",
    landscapes: "Landscapes",
  };
  const corrected = first ? (canonicalTopLevel[first.toLowerCase()] ?? first) : first;
  return [corrected, ...rest].filter(Boolean).join("/");
}

async function ensureImportCapacity(file: File): Promise<void> {
  if (!navigator.storage?.estimate) return;
  const estimate = await navigator.storage.estimate();
  const remaining = (estimate.quota ?? 0) - (estimate.usage ?? 0);
  const conservativeNeed = Math.min(file.size * 2.2, MAX_RCT_UNCOMPRESSED_BYTES);
  if (estimate.quota && remaining < conservativeNeed) {
    throw new Error("This Chromebook may not have enough free browser storage. Free some space, then try again.");
  }
}

export async function importRctArchive(
  module: OpenRct2Module,
  file: File,
  reporter: ProgressReporter,
  signal?: AbortSignal,
): Promise<void> {
  if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("Choose a .zip file containing your RCT2 installation.");
  if (file.size > MAX_RCT_ZIP_BYTES) throw new Error("That ZIP is larger than the 1.25 GB classroom safety limit.");
  await ensureImportCapacity(file);

  reporter({ phase: "game-assets", message: "Reading your RCT2 ZIP…", loaded: 0, total: file.size });
  const archive = await JSZip.loadAsync(file, { checkCRC32: true });
  const allEntries = Object.values(archive.files);
  if (allEntries.length > MAX_RCT_ENTRIES) throw new Error("That ZIP contains too many files for the classroom importer.");
  const root = findRctRoot(allEntries.map((entry) => entry.name));
  if (root === null) throw new Error("RCT2 data was not found. The ZIP must include Data/ch.dat from a legitimate RCT2 or RCT Classic installation.");

  const files = allEntries.filter(
    (entry) => !entry.dir && !/[\\/]$/.test(entry.name) && safeRelativeZipPath(entry.name, root),
  );
  const fs = module.FS;
  clearTree(fs, "/RCT-staging");
  let expandedBytes = 0;

  for (let index = 0; index < files.length; index += 1) {
    if (signal?.aborted) {
      clearTree(fs, "/RCT-staging");
      throw new DOMException("Import cancelled", "AbortError");
    }
    const entry = files[index];
    if (!entry) continue;
    const relative = safeRelativeZipPath(entry.name, root);
    if (!relative) continue;
    const data = await entry.async("uint8array");
    expandedBytes += data.byteLength;
    if (expandedBytes > MAX_RCT_UNCOMPRESSED_BYTES) {
      clearTree(fs, "/RCT-staging");
      throw new Error("That ZIP expands beyond the 1.6 GB classroom safety limit.");
    }
    const outputPath = `/RCT-staging/${canonicalizeRctPath(relative)}`;
    ensureDirectory(fs, outputPath.slice(0, outputPath.lastIndexOf("/")));
    fs.writeFile(outputPath, data);
    if (index % 15 === 0 || index === files.length - 1) {
      reporter({
        phase: "game-assets",
        message: "Copying licensed game files into private browser storage…",
        loaded: index + 1,
        total: files.length,
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  if (!pathExists(fs, "/RCT-staging/Data/ch.dat")) {
    clearTree(fs, "/RCT-staging");
    throw new Error("The ZIP was readable but Data/ch.dat was not imported correctly.");
  }

  clearTree(fs, "/RCT");
  for (const sourcePath of walkFiles(fs, "/RCT-staging")) {
    const relative = sourcePath.slice("/RCT-staging/".length);
    const destination = `/RCT/${relative}`;
    ensureDirectory(fs, destination.slice(0, destination.lastIndexOf("/")));
    const bytes = fs.readFile(sourcePath);
    if (typeof bytes === "string") throw new Error("Unexpected text data while installing RCT2 files.");
    fs.writeFile(destination, bytes);
  }
  await syncFileSystem(module);
  clearTree(fs, "/RCT-staging");
  await syncFileSystem(module);
  await navigator.storage?.persist?.();
  localStorage.setItem(
    "parkworks.rctImport",
    JSON.stringify({ importedAt: new Date().toISOString(), sourceBytes: file.size, fileCount: files.length }),
  );
}

export function hasRctData(module: OpenRct2Module): boolean {
  return pathExists(module.FS, "/RCT/Data/ch.dat");
}

export async function clearRctData(module: OpenRct2Module): Promise<void> {
  clearTree(module.FS, "/RCT");
  await syncFileSystem(module);
  localStorage.removeItem("parkworks.rctImport");
}

export async function startGame(module: OpenRct2Module): Promise<void> {
  if (gameStarted) return;
  if (!hasRctData(module)) throw new Error("Add your licensed RCT2 files before opening the park.");
  gameStarted = true;
  module.canvas.hidden = false;
  module.canvas.focus();
  module.callMain(["--user-data-path=/persistent/", "--openrct2-data-path=/OpenRCT2/"]);
}

export function setGamePaused(module: OpenRct2Module, paused: boolean): void {
  if (!gameStarted) return;
  if (paused) module.pauseMainLoop?.();
  else module.resumeMainLoop?.();
}

export function isGameStarted(): boolean {
  return gameStarted;
}
