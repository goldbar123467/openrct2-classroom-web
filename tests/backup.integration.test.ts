import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  createSaveBackup,
  importSaveBackup,
  recoverInterruptedRestore,
} from "../src/backup";
import { MAX_BACKUP_BYTES } from "../src/engine-utils";
import { createFileLike, createMemoryModule, MemoryFs } from "./helpers/memory-fs";

function readBytes(fs: MemoryFs, path: string): number[] {
  const value = fs.readFile(path);
  if (typeof value === "string") throw new Error(`Expected binary file at ${path}`);
  return [...value];
}

describe("save backup transaction", () => {
  it("exports checksummed files and restores them atomically", async () => {
    const module = createMemoryModule();
    const fs = module.FS as MemoryFs;
    fs.mkdir("/persistent/saves");
    fs.writeFile("/persistent/saves/lesson-one.park", new Uint8Array([1, 2, 3, 4]));
    fs.writeFile("/persistent/config.ini", "currency=USD");

    const artifact = await createSaveBackup(module);
    expect(artifact.fileName).toMatch(/^parkworks-saves-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(artifact.manifest.files.map((record) => record.path)).toEqual([
      "persistent/config.ini",
      "persistent/saves/lesson-one.park",
    ]);
    expect(artifact.manifest.files.every((record) => /^[a-f0-9]{64}$/.test(record.sha256))).toBe(true);

    fs.writeFile("/persistent/saves/lesson-one.park", new Uint8Array([9, 9]));
    fs.writeFile("/persistent/remove-me.tmp", new Uint8Array([8]));
    const backupBytes = new Uint8Array(await artifact.blob.arrayBuffer());
    const restored = await importSaveBackup(module, createFileLike(artifact.fileName, backupBytes));

    expect(restored.files).toEqual(artifact.manifest.files);
    expect(readBytes(fs, "/persistent/saves/lesson-one.park")).toEqual([1, 2, 3, 4]);
    expect(fs.readFile("/persistent/config.ini", { encoding: "utf8" })).toBe("currency=USD");
    expect(fs.analyzePath("/persistent/remove-me.tmp").exists).toBe(false);
    expect(fs.analyzePath("/persistent/.restore-journal.json").exists).toBe(false);
    expect(fs.syncCalls.length).toBeGreaterThanOrEqual(4);
  });

  it("rejects a checksum-tampered backup before changing current saves", async () => {
    const module = createMemoryModule();
    const fs = module.FS as MemoryFs;
    fs.writeFile("/persistent/current.park", new Uint8Array([4, 5, 6]));
    const artifact = await createSaveBackup(module);
    const zip = await JSZip.loadAsync(await artifact.blob.arrayBuffer());
    zip.file("persistent/current.park", new Uint8Array([0, 0, 0]));
    const tampered = await zip.generateAsync({ type: "uint8array" });

    await expect(importSaveBackup(module, createFileLike("tampered.zip", tampered))).rejects.toThrow(
      "Backup verification failed",
    );
    expect(readBytes(fs, "/persistent/current.park")).toEqual([4, 5, 6]);
  });

  it("rejects unsafe manifests, corrupt archives, and oversized inputs", async () => {
    const module = createMemoryModule();
    const unsafe = new JSZip();
    unsafe.file(
      "parkworks-manifest.json",
      JSON.stringify({
        format: "parkworks-openrct2-save-backup",
        version: 1,
        engineVersion: "test",
        createdAt: new Date(0).toISOString(),
        files: [{ path: "persistent/../escape.park", size: 1, sha256: "0".repeat(64) }],
      }),
    );
    unsafe.file("persistent/../escape.park", new Uint8Array([1]));
    const unsafeBytes = await unsafe.generateAsync({ type: "uint8array" });

    await expect(importSaveBackup(module, createFileLike("unsafe.zip", unsafeBytes))).rejects.toThrow(
      /unsafe|invalid file record/i,
    );
    await expect(importSaveBackup(module, createFileLike("corrupt.zip", new Uint8Array([1, 2, 3])))).rejects.toThrow();
    await expect(
      importSaveBackup(module, createFileLike("oversized.zip", new Uint8Array(), MAX_BACKUP_BYTES + 1)),
    ).rejects.toThrow("larger than the 250 MB safety limit");
  });

  it("rolls back an interrupted restore journal", async () => {
    const module = createMemoryModule();
    const fs = module.FS as MemoryFs;
    fs.writeFile("/persistent/current.park", new Uint8Array([9]));
    fs.mkdir("/persistent/.restore-staging");
    fs.mkdir("/persistent/.restore-rollback");
    fs.writeFile("/persistent/.restore-staging/incoming.park", new Uint8Array([2]));
    fs.writeFile("/persistent/.restore-rollback/original.park", new Uint8Array([1]));
    fs.writeFile("/persistent/.restore-journal.json", JSON.stringify({ state: "swapping" }));

    await expect(recoverInterruptedRestore(module)).resolves.toBe(true);
    expect(readBytes(fs, "/persistent/original.park")).toEqual([1]);
    expect(fs.analyzePath("/persistent/current.park").exists).toBe(false);
    expect(fs.analyzePath("/persistent/incoming.park").exists).toBe(false);
    expect(fs.analyzePath("/persistent/.restore-journal.json").exists).toBe(false);
  });
});
