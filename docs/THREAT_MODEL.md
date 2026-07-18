# Threat model

## Protected assets

- Student park saves and preferences.
- Locally imported proprietary RCT2 files.
- Chromebook availability during class.
- Integrity and provenance of the OpenRCT2 engine.

## Trust boundaries

The Vercel/static origin is trusted to serve the pinned open-source application. Imported ZIPs are untrusted input. IndexedDB and Cache Storage are origin-local but can be removed by the browser, profile management, or device reset. Exported backups leave the origin and become the student/district’s responsibility.

## Controls

- No accounts, PII, ads, analytics, multiplayer, engine HTTP, or third-party runtime calls.
- Strict same-origin CSP, COOP, COEP, CORP, nosniff, no-referrer, and restrictive permissions policy.
- Exact dependency lockfile and engine SHA-256 checks.
- ZIP path normalization rejects traversal, NUL, absolute, and unsupported paths.
- Limits: 1.25 GB compressed, 12,000 entries, 1.6 GB expanded for RCT2; 250 MB/1,000 entries/500 MB expanded for backups.
- CRC checking and SHA-256 manifest verification.
- RCT2 import uses a staging filesystem before replacing existing local game data.
- Backup restore validates every file before a journaled swap; interrupted swaps roll back at next start.
- Service worker accepts only same-origin GET responses and versions its cache.
- Automated scan rejects likely proprietary game files from deployable assets.

## Residual risks

- JSZip must hold compressed data and individual expanded entries in browser memory; very large installations may still exceed a 4 GB Chromebook’s practical tab limit.
- WebAssembly game UI is a large attack surface; keep the upstream engine pinned and updated deliberately.
- Local IndexedDB is not an institutional backup.
- Browser extensions, district TLS interception, or filters can alter behavior outside the app’s control.
- A malicious ZIP that stays below every limit can still consume substantial CPU; imports require progress, cancellation, and teacher supervision.
- The browser game canvas cannot provide full screen-reader access.

## Required release checks

Run dependency audit, secret scan, proprietary-asset scan, CSP/header check, corrupt/traversal/oversized ZIP corpus, offline cache test, save round-trip, and a real-device network trace showing only the Parkworks origin. No high/critical finding may remain open at production promotion.
