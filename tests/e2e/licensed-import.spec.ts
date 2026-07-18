import { expect, test } from "@playwright/test";
import { access } from "node:fs/promises";

const licensedZipPath = process.env.PLAYWRIGHT_REAL_RCT_ZIP_PATH;

test("a separately supplied licensed school ZIP imports and opens the real game", async ({ page }, testInfo) => {
  test.skip(!licensedZipPath, "Set PLAYWRIGHT_REAL_RCT_ZIP_PATH for the authorized local import proof.");
  if (!licensedZipPath) return;
  await access(licensedZipPath);
  test.setTimeout(15 * 60_000);

  const browserLog: string[] = [];
  page.on("console", (message) => {
    const entry = `[${message.type()}] ${message.text()}`;
    browserLog.push(entry);
  });
  page.on("pageerror", (error) => browserLog.push(`[pageerror] ${error.message}`));

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/?e2e=licensed-import");
  await page.getByRole("combobox", { name: "Performance mode" }).selectOption("lite");
  await page.locator("#rct-file-input").setInputFiles(licensedZipPath);

  await expect(page.locator("#asset-status")).toHaveText("Stored privately", { timeout: 12 * 60_000 });
  await expect(page.getByRole("alert")).toBeHidden();
  const importReceipt = await page.evaluate(() => JSON.parse(localStorage.getItem("parkworks.rctImport") ?? "null"));
  expect(importReceipt).toMatchObject({ fileCount: expect.any(Number), sourceBytes: expect.any(Number) });
  expect(importReceipt.fileCount).toBeGreaterThan(2_000);

  await page.getByRole("button", { name: /Open the park/ }).click();
  await expect(page.locator("#game-shell")).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("#canvas")).toBeVisible();
  await page.waitForTimeout(5_000);
  const runtimeState = await page.evaluate(() => {
    const source = document.querySelector<HTMLCanvasElement>("#canvas");
    const module = window.__parkworksModule;
    return {
      canvas: source
        ? { clientHeight: source.clientHeight, clientWidth: source.clientWidth, height: source.height, width: source.width }
        : null,
      licensedDataMounted: Boolean(module?.FS.analyzePath("/RCT/Data/g1.dat").exists),
    };
  });
  const startupError = await page.getByRole("alert").isVisible()
    ? await page.getByRole("alert").textContent()
    : null;
  if (startupError) throw new Error(`OpenRCT2 startup error: ${startupError}\n${browserLog.join("\n")}`);
  expect(runtimeState.licensedDataMounted).toBe(true);
  expect(runtimeState.canvas?.clientWidth).toBeGreaterThan(0);
  expect(runtimeState.canvas?.clientHeight).toBeGreaterThan(0);

  // The page does not place a launcher overlay above the game. Exercise the
  // native OpenRCT2 pause button directly on the canvas, then resume it.
  await page.locator("#canvas").click({ position: { x: 14, y: 13 } });
  await page.waitForTimeout(500);
  await page.locator("#canvas").click({ position: { x: 14, y: 13 } });

  const screenshot = testInfo.outputPath("licensed-game-playable.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach("licensed-game-playable", { path: screenshot, contentType: "image/png" });
  expect(browserLog.some((message) => message.includes("FATAL") || message.startsWith("[pageerror]"))).toBe(false);

  await testInfo.attach("licensed-import-receipt", {
    body: Buffer.from(JSON.stringify({ fileCount: importReceipt.fileCount, sourceBytes: importReceipt.sourceBytes, runtimeState }, null, 2)),
    contentType: "application/json",
  });
  await testInfo.attach("licensed-browser-log", {
    body: Buffer.from(browserLog.join("\n")),
    contentType: "text/plain",
  });
});
