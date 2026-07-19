# Parkworks — OpenRCT2 Classroom Web

Parkworks is a Chromebook-first launcher for the real OpenRCT2 WebAssembly engine. It provides a fast student setup screen, a two-worker low-memory mode, device-local RCT2 data, IndexedDB-backed saves, checksum-verified save backups, offline caching, and Vercel-ready security headers.

> **Important:** OpenRCT2 still requires RCT2 or RCT Classic game files. They are never committed to this repository or included in the public static/Vercel build. The school deployment mounts its human-authorized package separately and serves it only behind the password gate with private, no-store caching.

## Current verification status

| Requirement | Evidence | Status |
| --- | --- | --- |
| Production shell and 200% effective viewport | Playwright/axe, keyboard, forced colors, reduced motion, no overflow | Passed in Chromium |
| Cross-origin isolation headers | Local/Vercel config parity, response headers, `crossOriginIsolated` | Passed locally and live |
| Custom OpenRCT2 engine | Pinned commit/container; clean source build verifies the WASM contract and boots its fresh JS/WASM pair | Passed |
| 512 MiB / two-worker boot | Real WebAssembly initialization and 2,500+ open assets installed in browser | Passed on desktop Chromium |
| Local save persistence and recovery | Real IDBFS reload plus UI export, erase, checksum restore, app-cache upgrade, full Chromium close/relaunch, and cached offline engine restart | Passed with synthetic `.park` bytes |
| No proprietary game data in deploy | CI archive/name scanner | Passed |
| Real RCT2 asset import and gameplay | Protected 705 MB package, automatic 2,457-file browser install, native title menu, zoom/window controls, and school sandbox policy | Passed on the live school site |
| Lowest-spec managed Chromebook soak | Requires the district’s actual hardware | Not yet proven |
| Production school deployment | [Password-protected Parkworks](https://parkworks.upsidedownatlas.com); Cloudflare Tunnel to loopback-only Caddy | Live |

The project is intentionally not called “complete” until the same production commit passes the real-device and licensed-gameplay gates in [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Student flow

1. Open the password-protected HTTPS school site in a current managed Chrome browser.
2. Choose **Classroom lite** on a 4 GB Chromebook.
3. Choose **Open the park**. On first launch, the protected package downloads and installs automatically into private browser storage.
4. Open **New Game** from OpenRCT2's title menu and choose a starting map. Parkworks applies no-money play, native sandbox tools, a have-fun objective, and complete research to the loaded park.
5. Use OpenRCT2's native full-screen controls and normal in-game save menu.
6. Reload to the launcher when class is over, export a Parkworks save backup, and store it in Google Drive or another approved location.

See [the one-page student guide](docs/STUDENT_GUIDE.md).

## Architecture

```text
Protected school server / Cloudflare Tunnel
  ├─ student launcher (Vite + TypeScript)
  ├─ custom OpenRCT2 JS/WASM (GPLv3, network disabled)
  ├─ open-source OpenRCT2 objects
  └─ separately mounted licensed package (Basic Auth, no-store)

Chromebook browser only
  ├─ automatically installed RCT2 files → IndexedDB /RCT
  ├─ OpenRCT2 data                    → IndexedDB /OpenRCT2
  ├─ saves, autosaves, config         → IndexedDB /persistent
  └─ exported backup ZIP + SHA-256 manifest
```

There are no accounts, trackers, ads, third-party runtime scripts, cloud game saves, or multiplayer connections. The custom engine is compiled with OpenRCT2 networking, HTTP, Discord RPC, TTF, FLAC, and OpenGL disabled.

## Local development

Requirements: Node.js 22+, npm, Git, GitHub CLI for engine refreshes, and Docker Desktop only when rebuilding the C++ engine.

```powershell
npm install
npm run check
npm run dev -- --host 127.0.0.1
```

The development server must send COOP/COEP headers or `SharedArrayBuffer` will be unavailable. Do not open `index.html` directly from disk.

## Quality gates

```powershell
npm run verify:engine   # exact JS/WASM/open-asset hashes and Chromebook patch
npm run verify:assets   # rejects proprietary RCT2 signatures in distributables
npm test                # import/path/profile unit tests
npm run build           # strict TypeScript + Vite production build
npm run check           # all of the above
npm run test:e2e        # accessibility, real Lite boot, IDBFS recovery, browser relaunch, and offline reload
npm run verify:security # audit, current/history secret scan, licenses, and SBOM
npm run evidence:dist   # deterministic SHA-256 manifest for every built file
```

GitHub Actions runs these gates from `npm ci`, installs the pinned Playwright Chromium build, and uploads a commit-addressed CycloneDX SBOM, dependency-license report, engine manifest, and distribution hash manifest.

The separate **Engine source rebuild** workflow compiles all OpenRCT2 C++ targets from the exact upstream commit on the immutable container filesystem with IPO disabled and pinned one-job Ninja, Emscripten, Binaryen, and `wasm-ld` scheduling. It must reproduce the exact shipped JS/WASM hashes in `scripts/engine-manifest.json`, then builds the launcher around that freshly generated pair and boots it through the browser suite. Run the same strict comparison locally with:

```powershell
./scripts/rebuild-engine.ps1 -VerifyManifest
```

The **Production deployment gate** waits for the exact commit marker, rebuilds the release, compares all nine live files byte-for-byte, records a GitHub deployment, and reruns the four production browser flows. This workflow is intentionally distinct from the pre-merge quality gate.

To run the identical browser suite against the public deployment instead of starting a local preview:

```powershell
$env:PLAYWRIGHT_BASE_URL = "https://openrct2-classroom-web.vercel.app"
npm run test:e2e
Remove-Item Env:PLAYWRIGHT_BASE_URL
```

External probes require HTTPS. Production source maps are not emitted; release evidence hashes only publicly served runtime files.

## Engine provenance and GPL source

The shipped engine is derived from OpenRCT2 commit [`9de2d43fb6e7d6a6213336125a4afbddf8cc167c`](https://github.com/OpenRCT2/OpenRCT2/tree/9de2d43fb6e7d6a6213336125a4afbddf8cc167c), GPLv3.

Parkworks changes two Emscripten build settings and one generated-worker control:

- `INITIAL_MEMORY`: 2 GiB → 512 MiB
- `MAXIMUM_MEMORY`: 4 GiB → 2 GiB
- startup worker pool: fixed 120 → wrapper-selected 1–4, capped at four

The exact build flags, patch script, hashes, and upstream run are recorded in [docs/ENGINE_SOURCE.md](docs/ENGINE_SOURCE.md) and [scripts/engine-manifest.json](scripts/engine-manifest.json). The complete upstream source at the pinned commit plus this repository’s scripts are the Corresponding Source for the shipped object code.

The corresponding-source package now includes the exact source patch, immutable build-container digest, automated clean rebuild, generated-wrapper patch, and machine-checked memory/import and file hashes. See [docs/ENGINE_SOURCE.md](docs/ENGINE_SOURCE.md).

## Deployment

`vercel.json` remains the public static rollback configuration. The live school release uses equivalent headers in Caddy, Basic Auth, a loopback-only Docker origin, and an outbound Cloudflare Tunnel. Licensed assets are mounted outside Git and `dist`, served with private/no-store headers, and excluded from the service worker. See [deploy/README.md](deploy/README.md).

The same output also works on a school-controlled static server if it preserves the headers documented in [docs/ADMIN_RUNBOOK.md](docs/ADMIN_RUNBOOK.md).

## Documentation

- [Student guide](docs/STUDENT_GUIDE.md)
- [Teacher rollout guide](docs/TEACHER_GUIDE.md)
- [Admin and maintenance runbook](docs/ADMIN_RUNBOOK.md)
- [Engine source and reproducibility](docs/ENGINE_SOURCE.md)
- [Asset and license manifest](docs/ASSET_MANIFEST.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Accessibility statement](docs/ACCESSIBILITY.md)
- [Verification matrix](docs/VERIFICATION.md)
- [Release evidence records](docs/evidence/README.md)
- [Security policy](SECURITY.md)

## Trademark

OpenRCT2 is an independent open-source project. RollerCoaster Tycoon is a trademark of its owner. Parkworks is an unofficial classroom launcher and is not endorsed by OpenRCT2, Atari, Chris Sawyer, or Frontier Developments.
