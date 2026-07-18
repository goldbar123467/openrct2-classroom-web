import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("offline shell", () => {
  it("only precaches files that exist in public", () => {
    const source = readFileSync(resolve("public/sw.js"), "utf8");
    const declaration = source.match(/const SHELL_URLS = \[(.*?)\];/);
    expect(declaration).not.toBeNull();

    const urls = [...(declaration?.[1]?.matchAll(/"([^\"]+)"/g) ?? [])].flatMap((match) =>
      match[1] ? [match[1]] : [],
    );
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      if (url === "/") continue;
      expect(existsSync(resolve("public", url.slice(1))), `${url} must exist`).toBe(true);
    }
  });

  it("uses the manifest icon in the offline shell", () => {
    const manifest = JSON.parse(readFileSync(resolve("public/manifest.webmanifest"), "utf8")) as {
      icons: Array<{ src: string }>;
    };
    const source = readFileSync(resolve("public/sw.js"), "utf8");
    expect(source).toContain(manifest.icons[0]?.src);
  });
});
