import { describe, expect, it } from "vitest";
import { ENGINE_COMMIT } from "../src/engine-utils";
import { validateSchoolParkLibraryManifest } from "../src/school-park-library";
import { createSchoolParkFixture } from "./helpers/school-park-fixture";

describe("school park manifest validation", () => {
  it("accepts one exact, ordered 57-park same-origin identity", async () => {
    const { manifest } = await createSchoolParkFixture();
    const validated = validateSchoolParkLibraryManifest(manifest, manifest.libraryVersion, "https://school.example");
    expect(validated.parks).toHaveLength(57);
    expect(validated.engineCommit).toBe(ENGINE_COMMIT);
    expect(validated.bundle.url).toBe(`https://school.example${manifest.bundle.url}`);
  });

  it.each([
    ["cross-origin bundle", (manifest: Record<string, any>) => { manifest.bundle.url = "https://attacker.example/licensed/library.zip"; }],
    ["wrong park count", (manifest: Record<string, any>) => { manifest.parks.pop(); }],
    ["duplicate ID", (manifest: Record<string, any>) => { manifest.parks[1].id = manifest.parks[0].id; }],
    ["traversal basename", (manifest: Record<string, any>) => { manifest.parks[0].sourceBasename = "../escape"; }],
    ["wrong engine", (manifest: Record<string, any>) => { manifest.engineCommit = "0".repeat(40); }],
    ["gapped order", (manifest: Record<string, any>) => { manifest.parks[56].order = 99; }],
  ])("rejects %s", async (_label, mutate) => {
    const fixture = await createSchoolParkFixture();
    const candidate = structuredClone(fixture.manifest) as unknown as Record<string, any>;
    mutate(candidate);
    expect(() => validateSchoolParkLibraryManifest(candidate, fixture.manifest.libraryVersion, "https://school.example")).toThrow();
  });
});
