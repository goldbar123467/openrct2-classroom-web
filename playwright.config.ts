import { defineConfig, devices } from "@playwright/test";

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, "");
if (externalBaseURL && new URL(externalBaseURL).protocol !== "https:") {
  throw new Error("PLAYWRIGHT_BASE_URL must use HTTPS for an external production probe.");
}
const localPort = Number.parseInt(process.env.PLAYWRIGHT_LOCAL_PORT ?? "4173", 10);
if (!Number.isInteger(localPort) || localPort < 1024 || localPort > 65535) {
  throw new Error("PLAYWRIGHT_LOCAL_PORT must be an integer from 1024 through 65535.");
}
const localBaseURL = `http://127.0.0.1:${localPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: externalBaseURL ?? localBaseURL,
    locale: "en-US",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
    viewport: { width: 1366, height: 768 },
  },
  webServer: externalBaseURL
    ? undefined
    : {
        command: `npm run preview -- --host 127.0.0.1 --port ${localPort} --strictPort`,
        reuseExistingServer: !process.env.CI && !process.env.PLAYWRIGHT_LOCAL_PORT,
        timeout: 60_000,
        url: localBaseURL,
      },
});
