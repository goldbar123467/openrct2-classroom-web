export const ENGINE_COMMIT = "9de2d43fb6e7d6a6213336125a4afbddf8cc167c";
export const ENGINE_VERSION = "v0.5.3-49-g9de2d43fb6";
export const MAX_RCT_ZIP_BYTES = 1_250_000_000;
export const MAX_RCT_ENTRIES = 12_000;
export const MAX_RCT_UNCOMPRESSED_BYTES = 1_600_000_000;
export const MAX_BACKUP_BYTES = 250_000_000;
export const MAX_BACKUP_ENTRIES = 1_000;
export const MAX_BACKUP_UNCOMPRESSED_BYTES = 500_000_000;

export type PerformanceProfileId = "lite" | "balanced" | "smooth";

export interface PerformanceProfile {
  id: PerformanceProfileId;
  label: string;
  description: string;
  memoryMiB: number;
  workers: number;
}

export interface DeviceHints {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  saveData?: boolean;
}

const profiles: Record<PerformanceProfileId, PerformanceProfile> = {
  lite: {
    id: "lite",
    label: "Classroom lite",
    description: "Best for 4 GB Chromebooks and larger parks.",
    memoryMiB: 512,
    workers: 2,
  },
  balanced: {
    id: "balanced",
    label: "Balanced",
    description: "For 8 GB Chromebooks with four or more CPU cores.",
    memoryMiB: 768,
    workers: 3,
  },
  smooth: {
    id: "smooth",
    label: "Smooth motion",
    description: "For newer 8+ GB devices; uses more battery and memory.",
    memoryMiB: 1024,
    workers: 4,
  },
};

export function choosePerformanceProfile(hints: DeviceHints): PerformanceProfile {
  const memory = hints.deviceMemory ?? 4;
  const cores = hints.hardwareConcurrency ?? 4;

  if (hints.saveData || memory <= 4 || cores <= 4) return profiles.lite;
  if (memory >= 8 && cores >= 8) return profiles.smooth;
  return profiles.balanced;
}

export function getPerformanceProfile(id: PerformanceProfileId): PerformanceProfile {
  return profiles[id];
}

export function listPerformanceProfiles(): PerformanceProfile[] {
  return [profiles.lite, profiles.balanced, profiles.smooth];
}

export function normalizeZipPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function findRctRoot(paths: string[]): string | null {
  for (const originalPath of paths) {
    const path = normalizeZipPath(originalPath);
    const lower = path.toLowerCase();
    const marker = "data/ch.dat";
    const markerIndex = lower.lastIndexOf(marker);
    if (markerIndex >= 0 && markerIndex + marker.length === lower.length) {
      return path.slice(0, markerIndex);
    }
  }
  return null;
}

export function safeRelativeZipPath(originalPath: string, prefix: string): string | null {
  const path = normalizeZipPath(originalPath);
  if (!path.startsWith(prefix)) return null;
  const relative = path.slice(prefix.length).replace(/^\/+/, "");
  if (!relative || relative.includes("\0")) return null;

  const parts = relative.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) return null;
  return parts.join("/");
}

export function isExpectedRctStructure(paths: string[]): boolean {
  const root = findRctRoot(paths);
  if (root === null) return false;
  const normalized = new Set(paths.map((path) => normalizeZipPath(path).toLowerCase()));
  return normalized.has(`${root}data/ch.dat`.toLowerCase());
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function isOfflineEngineReady(
  scriptCached: boolean,
  wasmCached: boolean,
  archiveCached: boolean,
  openAssetsInstalled: boolean,
): boolean {
  return scriptCached && wasmCached && (archiveCached || openAssetsInstalled);
}

export async function sha256(data: Uint8Array): Promise<string> {
  const view = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", view);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isSafeBackupPath(path: string): boolean {
  const normalized = normalizeZipPath(path);
  if (!normalized.startsWith("persistent/") || normalized.endsWith("/")) return false;
  const relative = normalized.slice("persistent/".length);
  return safeRelativeZipPath(relative, "") !== null;
}
