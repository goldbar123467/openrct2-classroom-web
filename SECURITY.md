# Security policy

Please report suspected vulnerabilities privately to the repository owner rather than opening a public issue that exposes student data, malicious ZIP details, or an active deployment weakness.

Include the affected commit/deployment, ChromeOS/browser version, reproduction steps, console/network evidence with secrets removed, and expected impact. Do not include proprietary RCT2 files or student save data.

Production promotion is blocked by high or critical findings. Supported releases are the currently linked Vercel production deployment and the immediately previous rollback deployment.

## Automated release gates

`npm run verify:security` blocks on high/critical npm advisories, known credential formats or long assigned secrets in the current tree and Git history, missing/disallowed dependency licenses, or an invalid/incomplete CycloneDX SBOM. Secret findings report only the rule and location; values are deliberately suppressed.

`npm run check` separately verifies the pinned engine hashes, rejects likely proprietary RCT/RCT2 content, runs the hostile ZIP and atomic save-recovery corpus, checks local/Vercel header parity, type-checks, and builds production output. `npm run test:e2e` then proves wrapper accessibility, same-origin-only requests, the real Lite WebAssembly boot, exact engine caching, and a controlled offline reload.
