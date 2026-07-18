import { describe, expect, it } from "vitest";
import {
  choosePerformanceProfile,
  findRctRoot,
  formatBytes,
  isExpectedRctStructure,
  isOfflineEngineReady,
  isSafeBackupPath,
  safeRelativeZipPath,
} from "../src/engine-utils";

describe("performance profile selection", () => {
  it("defaults unknown and 4 GB devices to the lite profile", () => {
    expect(choosePerformanceProfile({}).id).toBe("lite");
    expect(choosePerformanceProfile({ deviceMemory: 4, hardwareConcurrency: 8 }).id).toBe("lite");
  });

  it("uses balanced and smooth only when the hardware supports them", () => {
    expect(choosePerformanceProfile({ deviceMemory: 8, hardwareConcurrency: 6 }).id).toBe("balanced");
    expect(choosePerformanceProfile({ deviceMemory: 8, hardwareConcurrency: 8 }).id).toBe("smooth");
    expect(choosePerformanceProfile({ deviceMemory: 16, hardwareConcurrency: 12, saveData: true }).id).toBe("lite");
  });
});

describe("RCT2 archive inspection", () => {
  it("accepts a direct installation root", () => {
    const paths = ["Data/ch.dat", "Data/g1.dat", "ObjData/RIDE.DAT"];
    expect(findRctRoot(paths)).toBe("");
    expect(isExpectedRctStructure(paths)).toBe(true);
  });

  it("accepts a single containing directory", () => {
    const paths = ["RollerCoaster Tycoon 2/Data/ch.dat", "RollerCoaster Tycoon 2/ObjData/RIDE.DAT"];
    expect(findRctRoot(paths)).toBe("RollerCoaster Tycoon 2/");
  });

  it("rejects unrelated or traversal paths", () => {
    expect(findRctRoot(["photos/ch.dat"])).toBeNull();
    expect(safeRelativeZipPath("RCT/../secret.txt", "RCT/")).toBeNull();
    expect(safeRelativeZipPath("RCT/Data/ch.dat", "RCT/")).toBe("Data/ch.dat");
  });
});

describe("backup path validation", () => {
  it("allows only files below the persistent folder", () => {
    expect(isSafeBackupPath("persistent/save/park.park")).toBe(true);
    expect(isSafeBackupPath("persistent/../engine.js")).toBe(false);
    expect(isSafeBackupPath("RCT/Data/ch.dat")).toBe(false);
  });
});

describe("formatBytes", () => {
  it("formats storage values for the launcher", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
  });
});

describe("offline engine readiness", () => {
  it("requires executable files plus either the archive or installed open assets", () => {
    expect(isOfflineEngineReady(true, true, true, false)).toBe(true);
    expect(isOfflineEngineReady(true, true, false, true)).toBe(true);
    expect(isOfflineEngineReady(true, true, false, false)).toBe(false);
    expect(isOfflineEngineReady(false, true, true, true)).toBe(false);
  });
});
