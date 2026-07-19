import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureSchoolParkLibrary,
  migrateLegacyMagicMountainSnapshot,
  recoverSchoolParkLibraryTransaction,
} from "../src/school-park-library";
import { createMemoryModule, MemoryFs } from "./helpers/memory-fs";
import { createSchoolParkFixture, type SchoolParkFixture } from "./helpers/school-park-fixture";

function stubFixtureFetch(fixture: SchoolParkFixture): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const bytes = url.endsWith(".json") ? fixture.manifestBytes : fixture.bundleBytes;
    expect(init).toMatchObject({ credentials: "same-origin", cache: "no-store", redirect: "error" });
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Response(body, { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("atomic protected school park installation", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { location: { origin: "https://school.example" } });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("installs and revalidates exactly 57 PARK snapshots through staging", async () => {
    const module = createMemoryModule();
    const fixture = await createSchoolParkFixture();
    const fetchMock = stubFixtureFetch(fixture);
    const installed = await ensureSchoolParkLibrary(module, "/licensed/manifest.json", fixture.manifest.libraryVersion);
    const fs = module.FS as MemoryFs;
    expect(installed.manifest.parks).toHaveLength(57);
    expect(fs.readdir("/RCT/ParkworksLibrary").filter((name) => name.endsWith(".park"))).toHaveLength(57);
    expect(fs.analyzePath("/RCT/ParkworksLibraryStaging").exists).toBe(false);
    await ensureSchoolParkLibrary(module, "/licensed/manifest.json", fixture.manifest.libraryVersion);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rolls a failed post-swap sync back to the prior verified library", async () => {
    const module = createMemoryModule();
    const fs = module.FS as MemoryFs;
    const oldFixture = await createSchoolParkFixture("school-parks-old", "old");
    stubFixtureFetch(oldFixture);
    await ensureSchoolParkLibrary(module, "/licensed/old.json", oldFixture.manifest.libraryVersion);
    const oldMarker = fs.readFile("/RCT/ParkworksLibrary/.parkworks-library.json", { encoding: "utf8" });

    const nextFixture = await createSchoolParkFixture("school-parks-next", "next");
    stubFixtureFetch(nextFixture);
    fs.failSyncCall(fs.syncCalls.length + 2);
    await expect(ensureSchoolParkLibrary(module, "/licensed/next.json", nextFixture.manifest.libraryVersion)).rejects.toThrow("Injected sync failure");
    expect(fs.readFile("/RCT/ParkworksLibrary/.parkworks-library.json", { encoding: "utf8" })).toBe(oldMarker);
    expect(fs.analyzePath("/RCT/ParkworksLibraryPrevious").exists).toBe(false);
    expect(fs.analyzePath("/RCT/.parkworks-library-journal.json").exists).toBe(false);
  });

  it("leaves no partial active library when the first post-swap commit is interrupted", async () => {
    const module = createMemoryModule();
    const fs = module.FS as MemoryFs;
    const fixture = await createSchoolParkFixture("school-parks-first", "first");
    stubFixtureFetch(fixture);
    fs.failSyncCall(2);
    await expect(ensureSchoolParkLibrary(module, "/licensed/first.json", fixture.manifest.libraryVersion)).rejects.toThrow("Injected sync failure");
    expect(fs.analyzePath("/RCT/ParkworksLibrary").exists).toBe(false);
    expect(fs.analyzePath("/RCT/ParkworksLibraryStaging").exists).toBe(false);
    expect(fs.analyzePath("/RCT/.parkworks-library-journal.json").exists).toBe(false);
  });

  it("rejects a truncated bundle before staging and preserves the active library", async () => {
    const module = createMemoryModule();
    const fs = module.FS as MemoryFs;
    const oldFixture = await createSchoolParkFixture("school-parks-stable", "stable");
    stubFixtureFetch(oldFixture);
    await ensureSchoolParkLibrary(module, "/licensed/stable.json", oldFixture.manifest.libraryVersion);
    const oldMarker = fs.readFile("/RCT/ParkworksLibrary/.parkworks-library.json", { encoding: "utf8" });

    const nextFixture = await createSchoolParkFixture("school-parks-truncated", "truncated");
    const truncated = nextFixture.bundleBytes.subarray(0, nextFixture.bundleBytes.byteLength - 7);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const bytes = String(input).endsWith(".json") ? nextFixture.manifestBytes : truncated;
      return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { status: 200 });
    }));
    await expect(ensureSchoolParkLibrary(module, "/licensed/truncated.json", nextFixture.manifest.libraryVersion)).rejects.toThrow("bundle identity");
    expect(fs.readFile("/RCT/ParkworksLibrary/.parkworks-library.json", { encoding: "utf8" })).toBe(oldMarker);
    expect(fs.analyzePath("/RCT/ParkworksLibraryStaging").exists).toBe(false);
  });

  it("removes only the exact system-owned legacy Magic snapshot", async () => {
    const module = createMemoryModule();
    const fs = module.FS as MemoryFs;
    const fixture = await createSchoolParkFixture();
    const magic = fixture.manifest.parks.find((park) => park.id === "six-flags-magic-mountain")!;
    fs.mkdir("/persistent/save");
    fs.writeFile("/RCT/.parkworks-magic-mountain-patch", "owned");
    fs.writeFile("/persistent/save/Six Flags Magic Mountain Browser Sandbox.park", fixture.snapshots.get(magic.snapshotPath)!);
    expect(await migrateLegacyMagicMountainSnapshot(module, fixture.manifest)).toBe(true);
    expect(fs.analyzePath("/persistent/save/Six Flags Magic Mountain Browser Sandbox.park").exists).toBe(false);

    fs.writeFile("/RCT/.parkworks-magic-mountain-patch", "owned");
    fs.writeFile("/persistent/save/Six Flags Magic Mountain Browser Sandbox.park", new TextEncoder().encode("PARK student data must survive"));
    expect(await migrateLegacyMagicMountainSnapshot(module, fixture.manifest)).toBe(false);
    expect(fs.analyzePath("/persistent/save/Six Flags Magic Mountain Browser Sandbox.park").exists).toBe(true);
  });

  it("recovers an interrupted swap from the immutable previous directory", async () => {
    const module = createMemoryModule();
    const fs = module.FS as MemoryFs;
    fs.mkdir("/RCT/ParkworksLibrary");
    fs.writeFile("/RCT/ParkworksLibrary/new.park", "PARK new");
    fs.mkdir("/RCT/ParkworksLibraryPrevious");
    fs.writeFile("/RCT/ParkworksLibraryPrevious/old.park", "PARK old");
    fs.writeFile("/RCT/.parkworks-library-journal.json", JSON.stringify({ state: "swapping", hadActive: true }));
    expect(await recoverSchoolParkLibraryTransaction(module)).toBe(true);
    expect(fs.analyzePath("/RCT/ParkworksLibrary/old.park").exists).toBe(true);
    expect(fs.analyzePath("/RCT/ParkworksLibrary/new.park").exists).toBe(false);
  });
});
