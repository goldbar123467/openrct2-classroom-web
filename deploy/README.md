# School server deployment

This deployment serves the built Parkworks launcher and the separately mounted licensed-data directory through Cloudflare Tunnel. Caddy listens only on server loopback, while `cloudflared` makes the outbound encrypted connection. The licensed ZIP and manifest never enter Git, the container image, or `dist`.

## Prepare

1. Run `npm ci && npm run check:ci` from the repository root.
2. Copy `deploy/.env.example` to `deploy/.env` on the school server.
3. Set a Basic Auth username, password hash, and the server-only asset directory.
4. Generate the Basic Auth password hash with `caddy hash-password` in an interactive trusted terminal and store only the resulting salted hash as `SCHOOL_BASIC_AUTH_HASH`. Do not place the plaintext password in `.env`, shell history, Git, logs, or client build variables.
5. Put the versioned base-game ZIP, 57-park library ZIP, and library JSON manifest in `SCHOOL_ASSET_DIR`. The directory is mounted read-only at `/licensed`. Keep native worker receipts and diagnostic renders in the private release-evidence directory; they are not deployment inputs.

Set these public values only when building the launcher for the protected school server:

```text
VITE_SCHOOL_ASSET_URL=/licensed/rct2-school-pack-<version>.zip
VITE_SCHOOL_ASSET_VERSION=<version>
VITE_SCHOOL_PARK_LIBRARY_MANIFEST_URL=/licensed/park-library-<version>.json
VITE_SCHOOL_PARK_LIBRARY_VERSION=<version>
```

They identify protected same-origin downloads and are not secrets. The launcher fetches and installs the base package and complete verified 57-park library before enabling native menu play. Library upgrades are staged and swapped atomically; failures retain the previous verified version. Students do not select or upload these files. Passwords, storage credentials, hashes, and private server paths must never use `VITE_*` variables.

## Launch

From `deploy`, run `docker compose config` to validate substitutions, then `docker compose up -d`. Caddy binds only to `127.0.0.1:8080`, protects every route with Basic Authentication, and marks `/licensed/*` as `private, no-store` at both the browser and Cloudflare cache layers.

Create a remotely managed Cloudflare Tunnel public hostname (for example, `parkworks.example.org`) whose service is `http://localhost:8080`, then install its connector as a system service with the token shown by Cloudflare. No inbound HTTP or HTTPS firewall rule is required.

The service worker explicitly ignores `/licensed/*`; imported data remains in the Chromebook's IndexedDB and does not need to be downloaded again.
