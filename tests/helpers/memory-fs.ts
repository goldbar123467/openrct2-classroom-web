import type { OpenRct2Fs, OpenRct2Module } from "../../src/openrct2";

const DIRECTORY_MODE = 0o040000;
const FILE_MODE = 0o100000;

interface MemoryNode {
  data?: Uint8Array | string;
  directory: boolean;
}

function normalize(path: string): string {
  const normalized = `/${path}`.replaceAll("//", "/").replace(/\/$/, "");
  return normalized || "/";
}

function parentOf(path: string): string {
  const normalized = normalize(path);
  if (normalized === "/") return "/";
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

export class MemoryFs implements OpenRct2Fs {
  readonly filesystems = { IDBFS: {} };
  readonly syncCalls: boolean[] = [];
  private readonly nodes = new Map<string, MemoryNode>([["/", { directory: true }]]);

  analyzePath(path: string): { exists: boolean } {
    return { exists: this.nodes.has(normalize(path)) };
  }

  isDir(mode: number): boolean {
    return (mode & 0o170000) === DIRECTORY_MODE;
  }

  mkdir(path: string): void {
    const target = normalize(path);
    this.requireDirectory(parentOf(target));
    if (this.nodes.has(target)) throw new Error(`Path already exists: ${target}`);
    this.nodes.set(target, { directory: true });
  }

  mount(): void {
    // IDBFS persistence is represented by syncfs in this deterministic test double.
  }

  readFile(path: string, options?: { encoding?: "utf8" }): Uint8Array | string {
    const node = this.requireFile(path);
    const value = node.data ?? new Uint8Array();
    if (options?.encoding === "utf8") {
      return typeof value === "string" ? value : new TextDecoder().decode(value);
    }
    return typeof value === "string" ? value : value.slice();
  }

  readdir(path: string): string[] {
    const directory = normalize(path);
    this.requireDirectory(directory);
    const prefix = directory === "/" ? "/" : `${directory}/`;
    const names = new Set<string>();
    for (const candidate of this.nodes.keys()) {
      if (candidate === directory || !candidate.startsWith(prefix)) continue;
      const relative = candidate.slice(prefix.length);
      const name = relative.split("/")[0];
      if (name) names.add(name);
    }
    return [".", "..", ...[...names].sort()];
  }

  rename(oldPath: string, newPath: string): void {
    const source = normalize(oldPath);
    const destination = normalize(newPath);
    const node = this.requireNode(source);
    this.requireDirectory(parentOf(destination));
    if (this.nodes.has(destination)) throw new Error(`Destination exists: ${destination}`);

    const moves = [...this.nodes.entries()]
      .filter(([path]) => path === source || path.startsWith(`${source}/`))
      .sort(([left], [right]) => left.length - right.length);
    for (const [path] of moves) this.nodes.delete(path);
    for (const [path, value] of moves) {
      const suffix = path.slice(source.length);
      this.nodes.set(`${destination}${suffix}`, value);
    }
    if (moves.length === 0) this.nodes.set(destination, node);
  }

  rmdir(path: string): void {
    const target = normalize(path);
    this.requireDirectory(target);
    if (target === "/") throw new Error("Cannot remove root");
    if (this.readdir(target).some((name) => name !== "." && name !== "..")) {
      throw new Error(`Directory is not empty: ${target}`);
    }
    this.nodes.delete(target);
  }

  stat(path: string): { mode: number; size: number } {
    const node = this.requireNode(path);
    const data = node.data;
    const size = typeof data === "string" ? new TextEncoder().encode(data).byteLength : data?.byteLength ?? 0;
    return { mode: node.directory ? DIRECTORY_MODE : FILE_MODE, size };
  }

  syncfs(populate: boolean, callback: (error?: unknown) => void): void {
    this.syncCalls.push(populate);
    queueMicrotask(() => callback());
  }

  unlink(path: string): void {
    const target = normalize(path);
    this.requireFile(target);
    this.nodes.delete(target);
  }

  writeFile(path: string, data: Uint8Array | string): void {
    const target = normalize(path);
    this.requireDirectory(parentOf(target));
    this.nodes.set(target, { data: typeof data === "string" ? data : data.slice(), directory: false });
  }

  private requireDirectory(path: string): MemoryNode {
    const node = this.requireNode(path);
    if (!node.directory) throw new Error(`Not a directory: ${normalize(path)}`);
    return node;
  }

  private requireFile(path: string): MemoryNode {
    const node = this.requireNode(path);
    if (node.directory) throw new Error(`Not a file: ${normalize(path)}`);
    return node;
  }

  private requireNode(path: string): MemoryNode {
    const target = normalize(path);
    const node = this.nodes.get(target);
    if (!node) throw new Error(`Path does not exist: ${target}`);
    return node;
  }
}

export function createMemoryModule(): OpenRct2Module {
  const fs = new MemoryFs();
  for (const directory of ["/persistent", "/RCT", "/RCT-staging", "/OpenRCT2"]) fs.mkdir(directory);
  return {
    FS: fs,
    callMain: () => 0,
    canvas: { focus: () => undefined, hidden: true } as unknown as HTMLCanvasElement,
  };
}

export function createFileLike(name: string, bytes: Uint8Array, declaredSize = bytes.byteLength): File {
  const file = bytes.slice() as Uint8Array & { name: string; size: number };
  Object.defineProperties(file, {
    name: { value: name },
    size: { value: declaredSize },
  });
  return file as unknown as File;
}
