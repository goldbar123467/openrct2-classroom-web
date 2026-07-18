import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_RCT_ZIP_BYTES } from "../src/engine-utils";
import {
  SCHOOL_SANDBOX_PLUGIN,
  clearRctData,
  hasRctData,
  importRctArchive,
  installSchoolSandboxPlugin,
  walkFiles,
  type ProgressReporter,
} from "../src/openrct2";
import { createFileLike, createMemoryModule, MemoryFs } from "./helpers/memory-fs";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

async function createSyntheticRctZip(extra?: (zip: JSZip) => void): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("RollerCoaster Tycoon 2/Data/ch.dat", new Uint8Array([1, 2, 3]));
  zip.file("RollerCoaster Tycoon 2/Data/g1.dat", new Uint8Array([4]));
  zip.file("RollerCoaster Tycoon 2/ObjData/SYNTHETIC.DAT", new Uint8Array([5, 6]));
  extra?.(zip);
  return zip.generateAsync({ type: "uint8array" });
}

describe("licensed RCT2 archive transaction", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorage());
    vi.stubGlobal("navigator", {
      storage: {
        estimate: async () => ({ quota: 4_000_000_000, usage: 0 }),
        persist: async () => true,
      },
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("installs a valid synthetic structure through staging and removes it on request", async () => {
    const module = createMemoryModule();
    const fs = module.FS as MemoryFs;
    const bytes = await createSyntheticRctZip();
    const reporter = vi.fn<ProgressReporter>();

    await importRctArchive(module, createFileLike("owned-rct2.zip", bytes), reporter);

    expect(hasRctData(module)).toBe(true);
    expect([...fs.readFile("/RCT/Data/ch.dat") as Uint8Array]).toEqual([1, 2, 3]);
    expect(fs.analyzePath("/RCT/ObjData/SYNTHETIC.DAT").exists).toBe(true);
    expect(walkFiles(fs, "/RCT-staging")).toEqual([]);
    expect(localStorage.getItem("parkworks.rctImport")).toContain('"fileCount":3');
    expect(reporter.mock.calls.some(([update]) => update.phase === "game-assets")).toBe(true);

    await clearRctData(module);
    expect(hasRctData(module)).toBe(false);
    expect(localStorage.getItem("parkworks.rctImport")).toBeNull();
  });

  it("installs the school sandbox as an idempotent OpenRCT2 user plugin", async () => {
    const module = createMemoryModule();
    const fs = module.FS as MemoryFs;

    await installSchoolSandboxPlugin(module);

    expect(fs.readFile("/persistent/plugin/parkworks-school-sandbox.js", { encoding: "utf8" }))
      .toBe(SCHOOL_SANDBOX_PLUGIN);
    expect(SCHOOL_SANDBOX_PLUGIN).toContain("schoolSandboxDelayTicks = 200");
    expect(SCHOOL_SANDBOX_PLUGIN).toContain("schoolSandboxStep += 1");
    expect(fs.syncCalls).toEqual([false]);

    await installSchoolSandboxPlugin(module);
    expect(fs.syncCalls).toEqual([false]);
  });

  it("contains traversal-like names inside the private RCT mount", async () => {
    const module = createMemoryModule();
    const fs = module.FS as MemoryFs;
    const bytes = await createSyntheticRctZip((zip) => {
      zip.file("RollerCoaster Tycoon 2/Data\\..\\escape.dat", new Uint8Array([9]));
      zip.file("RollerCoaster Tycoon 2/../../outside.dat", new Uint8Array([8]));
    });

    await importRctArchive(module, createFileLike("paths.zip", bytes), () => undefined);

    expect(fs.analyzePath("/escape.dat").exists).toBe(false);
    expect(fs.analyzePath("/outside.dat").exists).toBe(false);
    expect(walkFiles(fs, "/RCT").every((path) => path.startsWith("/RCT/"))).toBe(true);
  });

  it("rejects missing markers, declared oversize, and insufficient quota without replacing current data", async () => {
    const module = createMemoryModule();
    const fs = module.FS as MemoryFs;
    fs.mkdir("/RCT/Data");
    fs.writeFile("/RCT/Data/ch.dat", new Uint8Array([7]));
    const unrelated = new JSZip();
    unrelated.file("photos/readme.txt", "not a game install");
    const unrelatedBytes = await unrelated.generateAsync({ type: "uint8array" });

    await expect(
      importRctArchive(module, createFileLike("unrelated.zip", unrelatedBytes), () => undefined),
    ).rejects.toThrow("RCT2 data was not found");
    await expect(
      importRctArchive(
        module,
        createFileLike("oversized.zip", new Uint8Array(), MAX_RCT_ZIP_BYTES + 1),
        () => undefined,
      ),
    ).rejects.toThrow("larger than the 1.25 GB classroom safety limit");

    vi.stubGlobal("navigator", {
      storage: { estimate: async () => ({ quota: 100, usage: 95 }), persist: async () => true },
    });
    const validBytes = await createSyntheticRctZip();
    await expect(
      importRctArchive(module, createFileLike("no-space.zip", validBytes), () => undefined),
    ).rejects.toThrow("not have enough free browser storage");
    expect([...fs.readFile("/RCT/Data/ch.dat") as Uint8Array]).toEqual([7]);
  });

  it("cancels into an empty staging area while preserving the installed copy", async () => {
    const module = createMemoryModule();
    const fs = module.FS as MemoryFs;
    fs.mkdir("/RCT/Data");
    fs.writeFile("/RCT/Data/ch.dat", new Uint8Array([7]));
    fs.writeFile("/RCT-staging/partial.dat", new Uint8Array([6]));
    const bytes = await createSyntheticRctZip();
    const controller = new AbortController();
    controller.abort();

    await expect(
      importRctArchive(module, createFileLike("cancel.zip", bytes), () => undefined, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect([...fs.readFile("/RCT/Data/ch.dat") as Uint8Array]).toEqual([7]);
    expect(walkFiles(fs, "/RCT-staging")).toEqual([]);
  });
});
