# OpenRCT2 engine source and reproducibility

## Corresponding Source

- Upstream: <https://github.com/OpenRCT2/OpenRCT2>
- Exact commit: `9de2d43fb6e7d6a6213336125a4afbddf8cc167c`
- Upstream version: `v0.5.3-49-g9de2d43fb6`
- Upstream Actions run used for comparison/open assets: `29610479932`
- License: GPLv3 or later (`LICENSE`)
- OpenRCT2 contributor notice: `OPENRCT2_CONTRIBUTORS.md`

The complete upstream tree at that commit, together with this repository’s `scripts/sync-engine.ps1`, `scripts/patch-engine.mjs`, build settings below, and wrapper source, is the Corresponding Source for the shipped JavaScript and WebAssembly.

## Modified Emscripten flags

The upstream `scripts/build-emscripten` link flags were changed as follows:

```diff
- -s MAXIMUM_MEMORY=4GB -s INITIAL_MEMORY=2GB -s PTHREAD_POOL_SIZE=120
+ -s MAXIMUM_MEMORY=2GB -s INITIAL_MEMORY=512MB -s PTHREAD_POOL_SIZE=4
```

The generated JS worker pool is then changed from a fixed compile-time value to:

```js
Math.min(4, Math.max(1, Number(Module["PTHREAD_POOL_SIZE"]) || 2))
```

The wrapper chooses 2 workers for Classroom lite, 3 for Balanced, and 4 for Smooth. The build disables network, HTTP, OpenGL, TTF, FLAC, and Discord RPC, matching the upstream browser build’s privacy-oriented feature set.

The source patch also keeps native builds on the upstream background preloader while browser builds initialize repositories synchronously and switch to the requested startup scene before the Emscripten main loop begins. This avoids an indefinitely rendering-inhibited preloader after its worker finishes in Chrome.

## Rebuild

The automated rebuild uses the immutable container image:

```text
ghcr.io/openrct2/openrct2-build@sha256:0e1daa8e3f5a1c6951179aeab5c5de471ea705cb5f756bfb6e0ae5162b7e67be
```

From the Parkworks repository root, run:

```powershell
./scripts/rebuild-engine.ps1 -VerifyManifest
```

The script initializes a clean source checkout with Unix line endings, fetches the exact commit and tags, applies `scripts/engine-lite.patch`, builds in the pinned container, patches only the generated-JS wrapper control, and parses the WASM memory import. `-VerifyManifest` performs a strict byte comparison when auditing the tracked release in the same build environment. The dedicated GitHub **Engine source rebuild** workflow uses `-VerifyContract`, records the newly generated hashes, builds the launcher around that matching JS/WASM pair, and boots it through the browser suite.

Emscripten-generated JS/WASM is a coupled pair and can vary byte-for-byte between otherwise equivalent builds because build-time constant tables and optimization output are generated together. Therefore cross-host CI does not substitute a freshly built WASM under the tracked JS or claim a false bit-for-bit reproducibility guarantee. It proves the source, flags, memory import, wrapper limits, browser initialization, storage, recovery, update, and offline contracts; the normal Quality gate separately enforces the exact hashes of the deployed tracked pair.

1. Clone the exact upstream commit with Unix line endings.
2. Use the immutable container digest recorded above.
3. Apply the build-flag diff above to upstream `scripts/build-emscripten`.
4. Run `bash scripts/build-emscripten` inside the container.
5. Copy `build/www/openrct2.js` and `openrct2.wasm` into `public/engine/`.
6. Run `node scripts/patch-engine.mjs`.
7. Assemble `assets.zip` only from the open-source `data/` directory and changelog in the matching OpenRCT2 portable artifact.
8. Update and verify `scripts/engine-manifest.json`.

`scripts/sync-engine.ps1` invokes the clean C++/Emscripten rebuild and then assembles the matching open assets. Patching only JavaScript is insufficient because the `.wasm` import declares its own minimum memory.

## Shipped hashes

`scripts/sync-engine.ps1` now calls the clean source rebuild before retrieving and assembling matching open assets. It no longer substitutes an upstream 2 GiB/120-worker WASM and patches only JavaScript.

On 2026-07-18, a clean local run compiled 693 targets with the browser preloader, resize, and hardware-display fixes:

- `openrct2.js`: `8ebc20e0b5d4a4c77796844f188929c501bb85127d2a623b4a663e03433c8296`
- `openrct2.wasm`: `588d9993675caa8c1e28f1ca716dc82621accbed15e01042dff8bfbca3ebadb5`
- WASM memory import: shared, 8192 initial pages (512 MiB), 32768 maximum pages (2 GiB)

The authoritative byte sizes and SHA-256 hashes are machine-readable in `scripts/engine-manifest.json` and are checked during every production build.
