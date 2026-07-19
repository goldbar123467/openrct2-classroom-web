import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { chromium } from "@playwright/test";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const baseUrl = new URL(args.get("--base-url") ?? "http://127.0.0.1:4173/");
const upstreamUrl = new URL(args.get("--upstream-url") ?? "http://127.0.0.1:4173/");
const baseArchivePath = resolve(args.get("--base-archive") ?? "");
const libraryManifestPath = resolve(args.get("--library-manifest") ?? "");
const privateOutputRoot = resolve(args.get("--private-output-root") ?? "");
const projectRoot = resolve(args.get("--project-root") ?? process.cwd());
if (baseUrl.hostname !== "127.0.0.1" && baseUrl.hostname !== "localhost") throw new Error("Browser matrix must use the isolated local release server.");
if (upstreamUrl.hostname !== "127.0.0.1" && upstreamUrl.hostname !== "localhost") throw new Error("Browser matrix upstream must be local.");
for (const [label, path] of [["manifest", libraryManifestPath], ["output", privateOutputRoot]]) {
  const projectRelative = relative(projectRoot, path);
  if (!projectRelative.startsWith("..") || isAbsolute(projectRelative)) throw new Error(`${label} must remain outside the Git workspace.`);
}

const manifest = JSON.parse(await readFile(libraryManifestPath, "utf8"));
if (manifest.schemaVersion !== 1 || manifest.parks?.length !== 57) throw new Error("Protected browser manifest must contain exactly 57 parks.");
const pilotParks = args.has("--pilot-parks") ? Number.parseInt(args.get("--pilot-parks"), 10) : null;
if (pilotParks !== null && (!Number.isInteger(pilotParks) || pilotParks < 1 || pilotParks > 57)) throw new Error("--pilot-parks must be from 1 through 57.");
const smokeParks = pilotParks === null ? manifest.parks : manifest.parks.slice(0, pilotParks);
const libraryBundlePath = resolve(dirname(libraryManifestPath), basename(new URL(manifest.bundle.url, baseUrl).pathname));
const baseArchiveName = basename(baseArchivePath);
const manifestName = basename(libraryManifestPath);
const libraryBundleName = basename(libraryBundlePath);
const runRoot = resolve(privateOutputRoot, `${pilotParks === null ? "browser-matrix" : "browser-pilot"}-${Date.now()}`);
await mkdir(runRoot, { recursive: false });
const profileRoot = resolve(runRoot, "chromium-profile");
if (relative(runRoot, profileRoot) !== "chromium-profile") throw new Error("Disposable browser profile escaped its private run root.");
const receiptsPath = resolve(runRoot, "browser-receipts.jsonl");
const writeReceipt = async (receipt) => {
  const handle = await open(receiptsPath, "a", 0o600);
  try { await handle.writeFile(`${JSON.stringify(receipt)}\n`); } finally { await handle.close(); }
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const licensedFiles = new Map([
  [baseArchiveName, { path: baseArchivePath, type: "application/zip" }],
  [manifestName, { path: libraryManifestPath, type: "application/json" }],
  [libraryBundleName, { path: libraryBundlePath, type: "application/zip" }],
]);
const gateway = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", baseUrl);
    if (requestUrl.pathname.startsWith("/licensed/")) {
      const licensed = licensedFiles.get(basename(requestUrl.pathname));
      if (!licensed || (request.method !== "GET" && request.method !== "HEAD")) {
        response.writeHead(404, { "Cache-Control": "private, no-store" });
        response.end();
        return;
      }
      const info = await stat(licensed.path);
      response.writeHead(200, {
        "Content-Type": licensed.type,
        "Content-Length": String(info.size),
        "Cache-Control": "private, no-store, max-age=0",
        "Cross-Origin-Resource-Policy": "same-origin",
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(licensed.path).pipe(response);
      return;
    }
    const proxyRequest = httpRequest(new URL(requestUrl.pathname + requestUrl.search, upstreamUrl), {
      method: request.method,
      headers: { ...request.headers, host: upstreamUrl.host },
    }, (proxyResponse) => {
      response.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
      proxyResponse.pipe(response);
    });
    proxyRequest.on("error", (error) => response.destroy(error));
    request.pipe(proxyRequest);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
    response.end(error instanceof Error ? error.message : String(error));
  }
});
await new Promise((resolveListen, rejectListen) => {
  gateway.once("error", rejectListen);
  gateway.listen(Number(baseUrl.port), baseUrl.hostname, resolveListen);
});

let context;
let page;
async function openBrowserSession() {
  await rm(profileRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
  context = await chromium.launchPersistentContext(profileRoot, {
    headless: true,
    viewport: { width: 1366, height: 768 },
    locale: "en-US",
    serviceWorkers: "block",
  });
  page = context.pages()[0] ?? await context.newPage();
}
async function closeBrowserSession() {
  if (context) await context.close();
  context = undefined;
  page = undefined;
  await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  await rm(profileRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}
try {
  for (const park of smokeParks) {
    const startedAt = new Date().toISOString();
    await openBrowserSession();
    const failures = [];
    const onPageError = (error) => failures.push(`pageerror:${error.message}`);
    const onConsole = (message) => {
      if (/FATAL|OpenRCT2 startup failed|unhandled/i.test(message.text())) failures.push(`console:${message.text()}`);
    };
    page.on("pageerror", onPageError);
    page.on("console", onConsole);
    const startedMs = Date.now();
    let receipt;
    try {
      await page.goto(new URL(`?park=${encodeURIComponent(park.id)}`, baseUrl).href, { waitUntil: "domcontentloaded", timeout: 60_000 });
      if (!await page.evaluate(() => window.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined")) throw new Error("Browser isolation is unavailable.");
      await page.locator("#play-button").click();
      await page.waitForFunction(() => window.__parkworksSandboxReady === true, undefined, { timeout: 20 * 60_000 });
      const state = await page.evaluate(() => {
        const canvas = document.querySelector("#canvas");
        return {
          canvas: canvas instanceof HTMLCanvasElement ? { width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight } : null,
          module: Boolean(window.__parkworksModule),
          sandbox: window.__parkworksSandboxReady === true,
        };
      });
      if (!state.module || !state.sandbox || !state.canvas || state.canvas.width < 640 || state.canvas.height < 480 || state.canvas.clientWidth < 640 || state.canvas.clientHeight < 480) {
        throw new Error(`Invalid runtime state: ${JSON.stringify(state)}`);
      }
      await page.locator("#canvas").click({ position: { x: Math.floor(state.canvas.clientWidth / 2), y: Math.floor(state.canvas.clientHeight / 2) } });
      await page.waitForTimeout(500);
      if (failures.length) throw new Error(failures.join(" | "));
      receipt = { schemaVersion: 1, phase: "smoke", status: "pass", parkId: park.id, order: park.order, startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - startedMs, state };
    } catch (error) {
      receipt = { schemaVersion: 1, phase: "smoke", status: "failure", parkId: park.id, order: park.order, startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - startedMs, failure: error instanceof Error ? error.message : String(error) };
      await writeReceipt(receipt);
      throw error;
    } finally {
      page.off("pageerror", onPageError);
      page.off("console", onConsole);
      await closeBrowserSession();
    }
    await writeReceipt(receipt);
  }

  const mandatory = ["electric-fields", "six-flags-magic-mountain"];
  const additional = manifest.parks.map((park) => park.id).filter((id) => !mandatory.includes(id));
  const deepIds = pilotParks === null ? [...mandatory, additional[0], additional.at(-1)] : [];
  if (pilotParks === null && (deepIds.some((id) => !id) || new Set(deepIds).size !== 4)) throw new Error("Could not choose four distinct deep-play parks.");
  for (const parkId of deepIds) {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    await openBrowserSession();
    try {
      await page.goto(new URL(`?park=${encodeURIComponent(parkId)}`, baseUrl).href, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.locator("#play-button").click();
      await page.waitForFunction(() => window.__parkworksSandboxReady === true, undefined, { timeout: 20 * 60_000 });
      const frameHashes = [];
      for (let sample = 0; sample < 5; sample += 1) {
        frameHashes.push(sha256(await page.locator("#canvas").screenshot()));
        if (sample < 4) await page.waitForTimeout(15_000);
      }
      if (new Set(frameHashes).size < 2) throw new Error(`Deep-play canvas did not visibly advance for ${parkId}.`);
      await writeReceipt({ schemaVersion: 1, phase: "deep-play-60s", status: "pass", parkId, startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - startedMs, samples: frameHashes.length, distinctFrameHashes: new Set(frameHashes).size });
    } catch (error) {
      await writeReceipt({ schemaVersion: 1, phase: "deep-play-60s", status: "failure", parkId, startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - startedMs, failure: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      await closeBrowserSession();
    }
  }
} finally {
  if (context) await context.close();
  await new Promise((resolveClose, rejectClose) => gateway.close((error) => error ? rejectClose(error) : resolveClose()));
}

const receiptBytes = await readFile(receiptsPath);
console.log(JSON.stringify({ status: "pass", mode: pilotParks === null ? "release" : "pilot", smokeParks: smokeParks.length, deepPlayParks: pilotParks === null ? 4 : 0, receiptsPath, receiptsSha256: sha256(receiptBytes) }, null, 2));
