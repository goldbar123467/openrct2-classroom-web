const CACHE_VERSION = "parkworks-v21-9de2d43fb6-magic-mountain-argv";
const SHELL_URLS = ["/manifest.webmanifest", "/parkworks-icon.png"];

async function installShell() {
  const cache = await caches.open(CACHE_VERSION);
  const rootResponse = await fetch("/", { cache: "reload" });
  if (!rootResponse.ok) throw new Error(`Launcher shell returned ${rootResponse.status}.`);
  await cache.put("/", rootResponse.clone());
  const html = await rootResponse.text();
  const entrypoints = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
  await cache.addAll([...SHELL_URLS, ...new Set(entrypoints)]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(installShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Licensed archives always go to the authenticated network origin and never enter Cache Storage.
  if (url.pathname.startsWith("/licensed/")) return;

  if (url.pathname.startsWith("/engine/")) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(request, { ignoreVary: true });
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match("/")) || Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(request, { ignoreVary: true });
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    }),
  );
});
