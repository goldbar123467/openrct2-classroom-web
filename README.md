# Parkworks — OpenRCT2 Classroom Web

Parkworks is a Chromebook-first launcher for the real OpenRCT2 WebAssembly engine. It provides a fast student setup screen, a two-worker low-memory mode, device-local RCT2 data, IndexedDB-backed saves, checksum-verified save backups, offline caching, and Vercel-ready security headers.

> **Important:** OpenRCT2 is free software, but it still requires files from a legally owned copy of RollerCoaster Tycoon 2 or RollerCoaster Tycoon Classic. This repository does not contain, upload, or serve those proprietary files. A district should confirm its classroom licensing rights before rollout; do not assume one personal copy covers a class.

## Current verification status

| Requirement | Evidence | Status |
| --- | --- | --- |
| Production shell at 1366×768 | Browser screenshot, semantic snapshot, no horizontal overflow | Passed locally |
| Cross-origin isolation headers | Vite and Vercel header config; local response check | Passed locally |
| Custom OpenRCT2 engine | Pinned commit `9de2d43fb6e7d6a6213336125a4afbddf8cc167c`; SHA-256 manifest | Passed |
| 512 MiB / two-worker boot | Real WebAssembly initialization and 2,500+ open assets installed in browser | Passed on desktop Chromium |
| No proprietary game data in deploy | CI archive/name scanner | Passed |
| Real RCT2 asset import and gameplay | Requires a lawfully owned local installation | Awaiting licensed test data |
| Lowest-spec managed Chromebook soak | Requires the district’s actual hardware | Not yet proven |
| Production Vercel deployment | Build is ready; deploy evidence added after publication | Pending |

The project is intentionally not called “complete” until the same production commit passes the real-device and licensed-gameplay gates in [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Student flow

1. Open the HTTPS site in a current managed Chrome browser.
2. Choose **Classroom lite** on a 4 GB Chromebook.
3. Select a ZIP made from a legally licensed RCT2/RCT Classic installation. The ZIP must contain `Data/ch.dat`.
4. Wait for the local import to finish. The ZIP is read in the browser and is never uploaded.
5. Open the park and use the normal in-game save menu.
6. Export a Parkworks save backup at the end of class and store it in Google Drive or another approved location.

See [the one-page student guide](docs/STUDENT_GUIDE.md).

## Architecture

```text
Vercel / static host
  ├─ student launcher (Vite + TypeScript)
  ├─ custom OpenRCT2 JS/WASM (GPLv3, network disabled)
  └─ open-source OpenRCT2 objects

Chromebook browser only
  ├─ imported proprietary RCT2 files → IndexedDB /RCT
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
```

## Engine provenance and GPL source

The shipped engine is derived from OpenRCT2 commit [`9de2d43fb6e7d6a6213336125a4afbddf8cc167c`](https://github.com/OpenRCT2/OpenRCT2/tree/9de2d43fb6e7d6a6213336125a4afbddf8cc167c), GPLv3.

Parkworks changes two Emscripten build settings and one generated-worker control:

- `INITIAL_MEMORY`: 2 GiB → 512 MiB
- `MAXIMUM_MEMORY`: 4 GiB → 2 GiB
- startup worker pool: fixed 120 → wrapper-selected 1–4, capped at four

The exact build flags, patch script, hashes, and upstream run are recorded in [docs/ENGINE_SOURCE.md](docs/ENGINE_SOURCE.md) and [scripts/engine-manifest.json](scripts/engine-manifest.json). The complete upstream source at the pinned commit plus this repository’s scripts are the Corresponding Source for the shipped object code.

## Deployment

`vercel.json` supplies HTTPS production behavior, cross-origin isolation, a restrictive CSP, permissions policy, no-referrer, nosniff, and immutable caching for versioned engine assets. Deployment is static; no database or server credentials are required.

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
- [Security policy](SECURITY.md)

## Trademark

OpenRCT2 is an independent open-source project. RollerCoaster Tycoon is a trademark of its owner. Parkworks is an unofficial classroom launcher and is not endorsed by OpenRCT2, Atari, Chris Sawyer, or Frontier Developments.
