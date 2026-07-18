# School server deployment

This deployment serves the built Parkworks launcher and the separately mounted licensed-data directory through Cloudflare Tunnel. Caddy listens only on server loopback, while `cloudflared` makes the outbound encrypted connection. The licensed ZIP and manifest never enter Git, the container image, or `dist`.

## Prepare

1. Run `npm ci && npm run check` from the repository root.
2. Copy `deploy/.env.example` to `deploy/.env` on the school server.
3. Set a Basic Auth username, password hash, and the server-only asset directory.
4. Generate the Basic Auth password hash with `caddy hash-password` in an interactive trusted terminal and store only the resulting salted hash as `SCHOOL_BASIC_AUTH_HASH`. Do not place the plaintext password in `.env`, shell history, Git, logs, or client build variables.
5. Put the versioned ZIP and `manifest.json` in `SCHOOL_ASSET_DIR`. The directory is mounted read-only at `/licensed`.

Set these public values only when building the launcher for the protected school server:

```text
VITE_SCHOOL_ASSET_URL=/licensed/rct2-school-pack-<version>.zip
VITE_SCHOOL_ASSET_VERSION=<version>
VITE_SCHOOL_SCENARIO_PATCH_URL=/licensed/six-flags-magic-mountain-web-<version>.park
VITE_SCHOOL_SCENARIO_PATCH_VERSION=<version>
```

They identify protected same-origin downloads and are not secrets. The launcher fetches and installs the package automatically when a student opens the park for the first time, then replaces the legacy Magic Mountain SC6 with the browser-ready `.park` conversion; students do not select or upload either file. Passwords, storage credentials, hashes, and private server paths must never use `VITE_*` variables.

## Launch

From `deploy`, run `docker compose config` to validate substitutions, then `docker compose up -d`. Caddy binds only to `127.0.0.1:8080`, protects every route with Basic Authentication, and marks `/licensed/*` as `private, no-store` at both the browser and Cloudflare cache layers.

Create a remotely managed Cloudflare Tunnel public hostname (for example, `parkworks.example.org`) whose service is `http://localhost:8080`, then install its connector as a system service with the token shown by Cloudflare. No inbound HTTP or HTTPS firewall rule is required.

The service worker explicitly ignores `/licensed/*`; imported data remains in the Chromebook's IndexedDB and does not need to be downloaded again.
