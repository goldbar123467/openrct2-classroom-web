import { describe, expect, it } from "vitest";
import { buildGameStartupArguments, GAME_STARTUP_ARGUMENTS, resolveGameLaunchTarget } from "../src/game-launch";
import { createSchoolParkFixture } from "./helpers/school-park-fixture";

describe("native game launch targets", () => {
  it("keeps the normal OpenRCT2 title menu as the default", () => {
    expect(resolveGameLaunchTarget("", null)).toEqual({ kind: "main-menu" });
    expect(buildGameStartupArguments({ kind: "main-menu" }, null)).toEqual(GAME_STARTUP_ARGUMENTS);
  });

  it("maps only verified deep links to exact native park snapshots", async () => {
    const { manifest } = await createSchoolParkFixture();
    expect(resolveGameLaunchTarget("?park=electric-fields", manifest)).toEqual({
      kind: "school-park",
      parkId: "electric-fields",
    });
    expect(buildGameStartupArguments({ kind: "school-park", parkId: "electric-fields" }, manifest)[0])
      .toBe("/RCT/ParkworksLibrary/Electric Fields.park");
    expect(() => resolveGameLaunchTarget("?park=not-licensed", manifest)).toThrow("not present");
    expect(() => buildGameStartupArguments({ kind: "school-park", parkId: "not-licensed" }, manifest)).toThrow("not part");
  });
});
