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
      ]),
    );
  });
});
