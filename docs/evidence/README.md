# Release evidence records

Create one immutable record per promoted or rolled-back production commit. Do not copy proprietary RCT2 files, student saves, tokens, or private district information into this directory.

Each record must include:

- exact Git commit and merged pull request;
- pre-merge Quality gate run and commit-addressed release/browser artifacts;
- Engine source rebuild run and artifact;
- Vercel deployment ID, immutable deployment URL, production alias, and previous READY rollback ID;
- Production deployment gate run, GitHub deployment ID, exact live-file probe, screenshots, and performance JSON;
- tester, device model/specification, ChromeOS version, licensed source record, scenario, save/restore hashes, and pass/fail outcome;
- named licensing, ChromeOS, accessibility, classroom-support, and GitHub/Vercel owners;
- explicit unresolved gates. Missing evidence must say `PENDING`; it must never be inferred from a green automated check.

Use the evidence template in `docs/VERIFICATION.md`. District-sensitive signoffs may link to an access-controlled record instead of being committed publicly.
