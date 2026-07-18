import JSZip from "jszip";
import {
  ENGINE_VERSION,
  MAX_BACKUP_BYTES,
  MAX_BACKUP_ENTRIES,
  MAX_BACKUP_UNCOMPRESSED_BYTES,
  isSafeBackupPath,
  sha256,
} from "./engine-utils";
import {
  clearTree,
  pathExists,
  syncFileSystem,
  walkFiles,
  type OpenRct2Fs,
  type OpenRct2Module,
} from "./openrct2";

const BACKUP_FORMAT = "parkworks-openrct2-save-backup";
const BACKUP_VERSION = 1;
const STAGING = "/persistent/.restore-staging";
const ROLLBACK = "/persistent/.restore-rollback";
const JOURNAL = "/persistent/.restore-journal.json";
const PROTECTED_NAMES = [".restore-staging", ".restore-rollback", ".restore-journal.json"];

interface BackupFileRecord {
  path: string;
  size: number;
  sha256: string;
}

interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  engineVersion: string;
  createdAt: string;
  files: BackupFileRecord[];
}

export interface StorageStatus {
  usage: number;
  quota: number;
  persisted: boolean;
}

function ensureDirectory(fs: OpenRct2Fs, path: string): void {
  const parts = path.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    if (!pathExists(fs, current)) fs.mkdir(current);
  }
}

function readBytes(fs: OpenRct2Fs, path: string): Uint8Array {
  const data = fs.readFile(path);
  if (typeof data === "string") return new TextEncoder().encode(data);
  return data;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const estimate = await navigator.storage?.estimate?.();
  const persisted = (await navigator.storage?.persisted?.()) ?? false;
  return {
    usage: estimate?.usage ?? 0,
    quota: estimate?.quota ?? 0,
    persisted,
  };
}

export async function requestPersistentStorage(): Promise<boolean> {
  return (await navigator.storage?.persist?.()) ?? false;
}

export async function exportSaveBackup(module: OpenRct2Module): Promise<{ fileName: string; manifest: BackupManifest }> {
  await syncFileSystem(module);
  const zip = new JSZip();
  const files = walkFiles(module.FS, "/persistent")
    .filter((path) => !PROTECTED_NAMES.some((name) => path.includes(`/${name}`)))
    .sort();
  const records: BackupFileRecord[] = [];

  for (const path of files) {
    const bytes = readBytes(module.FS, path);
    const backupPath = `persistent/${path.slice("/persistent/".length)}`;
    const hash = await sha256(bytes);
    records.push({ path: backupPath, size: bytes.byteLength, sha256: hash });
    zip.file(backupPath, bytes, { binary: true });
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    engineVersion: ENGINE_VERSION,
    createdAt: new Date().toISOString(),
    files: records,
  };
  zip.file("parkworks-manifest.json", JSON.stringify(manifest, null, 2));
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const day = new Date().toISOString().slice(0, 10);
  const fileName = `parkworks-saves-${day}.zip`;
  downloadBlob(blob, fileName);
  return { fileName, manifest };
}

function parseManifest(raw: string): BackupManifest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("The backup manifest is not valid JSON.");
  }
  if (!value || typeof value !== "object") throw new Error("The backup manifest is missing.");
  const manifest = value as Partial<BackupManifest>;
  if (manifest.format !== BACKUP_FORMAT || manifest.version !== BACKUP_VERSION || !Array.isArray(manifest.files)) {
    throw new Error("This is not a supported Parkworks save backup.");
  }
  for (const record of manifest.files) {
    if (
      !record ||
      typeof record.path !== "string" ||
      !isSafeBackupPath(record.path) ||
      typeof record.size !== "number" ||
      typeof record.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.sha256)
    ) {
      throw new Error("The backup manifest contains an unsafe or invalid file record.");
    }
  }
  return manifest as BackupManifest;
}

function moveTopLevelEntries(fs: OpenRct2Fs, from: string, to: string, skip: string[] = []): void {
  ensureDirectory(fs, to);
  const skipped = new Set(skip);
  for (const name of fs.readdir(from)) {
    if (name === "." || name === ".." || skipped.has(name)) continue;
    fs.rename(`${from}/${name}`.replaceAll("//", "/"), `${to}/${name}`.replaceAll("//", "/"));
  }
}

export async function recoverInterruptedRestore(module: OpenRct2Module): Promise<boolean> {
  const fs = module.FS;
  if (!pathExists(fs, JOURNAL)) return false;

  ensureDirectory(fs, STAGING);
  ensureDirectory(fs, ROLLBACK);
  const rollbackEntries = fs.readdir(ROLLBACK).filter((name) => name !== "." && name !== "..");
  if (rollbackEntries.length > 0) {
    clearTree(fs, STAGING);
    moveTopLevelEntries(fs, "/persistent", STAGING, PROTECTED_NAMES);
    moveTopLevelEntries(fs, ROLLBACK, "/persistent");
  }
  clearTree(fs, STAGING);
  clearTree(fs, ROLLBACK);
  if (pathExists(fs, STAGING)) fs.rmdir(STAGING);
  if (pathExists(fs, ROLLBACK)) fs.rmdir(ROLLBACK);
  if (pathExists(fs, JOURNAL)) fs.unlink(JOURNAL);
  await syncFileSystem(module);
  return true;
}

export async function importSaveBackup(module: OpenRct2Module, file: File): Promise<BackupManifest> {
  if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("Choose a Parkworks .zip save backup.");
  if (file.size > MAX_BACKUP_BYTES) throw new Error("That backup is larger than the 250 MB safety limit.");

  const zip = await JSZip.loadAsync(file, { checkCRC32: true });
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && !/[\\/]$/.test(entry.name));
  if (entries.length > MAX_BACKUP_ENTRIES) throw new Error("That backup contains too many files.");
  const manifestEntry = zip.file("parkworks-manifest.json");
  if (!manifestEntry) throw new Error("That ZIP does not contain a Parkworks backup manifest.");
  const manifest = parseManifest(await manifestEntry.async("text"));

  const expected = new Map(manifest.files.map((record) => [record.path, record]));
  if (expected.size !== manifest.files.length) throw new Error("The backup manifest contains duplicate paths.");
  const payloadEntries = entries.filter((entry) => entry.name !== "parkworks-manifest.json");
  if (payloadEntries.length !== expected.size) throw new Error("The backup file list does not match its manifest.");

  const validated = new Map<string, Uint8Array>();
  let expandedBytes = 0;
  for (const entry of payloadEntries) {
    if (!isSafeBackupPath(entry.name)) throw new Error("The backup contains an unsafe file path.");
    const record = expected.get(entry.name);
    if (!record) throw new Error("The backup contains an unlisted file.");
    const bytes = await entry.async("uint8array");
    expandedBytes += bytes.byteLength;
    if (expandedBytes > MAX_BACKUP_UNCOMPRESSED_BYTES) throw new Error("The backup expands beyond the 500 MB safety limit.");
    if (bytes.byteLength !== record.size || (await sha256(bytes)) !== record.sha256) {
      throw new Error(`Backup verification failed for ${entry.name}. Existing saves were not changed.`);
    }
    validated.set(entry.name, bytes);
  }

  const fs = module.FS;
  ensureDirectory(fs, STAGING);
  ensureDirectory(fs, ROLLBACK);
  clearTree(fs, STAGING);
  clearTree(fs, ROLLBACK);

  for (const [path, bytes] of validated) {
    const relative = path.slice("persistent/".length);
    const destination = `${STAGING}/${relative}`;
    ensureDirectory(fs, destination.slice(0, destination.lastIndexOf("/")));
    fs.writeFile(destination, bytes);
  }
  fs.writeFile(JOURNAL, JSON.stringify({ state: "prepared", createdAt: new Date().toISOString() }));
  await syncFileSystem(module);

  fs.writeFile(JOURNAL, JSON.stringify({ state: "swapping", createdAt: new Date().toISOString() }));
  moveTopLevelEntries(fs, "/persistent", ROLLBACK, PROTECTED_NAMES);
  moveTopLevelEntries(fs, STAGING, "/persistent");
  await syncFileSystem(module);

  clearTree(fs, ROLLBACK);
  if (pathExists(fs, STAGING)) fs.rmdir(STAGING);
  if (pathExists(fs, ROLLBACK)) fs.rmdir(ROLLBACK);
  if (pathExists(fs, JOURNAL)) fs.unlink(JOURNAL);
  await syncFileSystem(module);
  return manifest;
}

export async function clearLocalSaves(module: OpenRct2Module): Promise<void> {
  clearTree(module.FS, "/persistent");
  await syncFileSystem(module);
}
