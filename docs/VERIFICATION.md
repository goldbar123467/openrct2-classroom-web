# Production verification matrix

Every line must reference the exact Git commit and Vercel deployment. “Not observed failing” is not proof.

| Gate | Required evidence | Current state |
| --- | --- | --- |
| Shell | 1366×768 + 200% screenshots, no overlap/horizontal overflow | Local 1366×768 passed; 200% pending |
| Isolation | Production header dump, `crossOriginIsolated`, `SharedArrayBuffer` | Local headers/boot passed; production pending |
| Engine | Version, commit, JS/WASM SHA-256, 512 MiB two-worker boot | Passed locally |
| Legal import | Approved licensed ZIP, local-only network trace, delete/re-import | Pending licensed data |
| Gameplay | Scenario start, build/rotate/zoom/pause/speed/menu, objective progress | Pending licensed data |
| Saves | Manual/autosave, reload, browser restart, reboot, app update | Pending real gameplay/device |
| Recovery | Export hashes, erase, restore, identical park/hash; corrupt ZIP rejection | Logic implemented; destructive real-park proof pending |
| Performance | 3 runs: LCP, warm boot, FPS, 1% low, latency, memory, thermals | Pending weakest Chromebook |
| Soak | Two 60-minute sessions on weakest device | Pending |
| Accessibility | axe, keyboard, 200%, forced colors, reduced motion, screen reader | Manual/automated evidence pending |
| Security | no-third-party HAR, CSP/header scan, ZIP corpus, dependency/secret scan | Partial static gates passed |
| Git/Vercel | public repo, Git connection, preview promotion, production URL, rollback | Pending |
| GPL | exact source, build recipe, license/notices, source link | Implemented locally; public availability pending |
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
Vercel deployment ID/URL:
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
