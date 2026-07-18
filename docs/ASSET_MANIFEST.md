# Asset and license manifest

| Surface | Source | License/status | Distribution |
| --- | --- | --- | --- |
| OpenRCT2 JS/WASM | OpenRCT2 pinned commit | GPLv3+ | Shipped; exact source/build recipe provided |
| OpenRCT2 `data/` objects, language, graphics, sequences | Matching official portable artifact | OpenRCT2 project licenses/notices | Shipped inside `public/engine/assets.zip` |
| Parkworks launcher code and CSS artwork | This repository | GPLv3+ | Shipped as source and build output |
| Original RCT2/RCT Classic data | Student/school-owned installation | Proprietary | Never committed, bundled, uploaded, or publicly served |
| Fonts | Browser/system fonts only | Device-provided | Not distributed |
| Analytics/ads | None | Not applicable | Not present |

`npm run verify:assets` inspects distributable paths and the open-asset ZIP for signatures such as `Data/ch.dat`, `Data/g1.dat`, `ObjData`, legacy scenarios, and legacy track files. This scan is a guardrail, not a substitute for a license review.

OpenRCT2 contributor and license files are preserved at the repository root. Trademark language is displayed in the app and README.
