import JSZip from "jszip";
import { ENGINE_COMMIT, sha256 } from "../../src/engine-utils";
import type { SchoolParkLibraryManifest } from "../../src/school-park-library";

export interface SchoolParkFixture {
  manifest: SchoolParkLibraryManifest;
  manifestBytes: Uint8Array;
  bundleBytes: Uint8Array;
  snapshots: Map<string, Uint8Array>;
}

export async function createSchoolParkFixture(version = "school-parks-test.1", salt = "a"): Promise<SchoolParkFixture> {
  const zip = new JSZip();
  const snapshots = new Map<string, Uint8Array>();
  const parks = [];
  for (let order = 0; order < 57; order += 1) {
    const id = order === 0 ? "electric-fields" : order === 1 ? "six-flags-magic-mountain" : `test-park-${order}`;
    const sourceBasename = order === 0 ? "Electric Fields" : order === 1 ? "Six Flags Magic Mountain" : `Test Park ${order}`;
    const snapshotPath = `${sourceBasename}.park`;
    const bytes = new TextEncoder().encode(`PARK fixture ${salt} ${order.toString().padStart(2, "0")} verified snapshot`);
    snapshots.set(snapshotPath, bytes);
    zip.file(snapshotPath, bytes);
    parks.push({
      id,
      title: sourceBasename,
      sourceBasename,
      sourceSha256: await sha256(new TextEncoder().encode(`source ${order}`)),
      sourceBytes: 1000 + order,
      snapshotPath,
      snapshotSha256: await sha256(bytes),
      snapshotBytes: bytes.byteLength,
      category: "fixture",
      order,
    });
  }
  const bundleBytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  const manifest: SchoolParkLibraryManifest = {
    schemaVersion: 1,
    libraryVersion: version,
    engineCommit: ENGINE_COMMIT,
    bundle: {
      url: `/licensed/park-library-${version}.zip`,
      sha256: await sha256(bundleBytes),
      bytes: bundleBytes.byteLength,
    },
    parks,
  };
  return {
    manifest,
    manifestBytes: new TextEncoder().encode(JSON.stringify(manifest)),
    bundleBytes,
    snapshots,
  };
}
