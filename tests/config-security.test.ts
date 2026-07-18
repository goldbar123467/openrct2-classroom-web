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

  it("keeps passwords and private asset coordinates out of client configuration", () => {
    const source = readFileSync("src/main.ts", "utf8");
    expect(source).toContain("VITE_SCHOOL_ASSET_URL");
    expect(source).toContain("VITE_SCHOOL_ASSET_VERSION");
    expect(source).not.toMatch(/VITE_.*(?:PASSWORD|SECRET|TOKEN|HASH|PRIVATE_PATH)/);
    expect(source).not.toContain("IMSAWEST");
  });

  it("starts OpenRCT2 with the imported licensed-data directory", () => {
    const source = readFileSync("src/openrct2.ts", "utf8");
    expect(source).toContain('"--openrct2-data-path=/OpenRCT2/"');
    expect(source).toContain('"--rct2-data-path=/RCT/"');
    expect(source).toContain("module.callMain([...GAME_STARTUP_ARGUMENTS])");
    expect(source).not.toContain("chooseStartupScenario");
    expect(source).not.toContain('"/RCT/Scenarios"');
  });

  it("installs the native school sandbox policy without embedding licensed assets", () => {
    const source = readFileSync("src/openrct2.ts", "utf8");
    expect(source).toContain('park.setFlag("noMoney", true)');
    expect(source).toContain("cheats.sandboxMode = true");
    expect(source).toContain("cheats.ignoreResearchStatus = true");
    expect(source).toContain("park.research.funding = 0");
    expect(source).not.toContain("research.inventedItems");
    expect(source).not.toContain("research.uninventedItems");
    expect(source).toContain('scenario.objective.type = "haveFun"');
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
