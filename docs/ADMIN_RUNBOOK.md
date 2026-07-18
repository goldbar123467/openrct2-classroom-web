# Admin and maintainer runbook

## Provisional hardware floor

Until the district inventory is recorded, treat the floor as 4 GB RAM, 32 GB local storage, 1366×768, and an Intel Celeron N4020/N4500-class or MediaTek MT8183/Kompanio-class CPU. This is a test target, not a claim of support.

Record for each fleet class:

| Field | Value |
| --- | --- |
| Manufacturer/model |  |
| CPU/architecture |  |
| RAM |  |
| Total/free storage |  |
| Display resolution |  |
| ChromeOS version/channel |  |
| Auto-update expiration |  |
| Managed filter/proxy |  |

## Required browser and network behavior

Allow HTTPS access to the single Parkworks origin. The origin must return these headers for HTML, JS, WASM, workers, and cached responses:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
Origin-Agent-Cluster: ?1
X-Content-Type-Options: nosniff
```

The `.wasm` response must use `Content-Type: application/wasm`. Proxies and classroom filters must not strip COOP/COEP. `SharedArrayBuffer` and WebGL2 must remain enabled. No third-party runtime domains are required.

## Storage planning

- Static website cache: approximately 85 MB.
- Open-source engine data in IndexedDB: approximately 80 MB.
- Original RCT2 installation: commonly hundreds of MB, depending on edition and included media.
- Saves: roughly 0.5–7 MB each before custom-object growth.
- Recommended free local capacity before first import: at least 1.5 GB.

The importer checks browser quota and rejects ZIPs over 1.25 GB, more than 12,000 entries, or more than 1.6 GB expanded content.

## Vercel release procedure

1. Confirm `main` points to the reviewed GitHub commit.
2. Run `npm ci` and `npm run check` from a clean clone.
3. Deploy a preview from that exact commit.
4. Verify headers, MIME, shell UX, engine boot, licensed import, save/reload, and backup restore on the weakest Chromebook.
5. Promote the tested preview rather than rebuilding a different production artifact.
6. Record commit, deployment ID, URL, date, tester, device, and evidence links in `docs/evidence/`.

## Rollback

Use Vercel’s deployment history to promote the last known-good deployment. Confirm its engine hash against that release’s `scripts/engine-manifest.json`. Preserve the broken deployment URL and logs for diagnosis.

After rollback, dispatch **Production deployment gate** for the rollback commit or run the external Playwright probe manually. A rollback is not complete until the live commit marker, all distribution hashes, response headers, IDBFS reload, backup restore, and offline shell pass. Record the drill in `docs/evidence/`.

## Release monitoring and limits

- Check the Vercel project transfer, build, and deployment usage before each classroom term and after any unexpected traffic spike.
- Keep the immediately previous READY deployment available until the new release passes the production gate and one classroom pilot.
- Review production browser evidence and Vercel runtime/build logs after every release. This static project intentionally has no student analytics or third-party telemetry.
- Assign a named maintainer and backup maintainer for GitHub/Vercel, plus separate owners for licensing, ChromeOS policy, accessibility/accommodations, and classroom incident response.
- Set a documented transfer/budget alert threshold in the district account. The repository cannot choose or approve that threshold on the district's behalf.

## Upstream engine update

1. Review the OpenRCT2 release and license changes.
2. Pin an exact upstream commit and successful Actions run.
3. Update `scripts/sync-engine.ps1` and the source commit in code/docs.
4. Rebuild with Docker from the pinned source using the 512 MiB initial memory, 2 GiB maximum, and four-worker compile cap.
5. Run `scripts/patch-engine.mjs`, update all SHA-256 values, and rerun every gate.
6. Treat the update as a new release requiring real-device gameplay and restore tests.

## School-server alternative

The Vite `dist/` directory can be served by a school-controlled HTTPS static server. Preserve every security/isolation header from `vercel.json`, correct WASM MIME, range requests, and immutable cache behavior for versioned engine files. A school server can reduce external bandwidth and improve access control; it does not lower each Chromebook’s runtime memory/CPU requirement and does not create rights to redistribute RCT2 data.

## Support ownership

Assign named owners before rollout for license verification, Vercel/GitHub maintenance, ChromeOS policy, classroom support, and data-loss incidents. A repository without an accountable owner is not production-ready for students.
