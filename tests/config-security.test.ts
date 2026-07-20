import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config";

type HeaderValue = string | number | string[] | undefined;

describe("production security configuration", () => {
  it("keeps local and Vercel security headers identical", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
    const vercelHeaders = Object.fromEntries(
      vercel.headers[0].headers.map(({ key, value }: { key: string; value: string }) => [key, value]),
    ) as Record<string, string>;
    const localHeaders = viteConfig.server?.headers as Record<string, HeaderValue>;
    const previewHeaders = viteConfig.preview?.headers as Record<string, HeaderValue>;

    expect(localHeaders).toEqual(previewHeaders);
    for (const [key, value] of Object.entries(vercelHeaders)) expect(localHeaders[key]).toBe(value);
    expect(localHeaders["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(localHeaders["Cross-Origin-Embedder-Policy"]).toBe("require-corp");
    expect(localHeaders["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(localHeaders["Permissions-Policy"]).toContain("camera=()");
  });

  it("forces service-worker revalidation and immutable versioned engine caching", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(vercel.headers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "/engine/(.*)",
          headers: expect.arrayContaining([
            { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          ]),
        }),
        expect.objectContaining({
          source: "/(sw.js|manifest.webmanifest)",
          headers: expect.arrayContaining([
            { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          ]),
        }),
        expect.objectContaining({
          source: "/licensed/(.*)",
          headers: expect.arrayContaining([{ key: "Cache-Control", value: "private, no-store" }]),
        }),
      ]),
    );
  });

  it("keeps every school route password-gated and licensed bytes private", () => {
    const caddy = readFileSync("deploy/Caddyfile", "utf8");
    expect(caddy).toContain("route {");
    expect(caddy).toContain('respond /healthz "ok" 200');
    expect(caddy).toContain("basic_auth {");
    expect(caddy).toContain("handle_path /licensed/*");
    expect(caddy).toContain('Cache-Control "private, no-store, max-age=0"');
    expect(caddy.indexOf('respond /healthz "ok" 200')).toBeLessThan(caddy.indexOf("basic_auth {"));
    expect(caddy.indexOf("basic_auth {")).toBeLessThan(caddy.indexOf("handle_path /licensed/*"));
  });

  it("keeps passwords and private asset coordinates out of client configuration", () => {
    const source = readFileSync("src/main.ts", "utf8");
    expect(source).toContain("VITE_SCHOOL_ASSET_URL");
    expect(source).toContain("VITE_SCHOOL_ASSET_VERSION");
    expect(source).not.toMatch(/VITE_.*(?:PASSWORD|SECRET|TOKEN|HASH|PRIVATE_PATH)/);
    expect(source).not.toContain("IMSAWEST");
  });

  it("starts OpenRCT2 with the imported licensed-data directory", () => {
    const source = readFileSync("src/openrct2.ts", "utf8");
    const gameLaunch = readFileSync("src/game-launch.ts", "utf8");
    const launcher = readFileSync("src/main.ts", "utf8");
    expect(gameLaunch).toContain('"--openrct2-data-path=/OpenRCT2/"');
    expect(gameLaunch).toContain('"--rct2-data-path=/RCT/"');
    expect(gameLaunch).toContain('`/RCT/ParkworksLibrary/${park.sourceBasename}.park`');
    expect(source).not.toContain("SCHOOL_MAGIC_MOUNTAIN_SC6_PATH");
    expect(source).not.toContain("installSchoolScenarioPatch");
    expect(launcher).toContain('id="play-button-label">Open main menu');
    expect(launcher).not.toContain('id="magic-mountain-button"');
    expect(launcher).toContain("resolveGameLaunchTarget");
    expect(launcher).toContain("ensureSchoolParkLibrary");
  });

  it("patches the native title-menu callback to fail closed on missing verified snapshots", () => {
    const patch = readFileSync("scripts/engine-lite.patch", "utf8");
    const rebuild = readFileSync("scripts/rebuild-engine.ps1", "utf8");
    expect(patch).toContain("WindowTitleMenuScenarioselectCallback");
    expect(patch).toContain('Path::Combine(kParkworksLibraryRoot, sourceBasename + ".park")');
    expect(patch).toContain("if (!File::Exists(snapshotPath))");
    expect(patch).toContain("LoadParkFromFile(snapshotPath, false, false)");
    expect(patch).toContain("return;");
    expect(rebuild).toContain("git checkout --quiet --detach __COMMIT__");
    expect(rebuild).not.toContain("git checkout --quiet --detach FETCH_HEAD");
  });

  it("installs the native school sandbox policy without embedding licensed assets", () => {
    const source = readFileSync("src/openrct2.ts", "utf8");
    expect(source).toContain("park.cash = 1000000000");
    expect(source).toContain('park.setFlag("noMoney", true)');
    expect(source).toContain("cheats.sandboxMode = true");
    expect(source).toContain("cheats.ignoreResearchStatus = true");
    expect(source).toContain("cheats.enableAllDrawableTrackPieces = true");
    expect(source).toContain('park.setFlag("unlockAllPrices", true)');
    expect(source).toContain("PARKWORKS_SCHOOL_SANDBOX_READY");
    expect(source).toContain("context.paused = false");
    expect(source).not.toContain('context.subscribe("interval.tick"');
    expect(source).toContain("park.research.funding = 0");
    expect(source).not.toContain('park.setFlag("forbidLandscapeChanges"');
    expect(source).not.toContain("research.inventedItems");
    expect(source).not.toContain("research.uninventedItems");
    expect(source).toContain('type: "intransient"');
  });

  it("builds engine requests from the credential-free browser origin", () => {
    const source = readFileSync("src/openrct2.ts", "utf8");
    expect(source).toContain("window.location.origin");
    expect(source).toContain('script.src = engineAssetUrl("openrct2.js")');
    expect(source).toContain('mainScriptUrlOrBlob: engineAssetUrl("openrct2.js")');
    expect(source).toContain("locateFile: (fileName) => engineAssetUrl(fileName)");
  });

  it("matches the OpenRCT2 drawing buffer to the browser viewport before startup", () => {
    const source = readFileSync("src/openrct2.ts", "utf8");
    const launcher = readFileSync("src/main.ts", "utf8");
    const styles = readFileSync("src/style.css", "utf8");
    expect(source).toContain("module.canvas.getBoundingClientRect()");
    expect(source).toContain('upsertGeneralSetting(configured, "window_width", String(viewport.width))');
    expect(source).toContain('upsertGeneralSetting(configured, "window_height", String(viewport.height))');
    expect(source).toContain("module.canvas.width = viewport.width");
    expect(source).toContain("module.canvas.height = viewport.height");
    expect(styles).toContain("width: max(100vw, 640px)");
    expect(styles).toContain("height: max(100vh, 480px)");
    expect(launcher).toContain('<canvas id="canvas"');
    expect(source).toContain('querySelector<HTMLCanvasElement>("#canvas")');
    expect(launcher).not.toContain('id="game-canvas"');
  });
});
