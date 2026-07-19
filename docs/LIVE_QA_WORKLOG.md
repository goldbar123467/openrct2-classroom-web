# Parkworks live QA worklog

This file is the durable operational memory for live school-release testing. It records only non-secret release facts and must not contain passwords, access tokens, private keys, or licensed game data.

## Current target

- Live origin: `https://parkworks.upsidedownatlas.com`
- Engine: OpenRCT2 `v0.5.3-49-g9de2d43fb6`
- Expected site commit: `39054236838afbfe27db1a65ab1998f3881c2d96`
- Licensed package version: `955cb0b39334`
- Magic Mountain saved-park version: `f76e9d8f9c9b`
- Standard route must open the native OpenRCT2 title menu.
- `?park=magic-mountain` and the dedicated launcher button must open the browser-ready Magic Mountain saved park directly, apply the school sandbox, and begin running without an extra pause click.

## Root-cause record

- The licensed legacy `Six Flags Magic Mountain.SC6` is valid: the same pinned native engine loaded it, simulated 1,000 ticks, and rendered a 1280 x 720 screenshot.
- The browser port hangs during the scenario-start transition for that park. Converting the scenario to `.park`, increasing the worker profile, and switching display renderers did not eliminate that transition hang.
- A native saved-game snapshot bypasses the failing scenario-start transition. Direct startup initially showed a black canvas because the filename followed the CLI options; OpenRCT2 logged that all options must be at the end. Commit `3905423` corrects the order.
- Computer Use confirmed that commit `3905423` renders the actual park and accepts native canvas clicks. The remaining no-animation report was the snapshot's persisted pause flag, not another renderer hang.

## Current hardening candidate

- Apply sandbox state from real-time plug-in callbacks so a paused saved park cannot block setup.
- Enable no-money mode, sandbox tools, and ignored research status, then explicitly start the simulation.
- Remove Magic Mountain from the scenario menu and expose a dedicated direct-load launcher button; this prevents students from re-entering the browser-incompatible scenario transition.
- Keep the standard launcher action pointed at the native main menu.

## Full release smoke matrix

Use Computer Use for the visible interaction rows. Record pass/fail and concise evidence after each run.

| Area | Required check | Status | Evidence |
| --- | --- | --- | --- |
| Access | Anonymous origin remains `401`; authenticated launcher loads | pass | Server deployment gate returned anonymous HTTP 401 and healthy Caddy container |
| Identity | Launcher footer shows expected site commit and engine | pass | Computer Use showed site `3905423683` and OpenRCT2 `v0.5.3-49-g9de2d43fb6` before the hardening candidate |
| Asset delivery | Launcher reports school files ready without ZIP upload | pass | Computer Use showed automatic install version `955cb0b39334` and stored-private status |
| Default startup | Standard route reaches native OpenRCT2 title menu | pending | |
| Magic Mountain | Direct route renders the actual park and stays responsive for at least 60 seconds | pass | Commit `3905423` visibly rendered the real 2,781-guest park; pause click worked and the user confirmed animation after resume |
| Mouse | Click, hover, edge scroll/pan, wheel zoom, and window close work | pending | |
| Keyboard | Pause/unpause, zoom, rotate/view control, and escape/window dismissal work | pending | |
| Sandbox | Unlimited cash and unrestricted/sandbox build controls activate | pending | |
| Construction | Open construction, select an item, place it, and cancel the tool | pending | |
| Save cycle | Save the park, return to title/load flow, and reopen it | pending | |
| Regression | Another built-in scenario opens and accepts controls | pending | |
| Stability | No black screen, renderer crash, or input lock during the complete session | pending | |

## Automated gates

- `npm run check`: 30 tests plus proprietary-asset scan, engine verification, typecheck, and production build.
- `npm run test:e2e -- --workers=1`: launcher accessibility, production-shaped engine boot/save/offline reload, and cache-update persistence. The separately supplied licensed-ZIP test is skipped when its out-of-repository fixture is unavailable locally.
- Isolated fast E2E: 3 passed, 1 licensed-fixture skip, 17.1 seconds. Accessibility, keyboard dialog control, 200% layout, engine boot, save export/erase/restore, offline reload, and app-update persistence passed.
- Full licensed E2E: the exact 705 MB school package imported more than 2,000 files, opened the real OpenRCT2 main menu, rejected any HTML game-controls overlay, and accepted native pause/resume canvas clicks. The test passed in 23 seconds; Playwright's deletion of the temporary 785 MB profile extended total process wall time to 9.1 minutes.
- E2E preview servers are never reused unless `PLAYWRIGHT_REUSE_SERVER=1` is explicitly set. This prevents a stale localhost release from producing false passes or reintroducing the retired game-controls overlay.
- The real 705 MB package exposed duplicate decompression and per-file IDBFS persistence in the importer. The hardening candidate now checks CRC-32 during the single extraction pass, keeps staging in memory, batches the RCT/OpenRCT2 IDBFS commit, and removes the redundant staging sync.

## Test discipline

- Keep one heavy game tab open at a time.
- Re-observe the window after every state-changing Computer Use action; never reuse stale coordinates.
- Do not mark this release complete until the Magic Mountain direct route is visibly playable and the matrix above has concrete results.
