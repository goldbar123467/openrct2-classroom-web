import { defineConfig, devices } from "@playwright/test";

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, "");
if (externalBaseURL && new URL(externalBaseURL).protocol !== "https:") {
  throw new Error("PLAYWRIGHT_BASE_URL must use HTTPS for an external production probe.");
}

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
    baseURL: externalBaseURL ?? "http://127.0.0.1:4173",
    locale: "en-US",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
    viewport: { width: 1366, height: 768 },
  },
  webServer: externalBaseURL
    ? undefined
    : {
        command: "npm run preview -- --host 127.0.0.1 --port 4173",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        url: "http://127.0.0.1:4173",
      },
});
