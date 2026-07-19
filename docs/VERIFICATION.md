# Production verification matrix

Every line must reference the exact Git commit and deployment URL. “Not observed failing” is not proof.

| Gate | Required evidence | Current state |
| --- | --- | --- |
| Shell | 1366×768 + 200% screenshots, no overlap/horizontal overflow | Automated Chromium viewport/overflow and axe checks passed; manual screenshot archive pending |
| Isolation | Production header dump, `crossOriginIsolated`, `SharedArrayBuffer` | Local response and live production passed; config parity is unit-tested |
| Engine | Version, commit, JS/WASM SHA-256, 512 MiB two-worker boot | Exact hashes and real Lite boot passed in Chromium |
| Authorized import | Protected school package, same-origin network trace, automatic install, local persistence | Prior protected package passed live; the new 57-park library is pending exact-release verification |
| Gameplay | Retry-free 57/57 native-menu matrix, native controls, sustained animation | Electric Fields native preflight passed; complete 57-park matrix is pending |
| Saves | Manual/autosave, reload, browser restart, reboot, app update | Real IDBFS synthetic `.park` reload, full Chromium profile close/relaunch, cached offline engine restart, and simulated service-worker cache upgrade passed; 57-park save/reload proof is pending |
| Recovery | Export hashes, erase, restore, identical park/hash; corrupt ZIP rejection | Real browser UI export/erase/restore passed with exact synthetic bytes; corrupt/rollback corpus passed; real-park proof pending |
| Performance | 3 runs: LCP, warm boot, FPS, 1% low, latency, memory, thermals | Pending weakest Chromebook |
| Soak | Two 60-minute sessions on weakest device | Pending |
| Accessibility | axe, keyboard, 200%, forced colors, reduced motion, screen reader | Automated wrapper gates passed with zero axe violations; manual screen-reader pass pending |
| Security | no-third-party HAR, CSP/header scan, ZIP corpus, dependency/secret scan | Same-origin browser trace, header parity, ZIP corpus, audit, history secret scan, licenses, and SBOM passed locally |
| Git/deployment | public repo, protected production URL, rollback | Cloudflare Tunnel, loopback-only Caddy origin, Basic Auth, automatic school package delivery, and public HTTPS URL are live; the earlier Vercel release remains the static rollback |
| GPL | exact source, build recipe, license/notices, source link | Clean pinned-container source build verifies memory/worker contracts and boots its freshly generated JS/WASM pair; tracked release hashes are gated separately |
| Handoff | teacher/admin/student docs and clean-clone rehearsal | Docs implemented; second-person rehearsal pending |

## Provisional performance targets

- Shell LCP ≤ 2.5 seconds; visible response ≤ 1 second.
- Warm cached boot to playable ≤ 15 seconds.
- Medium park average ≥ 30 FPS, 1% low ≥ 20 FPS.
- p95 input latency ≤ 100 ms.
- Peak tab working set ≤ 1.25 GB and ≤ 50% of physical RAM.
- No tab discard, OOM, multi-second recurring stalls, or thermal collapse in 60 minutes.

## Evidence record template

```text
Date/time:
Tester:
Git commit:
Deployment ID/URL:
Chromebook model/CPU/RAM/storage/screen:
ChromeOS version/channel:
RCT2 license/source record:
Scenario/save tested:
Cold/warm results:
FPS/input/memory/thermal results:
Console/network/header artifacts:
Backup source and restored SHA-256 manifest:
Pass/fail and open defects:
```
