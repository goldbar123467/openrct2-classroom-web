# Changelog

## 0.1.0 — 2026-07-18

- Added Parkworks Chromebook-first classroom launcher.
- Built OpenRCT2 `9de2d43fb6` with 512 MiB initial and 2 GiB maximum WebAssembly memory.
- Replaced the 120-worker upstream browser pool with a 1–4 worker device profile.
- Added local RCT2 ZIP import with staging, bounds, progress, and cancellation.
- Added IndexedDB save persistence, storage status, periodic flush, and persistent-storage request.
- Added checksum-verified save export and journaled restore/rollback.
- Added offline cache, Vercel cross-origin isolation/security headers, GPL provenance, asset scan, unit tests, and classroom handoff documentation.
- Added atomic in-memory save export/restore/rollback integration coverage and hostile licensed-ZIP import transactions.
- Added Playwright/axe verification for keyboard use, 200% effective viewport, forced colors, reduced motion, exact Lite engine boot, same-origin networking, and full offline reload.
- Added dependency audit, full-history secret scan, license policy, CycloneDX SBOM validation, security-header parity, and deterministic distribution hashes for release evidence.
- Added reusable HTTPS production probes and stopped emitting unconsumed browser source maps so every release-manifest file is publicly verifiable.
- Added a pinned, clean source-to-WASM rebuild that reproduces the shipped JS/WASM hashes and validates the 512 MiB/2 GiB shared-memory import.
- Added exact-commit production markers, all-file live hash verification, GitHub deployment records, and a post-deploy production browser workflow.
- Added passing screenshot/performance artifacts and an application-cache upgrade test that preserves real IDBFS bytes while retiring the legacy cache.
