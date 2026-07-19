import type { SchoolParkLibraryManifest } from "./school-park-library";

export type GameLaunchTarget = { kind: "main-menu" } | { kind: "school-park"; parkId: string };

export const GAME_STARTUP_ARGUMENTS = [
  "--user-data-path=/persistent/",
  "--openrct2-data-path=/OpenRCT2/",
  "--rct2-data-path=/RCT/",
] as const;

export function buildGameStartupArguments(
  target: GameLaunchTarget,
  manifest: SchoolParkLibraryManifest | null,
): string[] {
  if (target.kind === "main-menu") return [...GAME_STARTUP_ARGUMENTS];
  if (!manifest) throw new Error("The verified school park library is not installed.");
  const park = manifest.parks.find((candidate) => candidate.id === target.parkId);
  if (!park) throw new Error("That school park is not part of the verified library.");
  return [`/RCT/ParkworksLibrary/${park.sourceBasename}.park`, ...GAME_STARTUP_ARGUMENTS];
}

export function resolveGameLaunchTarget(search: string, manifest: SchoolParkLibraryManifest | null): GameLaunchTarget {
  const parkId = new URLSearchParams(search).get("park");
  if (!parkId) return { kind: "main-menu" };
  if (!manifest?.parks.some((park) => park.id === parkId)) {
    throw new Error("The park link is not present in the verified school library.");
  }
  return { kind: "school-park", parkId };
}
