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

## Rebuild

1. Clone the exact upstream commit with Unix line endings.
2. Use `ghcr.io/openrct2/openrct2-build:26-emscripten`.
3. Apply the build-flag diff above to upstream `scripts/build-emscripten`.
4. Run `bash scripts/build-emscripten` inside the container.
5. Copy `build/www/openrct2.js` and `openrct2.wasm` into `public/engine/`.
6. Run `node scripts/patch-engine.mjs`.
7. Assemble `assets.zip` only from the open-source `data/` directory and changelog in the matching OpenRCT2 portable artifact.
8. Update and verify `scripts/engine-manifest.json`.

`scripts/sync-engine.ps1` automates artifact retrieval and open-asset assembly. A clean C++/Emscripten rebuild is required when changing the declared WebAssembly memory limits; patching only JavaScript is insufficient because the `.wasm` import declares its own minimum memory.

## Shipped hashes

The authoritative byte sizes and SHA-256 hashes are machine-readable in `scripts/engine-manifest.json` and are checked during every production build.
