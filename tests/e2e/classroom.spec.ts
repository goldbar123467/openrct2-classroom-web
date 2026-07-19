import AxeBuilder from "@axe-core/playwright";
import { chromium, expect, test, type Page } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function bootLiteEngineInPersistentProfile(page: Page, baseURL: string, marker: string) {
  await page.goto(new URL(`/?e2e=${marker}`, baseURL).href);
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return registration?.active?.state ?? registration?.installing?.state ?? registration?.waiting?.state ?? "missing";
        }),
      { timeout: 120_000, intervals: [250, 500, 1_000, 2_000] },
    )
    .toBe("activated");
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload();
  await page.getByRole("combobox", { name: "Performance mode" }).selectOption("lite");
  await page.getByRole("button", { name: /Open main menu/ }).click();
  await expect(page.getByRole("alert")).toContainText("Add your RCT2 or RCT Classic ZIP before opening the park", { timeout: 90_000 });
  await expect(page.locator("#offline-status")).toHaveText("Launcher + engine ready");
}

test("launcher is accessible, keyboard-operable, and stable at 200%", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/?e2e=accessibility");
  await expect(page.getByRole("heading", { name: /Your park runs on this Chromebook/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Download school game files/ })).toBeHidden();

  const desktopScreenshot = testInfo.outputPath("launcher-1366x768.png");
  await page.screenshot({ path: desktopScreenshot, fullPage: true });
  await testInfo.attach("launcher-1366x768", { path: desktopScreenshot, contentType: "image/png" });

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);

  const helpButton = page.getByRole("button", { name: "How to play" });
  await helpButton.focus();
  expect(await helpButton.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog").getByRole("heading", { name: "From empty field to first ride" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 683, height: 384 });
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  await expect(page.getByRole("button", { name: "Remove game files" })).toBeAttached();
  const zoomScreenshot = testInfo.outputPath("launcher-effective-200-percent.png");
  await page.screenshot({ path: zoomScreenshot, fullPage: true });
  await testInfo.attach("launcher-effective-200-percent", { path: zoomScreenshot, contentType: "image/png" });

  const shellPerformance = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
    return {
      navigation: navigation
        ? {
            responseStartMs: navigation.responseStart,
            domContentLoadedMs: navigation.domContentLoadedEventEnd,
            loadMs: navigation.loadEventEnd,
            transferBytes: navigation.transferSize,
          }
        : null,
      deviceMemoryGiB: navigatorWithMemory.deviceMemory ?? null,
      hardwareConcurrency: navigator.hardwareConcurrency,
      crossOriginIsolated,
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
  await testInfo.attach("shell-performance", {
    body: Buffer.from(JSON.stringify(shellPerformance, null, 2)),
    contentType: "application/json",
  });
  expect(consoleErrors).toEqual([]);
});

test("production-shaped shell boots Lite engine, persists a save, and reloads offline", async ({ baseURL, context, page }, testInfo) => {
  if (!baseURL) throw new Error("Playwright baseURL is required for the classroom flow.");
  const expectedOrigin = new URL(baseURL).origin;
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const requestOrigins = new Set<string>();
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText ?? "unknown"}`));
  page.on("request", (request) => requestOrigins.add(new URL(request.url()).origin));

  const response = await page.request.get("/");
  expect(response.status()).toBe(200);
  const expectedBuildCommit = process.env.EXPECTED_BUILD_COMMIT;
  if (expectedBuildCommit) {
    expect(await response.text()).toContain(`<meta name="parkworks-commit" content="${expectedBuildCommit}" />`);
  }
  expect(response.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(response.headers()["cross-origin-embedder-policy"]).toBe("require-corp");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");

  await page.goto("/?e2e=engine-first-load");
  await page.evaluate(async () => navigator.serviceWorker.ready.then(() => true));
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload();
  }
  await expect(page.locator("#offline-status")).toContainText("Launcher ready");
  await page.getByRole("combobox", { name: "Performance mode" }).selectOption("lite");
  const engineBootStarted = Date.now();
  await page.getByRole("button", { name: /Open main menu/ }).click();

  await expect(page.getByRole("alert")).toContainText("Add your RCT2 or RCT Classic ZIP before opening the park", { timeout: 90_000 });
  await expect(page.locator("#worker-value")).toHaveText("2");
  await expect(page.locator("#storage-status")).toContainText(/MB of|GB of|Available|Persistent/);
  await expect(page.locator("#offline-status")).toHaveText("Launcher + engine ready");
  const engineBootMilliseconds = Date.now() - engineBootStarted;
  expect([...requestOrigins]).toEqual([expectedOrigin]);
  expect(consoleErrors).toEqual([]);

  await page.evaluate(async () => {
    const module = (window as unknown as {
      __parkworksModule?: {
        FS: {
          writeFile(path: string, data: Uint8Array): void;
          syncfs(populate: boolean, callback: (error?: unknown) => void): void;
        };
      };
    }).__parkworksModule;
    if (!module) throw new Error("OpenRCT2 module was not exposed after initialization.");
    module.FS.writeFile("/persistent/e2e-persistence.park", new Uint8Array([80, 65, 82, 75, 1, 2, 3, 4]));
    await new Promise<void>((resolve, reject) => module.FS.syncfs(false, (error) => (error ? reject(error) : resolve())));
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export save backup" }).click();
  const backupDownload = await downloadPromise;
  expect(backupDownload.suggestedFilename()).toMatch(/^parkworks-saves-\d{4}-\d{2}-\d{2}\.zip$/);
  const backupPath = await backupDownload.path();
  if (!backupPath) throw new Error("Playwright could not retain the downloaded save backup.");

  await page.reload();
  await page.getByRole("combobox", { name: "Performance mode" }).selectOption("lite");
  await page.getByRole("button", { name: /Open main menu/ }).click();
  await expect(page.getByRole("alert")).toContainText("Add your RCT2 or RCT Classic ZIP before opening the park", { timeout: 90_000 });
  const restoredSave = await page.evaluate(() => {
    const module = (window as unknown as {
      __parkworksModule?: {
        FS: {
          readFile(path: string): Uint8Array;
          unlink(path: string): void;
          syncfs(populate: boolean, callback: (error?: unknown) => void): void;
        };
      };
    }).__parkworksModule;
    if (!module) throw new Error("OpenRCT2 module was not exposed after warm initialization.");
    return [...module.FS.readFile("/persistent/e2e-persistence.park")];
  });
  expect(restoredSave).toEqual([80, 65, 82, 75, 1, 2, 3, 4]);

  await page.getByRole("button", { name: "Erase local saves" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Erase local saves" }).click();
  await expect(page.getByText("All local park saves were erased.")).toBeVisible();
  expect(
    await page.evaluate(() => {
      const module = (window as unknown as {
        __parkworksModule: { FS: { analyzePath(path: string): { exists: boolean } } };
      }).__parkworksModule;
      return module.FS.analyzePath("/persistent/e2e-persistence.park").exists;
    }),
  ).toBe(false);

  await page.locator("#backup-file-input").setInputFiles({
    name: backupDownload.suggestedFilename(),
    mimeType: "application/zip",
    buffer: await readFile(backupPath),
  });
  await page.getByRole("dialog").getByRole("button", { name: "Verify and restore" }).click();
  await expect(page.getByText(/Restored \d+ verified files/)).toBeVisible();
  expect(
    await page.evaluate(() => {
      const module = (window as unknown as {
        __parkworksModule: { FS: { readFile(path: string): Uint8Array } };
      }).__parkworksModule;
      return [...module.FS.readFile("/persistent/e2e-persistence.park")];
    }),
  ).toEqual([80, 65, 82, 75, 1, 2, 3, 4]);

  await page.evaluate(async () => {
    const module = (window as unknown as {
      __parkworksModule: {
        FS: {
          unlink(path: string): void;
          syncfs(populate: boolean, callback: (error?: unknown) => void): void;
        };
      };
    }).__parkworksModule;
    module.FS.unlink("/persistent/e2e-persistence.park");
    await new Promise<void>((resolve, reject) => module.FS.syncfs(false, (error) => (error ? reject(error) : resolve())));
  });

  const cacheSnapshot = await page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const entries = await Promise.all(
      cacheNames.map(async (cacheName) => {
        const cache = await caches.open(cacheName);
        return Promise.all(
          (await cache.keys()).map(async (request) => {
            const response = await cache.match(request);
            return {
              cacheName,
              url: request.url,
              status: response?.status ?? 0,
              contentType: response?.headers.get("content-type") ?? "",
            };
          }),
        );
      }),
    );
    return {
      controller: navigator.serviceWorker.controller?.scriptURL ?? null,
      entries: entries.flat(),
    };
  });
  expect(cacheSnapshot.controller).toBe(`${expectedOrigin}/sw.js`);
  expect(cacheSnapshot.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ url: expect.stringMatching(/\/assets\/.*\.js$/), status: 200 }),
      expect.objectContaining({ url: expect.stringMatching(/\/assets\/.*\.css$/), status: 200 }),
    ]),
  );

  await testInfo.attach("lite-engine-performance", {
    body: Buffer.from(
      JSON.stringify(
        {
          engineBootMilliseconds,
          workerCount: 2,
          wasmInitialMemoryMiB: 512,
          sameOriginRequests: [...requestOrigins],
          cachedResponses: cacheSnapshot.entries.length,
        },
        null,
        2,
      ),
    ),
    contentType: "application/json",
  });

  await context.setOffline(true);
  await page.reload({ timeout: 30_000, waitUntil: "domcontentloaded" });
  const offlineState = await page.evaluate(async () => ({
    controller: navigator.serviceWorker.controller?.scriptURL ?? null,
    cacheNames: await caches.keys(),
    crossOriginIsolated,
  }));
  await expect(page.getByRole("heading", { name: /Your park runs on this Chromebook/ }), {
    message: `Offline launcher failed. State: ${JSON.stringify(offlineState)} Cache: ${JSON.stringify(cacheSnapshot)} Console: ${consoleErrors.join(" | ")} Requests: ${failedRequests.join(" | ")}`,
  }).toBeVisible();
  await expect(page.locator("#network-indicator")).toContainText("Offline-ready");
  await context.setOffline(false);
});

test("an app-cache update preserves IDBFS saves and clears only the legacy release cache", async ({ page }) => {
  await page.goto("/?e2e=app-update-before");
  await page.evaluate(async () => navigator.serviceWorker.ready.then(() => true));
  await page.getByRole("combobox", { name: "Performance mode" }).selectOption("lite");
  await page.getByRole("button", { name: /Open main menu/ }).click();
  await expect(page.getByRole("alert")).toContainText("Add your RCT2 or RCT Classic ZIP before opening the park", { timeout: 90_000 });

  await page.evaluate(async () => {
    const module = (window as unknown as {
      __parkworksModule?: {
        FS: {
          writeFile(path: string, data: Uint8Array): void;
          syncfs(populate: boolean, callback: (error?: unknown) => void): void;
        };
      };
    }).__parkworksModule;
    if (!module) throw new Error("OpenRCT2 module was not exposed before the update simulation.");
    module.FS.writeFile("/persistent/e2e-update.park", new Uint8Array([85, 80, 68, 65, 84, 69, 7]));
    await new Promise<void>((resolve, reject) => module.FS.syncfs(false, (error) => (error ? reject(error) : resolve())));
    localStorage.setItem("parkworks-e2e-update-marker", "before-update");
    const legacy = await caches.open("parkworks-v6-9de2d43fb6-classroom2");
    await legacy.put("/legacy-release-marker", new Response("legacy"));
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration || !(await registration.unregister())) throw new Error("Could not retire the previous app worker.");
  });

  await page.reload();
  await page.evaluate(async () => navigator.serviceWorker.ready.then(() => true));
  await expect
    .poll(() => page.evaluate(async () => !(await caches.keys()).includes("parkworks-v6-9de2d43fb6-classroom2")))
    .toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("parkworks-e2e-update-marker"))).toBe("before-update");

  await page.getByRole("combobox", { name: "Performance mode" }).selectOption("lite");
  await page.getByRole("button", { name: /Open main menu/ }).click();
  await expect(page.getByRole("alert")).toContainText("Add your RCT2 or RCT Classic ZIP before opening the park", { timeout: 90_000 });
  expect(
    await page.evaluate(() => {
      const module = (window as unknown as {
        __parkworksModule?: {
          FS: {
            readFile(path: string): Uint8Array;
            unlink(path: string): void;
            syncfs(populate: boolean, callback: (error?: unknown) => void): void;
          };
        };
      }).__parkworksModule;
      if (!module) throw new Error("OpenRCT2 module was not exposed after the update simulation.");
      return [...module.FS.readFile("/persistent/e2e-update.park")];
    }),
  ).toEqual([85, 80, 68, 65, 84, 69, 7]);

  await page.evaluate(async () => {
    const module = (window as unknown as {
      __parkworksModule: {
        FS: {
          unlink(path: string): void;
          syncfs(populate: boolean, callback: (error?: unknown) => void): void;
        };
      };
    }).__parkworksModule;
    module.FS.unlink("/persistent/e2e-update.park");
    await new Promise<void>((resolve, reject) => module.FS.syncfs(false, (error) => (error ? reject(error) : resolve())));
    localStorage.removeItem("parkworks-e2e-update-marker");
  });
});

test("a closed browser profile reopens its IDBFS save and boots the cached engine offline", async ({ baseURL }) => {
  test.setTimeout(360_000);
  if (!baseURL) throw new Error("Playwright baseURL is required for the persistent-profile flow.");
  // Keep this path short: Chromium's CacheStorage descendants can exceed the
  // legacy Windows path limit when nested under Playwright's long test slug.
  const profileDirectory = await mkdtemp(join(tmpdir(), "parkworks-e2e-"));
  const savePath = "/persistent/e2e-browser-restart.park";
  const saveBytes = [80, 65, 82, 75, 82, 69, 83, 84, 65, 82, 84, 1, 2, 3];

  try {
    const firstContext = await chromium.launchPersistentContext(profileDirectory, {
      headless: true,
      locale: "en-US",
      viewport: { width: 1366, height: 768 },
    });
    try {
      const page = firstContext.pages()[0] ?? (await firstContext.newPage());
      await bootLiteEngineInPersistentProfile(page, baseURL, "persistent-profile-first-process");
      await page.evaluate(
        async ({ path, bytes }) => {
          const module = (window as unknown as {
            __parkworksModule?: {
              FS: {
                writeFile(filePath: string, data: Uint8Array): void;
                syncfs(populate: boolean, callback: (error?: unknown) => void): void;
              };
            };
          }).__parkworksModule;
          if (!module) throw new Error("OpenRCT2 module was not exposed in the first browser process.");
          module.FS.writeFile(path, new Uint8Array(bytes));
          await new Promise<void>((resolve, reject) =>
            module.FS.syncfs(false, (error) => (error ? reject(error) : resolve())),
          );
        },
        { path: savePath, bytes: saveBytes },
      );
    } finally {
      await firstContext.close();
    }

    const secondContext = await chromium.launchPersistentContext(profileDirectory, {
      headless: true,
      locale: "en-US",
      viewport: { width: 1366, height: 768 },
    });
    try {
      const onlinePage = secondContext.pages()[0] ?? (await secondContext.newPage());
      await bootLiteEngineInPersistentProfile(onlinePage, baseURL, "persistent-profile-second-process");
      expect(
        await onlinePage.evaluate((path) => {
          const module = (window as unknown as {
            __parkworksModule?: { FS: { readFile(filePath: string): Uint8Array } };
          }).__parkworksModule;
          if (!module) throw new Error("OpenRCT2 module was not exposed after browser relaunch.");
          return [...module.FS.readFile(path)];
        }, savePath),
      ).toEqual(saveBytes);

      await onlinePage.close();
      await secondContext.setOffline(true);
      const offlinePage = await secondContext.newPage();
      await bootLiteEngineInPersistentProfile(offlinePage, baseURL, "persistent-profile-offline-engine");
      await expect(offlinePage.locator("#network-indicator")).toContainText("Offline-ready");
      expect(
        await offlinePage.evaluate((path) => {
          const module = (window as unknown as {
            __parkworksModule?: { FS: { readFile(filePath: string): Uint8Array } };
          }).__parkworksModule;
          if (!module) throw new Error("Cached OpenRCT2 engine did not boot offline.");
          return [...module.FS.readFile(path)];
        }, savePath),
      ).toEqual(saveBytes);
    } finally {
      await secondContext.close();
    }
  } finally {
    await rm(profileDirectory, { recursive: true, force: true });
  }
});
