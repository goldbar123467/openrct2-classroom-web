import "./style.css";
import {
  clearLocalSaves,
  exportSaveBackup,
  getStorageStatus,
  importSaveBackup,
  recoverInterruptedRestore,
  requestPersistentStorage,
} from "./backup";
import {
  ENGINE_COMMIT,
  ENGINE_VERSION,
  choosePerformanceProfile,
  formatBytes,
  getPerformanceProfile,
  listPerformanceProfiles,
  type PerformanceProfile,
  type PerformanceProfileId,
} from "./engine-utils";
import {
  clearRctData,
  hasRctData,
  importRctArchive,
  initializeOpenRct2,
  isGameStarted,
  setGamePaused,
  startGame,
  type OpenRct2Module,
  type ProgressUpdate,
} from "./openrct2";

interface NavigatorWithHints extends Navigator {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
}

const hintedNavigator = navigator as NavigatorWithHints;
const detectedProfile = choosePerformanceProfile({
  deviceMemory: hintedNavigator.deviceMemory,
  hardwareConcurrency: navigator.hardwareConcurrency,
  saveData: hintedNavigator.connection?.saveData,
});
const savedProfile = localStorage.getItem("parkworks.performance") as PerformanceProfileId | null;
let selectedProfile: PerformanceProfile = savedProfile
  ? getPerformanceProfile(savedProfile)
  : detectedProfile;
let moduleInstance: OpenRct2Module | null = null;
let initializePromise: Promise<OpenRct2Module> | null = null;
let importController: AbortController | null = null;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Parkworks could not find its application root.");

app.innerHTML = `
  <div class="site-shell" id="launcher-shell">
    <header class="topbar">
      <a class="wordmark" href="/" aria-label="Parkworks home">
        <span class="wordmark-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span><strong>Parkworks</strong><small>OpenRCT2 classroom</small></span>
      </a>
      <div class="topbar-actions">
        <span class="network-indicator" id="network-indicator"><i aria-hidden="true"></i><span>Online</span></span>
        <button class="text-button" type="button" data-dialog="help-dialog">How to play</button>
        <button class="text-button" type="button" data-dialog="legal-dialog">About & legal</button>
      </div>
    </header>

    <main id="main-content" class="workbench">
      <section class="setup-board" aria-labelledby="setup-title">
        <div class="board-kicker"><span>Ride permit</span><b>No. 02–WEB</b></div>
        <h1 id="setup-title">Your park runs<br /><em>on this Chromebook.</em></h1>
        <p class="setup-lede">
          The open-source OpenRCT2 engine stays here. Your licensed RCT2 game files and every park save stay in this browser—never uploaded.
        </p>

        <ol class="route-map" aria-label="Three setup steps">
          <li class="route-stop is-complete" id="step-browser">
            <span class="stop-number">1</span>
            <div><strong>Chromebook check</strong><small id="browser-check-copy">Checking browser support…</small></div>
          </li>
          <li class="route-stop" id="step-assets">
            <span class="stop-number">2</span>
            <div><strong>Add licensed RCT2 files</strong><small id="asset-step-copy">One private import on this device</small></div>
          </li>
          <li class="route-stop" id="step-play">
            <span class="stop-number">3</span>
            <div><strong>Open the park</strong><small>Build, save, and resume locally</small></div>
          </li>
        </ol>

        <div class="primary-actions" id="primary-actions">
          <label class="ticket-button ticket-button-secondary" for="rct-file-input">
            <span aria-hidden="true">＋</span>
            <span><b>Add game files</b><small>Choose your RCT2 .zip</small></span>
          </label>
          <input class="visually-hidden" id="rct-file-input" type="file" accept=".zip,application/zip" />
          <button class="ticket-button ticket-button-primary" id="play-button" type="button">
            <span aria-hidden="true">▶</span>
            <span><b>Open the park</b><small id="play-button-copy">Prepare this Chromebook</small></span>
          </button>
        </div>

        <div class="progress-depot" id="progress-depot" hidden aria-live="polite">
          <div class="progress-label"><strong id="progress-message">Preparing…</strong><span id="progress-value"></span></div>
          <div class="coaster-progress" aria-hidden="true"><i id="progress-track"></i><span id="progress-train">▰</span></div>
          <button class="text-button cancel-button" id="cancel-import" type="button" hidden>Cancel import</button>
        </div>
        <p class="error-message" id="error-message" role="alert" hidden></p>

        <details class="zip-instructions">
          <summary>How do I make the RCT2 ZIP?</summary>
          <div>
            <p>On a computer where you legally own RCT2 or RCT Classic, compress the complete game folder. The ZIP must contain <code>Data/ch.dat</code>. Transfer that ZIP to the Chromebook, then choose it here.</p>
            <p>OpenRCT2 is free software; the original RCT2 graphics and sounds are not. Parkworks does not upload or distribute them.</p>
          </div>
        </details>
      </section>

      <aside class="operations-board" aria-label="Chromebook and save status">
        <div class="board-header">
          <span>Park operations</span><time id="today-label"></time>
        </div>

        <section class="system-ticket" aria-labelledby="system-title">
          <div class="ticket-notch" aria-hidden="true"></div>
          <p class="mini-label">This Chromebook</p>
          <h2 id="system-title">Classroom-ready profile</h2>
          <div class="system-readout">
            <span><b id="memory-value">4 GB</b><small>memory hint</small></span>
            <span><b id="core-value">4</b><small>CPU threads</small></span>
            <span><b id="worker-value">2</b><small>game workers</small></span>
          </div>
          <label class="profile-label" for="performance-profile">Performance mode</label>
          <select id="performance-profile"></select>
          <p class="profile-description" id="profile-description"></p>
        </section>

        <section class="save-ledger" aria-labelledby="save-title">
          <div class="ledger-heading">
            <div><p class="mini-label">Local save ledger</p><h2 id="save-title">Parks stay on this device</h2></div>
            <span class="save-light" id="save-light" aria-label="Save storage status"></span>
          </div>
          <dl>
            <div><dt>RCT2 files</dt><dd id="asset-status">Not checked</dd></div>
            <div><dt>Browser storage</dt><dd id="storage-status">Checked when game opens</dd></div>
            <div><dt>Offline cache</dt><dd id="offline-status">Preparing</dd></div>
            <div><dt>Engine</dt><dd>${ENGINE_VERSION}</dd></div>
          </dl>
          <div class="ledger-actions">
            <button type="button" id="export-saves">Export save backup</button>
            <label for="backup-file-input">Restore backup</label>
            <input class="visually-hidden" id="backup-file-input" type="file" accept=".zip,application/zip" />
            <button class="data-control" type="button" id="remove-game-files">Remove game files</button>
            <button class="data-control" type="button" id="erase-local-saves">Erase local saves</button>
          </div>
          <p class="storage-warning">A profile reset, Powerwash, or clearing site data can erase local parks. Export a backup after each class.</p>
        </section>

        <div class="privacy-stamp"><b>PRIVATE BY DESIGN</b><span>No accounts · no ads · no analytics · no uploads</span></div>
      </aside>
    </main>

    <footer class="site-footer">
      <span>OpenRCT2 ${ENGINE_VERSION} · source ${ENGINE_COMMIT.slice(0, 10)}</span>
      <span>Unofficial classroom project · RollerCoaster Tycoon is a trademark of its owner</span>
    </footer>
  </div>

  <section class="game-shell" id="game-shell" hidden aria-label="OpenRCT2 game">
    <canvas id="game-canvas" tabindex="0" hidden aria-label="OpenRCT2 game canvas"></canvas>
    <button class="game-dock-button" id="open-launcher" type="button" aria-label="Open Parkworks controls">
      <span aria-hidden="true">PW</span><small>Controls</small>
    </button>
    <div class="game-controls" id="game-controls" hidden>
      <button type="button" id="close-launcher">Return to game</button>
      <button type="button" id="fullscreen-button">Fullscreen</button>
      <button type="button" id="game-export-saves">Back up saves</button>
    </div>
  </section>

  <dialog id="help-dialog" class="paper-dialog">
    <form method="dialog">
      <button class="dialog-close" value="close" aria-label="Close help">×</button>
      <p class="dialog-kicker">Student quick start</p>
      <h2>From empty field to first ride</h2>
      <ol>
        <li><b>Pause first.</b> Press <kbd>Space</kbd> while you inspect the park.</li>
        <li><b>Connect paths.</b> Build a short path from the entrance.</li>
        <li><b>Add one gentle ride.</b> Place its entrance, exit, and queue.</li>
        <li><b>Open the ride.</b> Set a fair price and watch guest thoughts.</li>
        <li><b>Save before big changes.</b> Use the in-game save menu, then export a Parkworks backup after class.</li>
      </ol>
      <p class="dialog-note">Keyboard: arrows pan · Page Up/Down zoom · Space pauses · Esc closes the top game window.</p>
    </form>
  </dialog>

  <dialog id="legal-dialog" class="paper-dialog legal-dialog">
    <form method="dialog">
      <button class="dialog-close" value="close" aria-label="Close legal information">×</button>
      <p class="dialog-kicker">About, privacy & accessibility</p>
      <h2>Open engine. Private game data.</h2>
      <p>Parkworks packages a modified browser build of OpenRCT2 under GPLv3. The exact engine source, modifications, build recipe, and license are available in the linked public source repository.</p>
      <p>OpenRCT2 requires files from a legally owned copy of RollerCoaster Tycoon 2 or RollerCoaster Tycoon Classic. Those files remain in IndexedDB on this Chromebook and are not sent to Parkworks, Vercel, GitHub, or a teacher.</p>
      <p>The setup wrapper supports keyboard navigation, visible focus, reduced motion, and high contrast. The original game canvas is highly visual and is not fully compatible with screen readers; teachers should provide a paired-player or alternative activity when needed.</p>
      <p><a href="https://github.com/goldbar123467/openrct2-classroom-web" rel="noopener noreferrer">View source and GPL notices</a></p>
    </form>
  </dialog>

  <dialog id="confirm-dialog" class="paper-dialog confirm-dialog">
    <form method="dialog">
      <p class="dialog-kicker">Please confirm</p>
      <h2 id="confirm-title">Confirm action</h2>
      <p id="confirm-copy"></p>
      <div class="dialog-actions">
        <button value="cancel">Cancel</button>
        <button value="confirm" id="confirm-action">Confirm</button>
      </div>
    </form>
  </dialog>
`;

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing interface element: ${id}`);
  return element as T;
}

const progressDepot = byId<HTMLDivElement>("progress-depot");
const progressMessage = byId<HTMLElement>("progress-message");
const progressValue = byId<HTMLElement>("progress-value");
const progressTrack = byId<HTMLElement>("progress-track");
const progressTrain = byId<HTMLElement>("progress-train");
const errorMessage = byId<HTMLParagraphElement>("error-message");
const playButton = byId<HTMLButtonElement>("play-button");
const rctFileInput = byId<HTMLInputElement>("rct-file-input");
const backupFileInput = byId<HTMLInputElement>("backup-file-input");
const cancelImport = byId<HTMLButtonElement>("cancel-import");
const profileSelect = byId<HTMLSelectElement>("performance-profile");
const launcherShell = byId<HTMLDivElement>("launcher-shell");
const gameShell = byId<HTMLElement>("game-shell");
const gameControls = byId<HTMLDivElement>("game-controls");

function setError(error: unknown): void {
  let diagnostic: Record<string, unknown> | undefined;
  if (error && typeof error === "object") {
    diagnostic = {};
    for (const key of Object.getOwnPropertyNames(error)) {
      try {
        diagnostic[key] = (error as Record<string, unknown>)[key];
      } catch {
        diagnostic[key] = "unreadable";
      }
    }
  }
  if (typeof error !== "string") console.error("Parkworks operation failed", diagnostic ?? error);
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message
        : error && typeof error === "object" && "errno" in error && typeof error.errno === "number"
          ? `The browser engine reported filesystem error ${error.errno}. Reload the page and try again.`
        : String(error);
  errorMessage.textContent = message;
  errorMessage.hidden = false;
  progressDepot.hidden = true;
  playButton.disabled = false;
}

function clearError(): void {
  errorMessage.hidden = true;
  errorMessage.textContent = "";
}

function reportProgress(update: ProgressUpdate): void {
  clearError();
  progressDepot.hidden = false;
  progressMessage.textContent = update.message;
  const hasNumbers = typeof update.loaded === "number" && typeof update.total === "number" && update.total > 0;
  const percentage = hasNumbers ? Math.min(100, Math.round(((update.loaded ?? 0) / (update.total ?? 1)) * 100)) : 12;
  progressTrack.style.width = `${percentage}%`;
  progressTrain.style.left = `calc(${percentage}% - 0.8rem)`;
  progressDepot.classList.toggle("is-indeterminate", !hasNumbers);
  progressValue.textContent = hasNumbers ? `${percentage}%` : "";
}

function renderProfile(profile: PerformanceProfile): void {
  byId<HTMLElement>("worker-value").textContent = String(profile.workers);
  byId<HTMLElement>("profile-description").textContent = `${profile.description} Starts at ${profile.memoryMiB} MB and grows only when needed.`;
}

function renderSystemCheck(): void {
  const memory = hintedNavigator.deviceMemory;
  byId<HTMLElement>("memory-value").textContent = memory ? `${memory} GB` : "≤4 GB";
  byId<HTMLElement>("core-value").textContent = String(navigator.hardwareConcurrency || 4);
  const checksPass =
    (window.isSecureContext || location.hostname === "127.0.0.1" || location.hostname === "localhost") &&
    window.crossOriginIsolated &&
    typeof SharedArrayBuffer !== "undefined" &&
    typeof WebAssembly !== "undefined";
  const browserCopy = byId<HTMLElement>("browser-check-copy");
  browserCopy.textContent = checksPass ? "Chrome has the required game features" : "Needs secure browser isolation";
  byId<HTMLElement>("step-browser").classList.toggle("has-error", !checksPass);
}

function renderImportedState(imported: boolean): void {
  byId<HTMLElement>("asset-status").textContent = imported ? "Stored privately" : "Not added yet";
  byId<HTMLElement>("asset-step-copy").textContent = imported ? "Licensed game files are stored locally" : "One private import on this device";
  byId<HTMLElement>("step-assets").classList.toggle("is-complete", imported);
  byId<HTMLElement>("step-play").classList.toggle("is-active", imported);
  byId<HTMLElement>("play-button-copy").textContent = imported ? "Resume from local storage" : "Prepare this Chromebook";
  byId<HTMLElement>("save-light").classList.toggle("is-on", imported);
}

async function updateStorageStatus(): Promise<void> {
  const status = await getStorageStatus();
  const storageCopy = byId<HTMLElement>("storage-status");
  if (!status.quota) {
    storageCopy.textContent = status.persisted ? "Persistent" : "Available";
    return;
  }
  storageCopy.textContent = `${formatBytes(status.usage)} of ${formatBytes(status.quota)}${status.persisted ? " · protected" : ""}`;
}

async function ensureEngine(): Promise<OpenRct2Module> {
  if (moduleInstance) return moduleInstance;
  if (initializePromise) return initializePromise;
  playButton.disabled = true;
  initializePromise = initializeOpenRct2(selectedProfile, reportProgress)
    .then(async (module) => {
      moduleInstance = module;
      const recovered = await recoverInterruptedRestore(module);
      if (recovered) reportProgress({ phase: "storage", message: "Recovered saves from an interrupted restore." });
      renderImportedState(hasRctData(module));
      await requestPersistentStorage();
      await updateStorageStatus();
      await updateOfflineCacheStatus();
      progressDepot.hidden = true;
      playButton.disabled = false;
      return module;
    })
    .catch((error) => {
      initializePromise = null;
      playButton.disabled = false;
      throw error;
    });
  return initializePromise;
}

function openGameView(): void {
  gameShell.hidden = false;
  launcherShell.hidden = true;
  document.body.classList.add("is-playing");
  gameControls.hidden = true;
  byId<HTMLCanvasElement>("game-canvas").focus();
}

function openLauncherOverlay(): void {
  launcherShell.hidden = false;
  launcherShell.classList.add("is-overlay");
  gameControls.hidden = false;
  if (moduleInstance) setGamePaused(moduleInstance, true);
  byId<HTMLButtonElement>("close-launcher").focus();
}

function closeLauncherOverlay(): void {
  launcherShell.hidden = true;
  launcherShell.classList.remove("is-overlay");
  gameControls.hidden = true;
  if (moduleInstance) setGamePaused(moduleInstance, false);
  byId<HTMLCanvasElement>("game-canvas").focus();
}

async function askConfirmation(title: string, copy: string, actionLabel: string): Promise<boolean> {
  const dialog = byId<HTMLDialogElement>("confirm-dialog");
  byId<HTMLElement>("confirm-title").textContent = title;
  byId<HTMLElement>("confirm-copy").textContent = copy;
  byId<HTMLButtonElement>("confirm-action").textContent = actionLabel;
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
  });
}

for (const profile of listPerformanceProfiles()) {
  const option = document.createElement("option");
  option.value = profile.id;
  option.textContent = `${profile.label} · ${profile.workers} workers`;
  option.selected = profile.id === selectedProfile.id;
  profileSelect.append(option);
}
renderProfile(selectedProfile);
renderSystemCheck();
renderImportedState(Boolean(localStorage.getItem("parkworks.rctImport")));
byId<HTMLTimeElement>("today-label").textContent = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date());

profileSelect.addEventListener("change", () => {
  const next = getPerformanceProfile(profileSelect.value as PerformanceProfileId);
  if (moduleInstance) {
    profileSelect.value = selectedProfile.id;
    setError("Performance mode is locked while the engine is open. Reload the page to choose another mode.");
    return;
  }
  selectedProfile = next;
  localStorage.setItem("parkworks.performance", next.id);
  renderProfile(next);
});

playButton.addEventListener("click", async () => {
  try {
    const module = await ensureEngine();
    if (!hasRctData(module)) {
      setError("Add a ZIP from a legally owned RCT2 or RCT Classic installation first.");
      rctFileInput.focus();
      return;
    }
    reportProgress({ phase: "ready", message: "Opening your park…" });
    await startGame(module);
    openGameView();
  } catch (error) {
    setError(error);
  }
});

rctFileInput.addEventListener("change", async () => {
  const file = rctFileInput.files?.[0];
  if (!file) return;
  importController = new AbortController();
  cancelImport.hidden = false;
  try {
    const module = await ensureEngine();
    await importRctArchive(module, file, reportProgress, importController.signal);
    renderImportedState(true);
    await updateStorageStatus();
    reportProgress({ phase: "ready", message: "Game files verified and stored privately. Your park is ready." });
    window.setTimeout(() => {
      progressDepot.hidden = true;
    }, 1800);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") setError("Import cancelled. Existing game files were not changed.");
    else setError(error);
  } finally {
    importController = null;
    cancelImport.hidden = true;
    rctFileInput.value = "";
  }
});

cancelImport.addEventListener("click", () => importController?.abort());

async function handleExport(): Promise<void> {
  try {
    const module = await ensureEngine();
    reportProgress({ phase: "storage", message: "Verifying and packing local saves…" });
    const result = await exportSaveBackup(module);
    reportProgress({ phase: "ready", message: `${result.fileName} is ready. Keep it in Drive or another safe place.` });
    window.setTimeout(() => {
      progressDepot.hidden = true;
    }, 2400);
  } catch (error) {
    setError(error);
  }
}

byId<HTMLButtonElement>("export-saves").addEventListener("click", handleExport);
byId<HTMLButtonElement>("game-export-saves").addEventListener("click", handleExport);

async function handleClearGameFiles(): Promise<boolean> {
  try {
    const confirmed = await askConfirmation(
      "Remove local RCT2 files?",
      "This removes imported game data from this Chromebook. Park saves are kept.",
      "Remove game files",
    );
    if (!confirmed) return false;
    const module = await ensureEngine();
    await clearRctData(module);
    renderImportedState(false);
    reportProgress({ phase: "ready", message: "Local RCT2 files removed. Park saves were kept." });
    return true;
  } catch (error) {
    setError(error);
    return false;
  }
}

async function handleClearSaves(): Promise<boolean> {
  try {
    const confirmed = await askConfirmation(
      "Erase all local park saves?",
      "Export a backup first. This cannot be undone after browser storage syncs.",
      "Erase local saves",
    );
    if (!confirmed) return false;
    const module = await ensureEngine();
    await clearLocalSaves(module);
    await updateStorageStatus();
    reportProgress({ phase: "ready", message: "All local park saves were erased." });
    return true;
  } catch (error) {
    setError(error);
    return false;
  }
}

byId<HTMLButtonElement>("remove-game-files").addEventListener("click", handleClearGameFiles);
byId<HTMLButtonElement>("erase-local-saves").addEventListener("click", handleClearSaves);

backupFileInput.addEventListener("change", async () => {
  const file = backupFileInput.files?.[0];
  if (!file) return;
  try {
    const confirmed = await askConfirmation(
      "Restore this save backup?",
      "The backup is fully verified before it replaces current local saves. A corrupt or incorrect ZIP will leave current saves untouched.",
      "Verify and restore",
    );
    if (!confirmed) return;
    const module = await ensureEngine();
    reportProgress({ phase: "storage", message: "Checking every backup file and checksum…" });
    const manifest = await importSaveBackup(module, file);
    reportProgress({ phase: "ready", message: `Restored ${manifest.files.length} verified files from ${manifest.createdAt.slice(0, 10)}.` });
    await updateStorageStatus();
  } catch (error) {
    setError(error);
  } finally {
    backupFileInput.value = "";
  }
});

document.querySelectorAll<HTMLElement>("[data-dialog]").forEach((button) => {
  button.addEventListener("click", () => {
    const id = button.dataset.dialog;
    if (id) byId<HTMLDialogElement>(id).showModal();
  });
});

byId<HTMLButtonElement>("open-launcher").addEventListener("click", openLauncherOverlay);
byId<HTMLButtonElement>("close-launcher").addEventListener("click", closeLauncherOverlay);
byId<HTMLButtonElement>("fullscreen-button").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await gameShell.requestFullscreen();
  } catch (error) {
    setError(error);
  }
});

window.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "p" && isGameStarted()) {
    event.preventDefault();
    if (launcherShell.hidden) openLauncherOverlay();
    else closeLauncherOverlay();
  }
});

const networkIndicator = byId<HTMLElement>("network-indicator");
function renderNetworkState(): void {
  networkIndicator.classList.toggle("is-offline", !navigator.onLine);
  const label = networkIndicator.querySelector("span");
  if (label) label.textContent = navigator.onLine ? "Online" : "Offline-ready";
}
window.addEventListener("online", renderNetworkState);
window.addEventListener("offline", renderNetworkState);
renderNetworkState();

async function updateOfflineCacheStatus(): Promise<void> {
  const offlineCopy = byId<HTMLElement>("offline-status");
  if (!import.meta.env.PROD) {
    offlineCopy.textContent = "Enabled in production";
    return;
  }
  if (!("serviceWorker" in navigator) || !("caches" in window)) {
    offlineCopy.textContent = "Unavailable in this browser";
    return;
  }
  if (!navigator.serviceWorker.controller) {
    offlineCopy.textContent = "Launcher ready after reload";
    return;
  }
  const engineCached = await Promise.all([
    caches.match("/engine/openrct2.js", { ignoreSearch: true }),
    caches.match("/engine/openrct2.wasm", { ignoreSearch: true }),
    caches.match("/engine/assets.zip", { ignoreSearch: true }),
  ]);
  offlineCopy.textContent = engineCached.every(Boolean) ? "Launcher + engine ready" : "Launcher ready";
}

if (import.meta.env.PROD && "serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(async () => {
        await navigator.serviceWorker.ready;
        await updateOfflineCacheStatus();
      })
      .catch((error: unknown) => {
        byId<HTMLElement>("offline-status").textContent = "Unavailable";
        console.warn("Offline cache unavailable", error);
      });
  });
} else {
  void updateOfflineCacheStatus();
}

// Exposed only for the recovery controls in the teacher/admin runbook.
Object.assign(window, {
  parkworksAdmin: {
    clearGameFiles: handleClearGameFiles,
    clearSaves: handleClearSaves,
  },
});
