// Cinemion's service worker. It keeps the app itself, so it opens without a connection, and plays downloaded videos
// from Cache Storage: they're stored in pieces (see lib/Offline.ts), and range requests are answered from those
// pieces, so seeking works offline too.

const APP_CACHE = "cn-app-v1";
const MEDIA_CACHE = "cn-media-v1";
const MEDIA_PREFIX = "/offline-media/";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(["/", "/favicon.svg", "/manifest.webmanifest"])).catch(() => { }));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Old versions of the app cache go; downloads stay
    for (const name of await caches.keys()) {
      if (name.startsWith("cn-app-") && name !== APP_CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith(MEDIA_PREFIX)) {
    event.respondWith(media(request, url));
    return;
  }
  // The API is never cached here; downloads keep what they need themselves
  if (url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(page(request));
    return;
  }
  // Built files have the content's hash in their name, so a cached one is always right
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(networkFirst(request));
});

/**
 * Pages: the network first, so updates show up, and the cached app when offline. Every route is the same page.
 */
async function page(request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(APP_CACHE)).put("/", response.clone());
    return response;
  } catch {
    return await caches.match("/", { cacheName: APP_CACHE }) ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { cacheName: APP_CACHE });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(APP_CACHE)).put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(APP_CACHE)).put(request, response.clone());
    return response;
  } catch {
    return await caches.match(request, { cacheName: APP_CACHE }) ?? Response.error();
  }
}

/**
 * A downloaded video, its subtitles or its poster. Videos are put back together from their pieces, for the range
 * asked for.
 * Example: /offline-media/12.720p.d/video, /offline-media/12.720p.d/sub/3.vtt, /offline-media/12.720p.d/poster
 */
async function media(request, url) {
  const cache = await caches.open(MEDIA_CACHE);
  const base = url.pathname.replace(/\/video$/, "");
  if (!url.pathname.endsWith("/video")) return await cache.match(url.pathname) ?? new Response("Not downloaded", { status: 404 });

  const manifestResponse = await cache.match(`${base}/manifest`);
  if (!manifestResponse) return new Response("Not downloaded", { status: 404 });
  const manifest = await manifestResponse.json();
  const size = manifest.size;

  // Example: Range: bytes=1000-  or  bytes=1000-1999
  const range = request.headers.get("Range")?.match(/^bytes=(\d*)-(\d*)$/);
  let start = 0;
  let end = size - 1;
  if (range) {
    if (range[1] === "") start = Math.max(0, size - Number(range[2]));
    else {
      start = Number(range[1]);
      if (range[2] !== "") end = Math.min(Number(range[2]), size - 1);
    }
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }

  // Blobs from the cache are kept on disk, so even a whole film this way doesn't fill the memory
  const parts = [];
  for (let i = Math.floor(start / manifest.chunkSize); i * manifest.chunkSize <= end; i++) {
    const chunk = await cache.match(`${base}/chunk/${i}`);
    if (!chunk) return new Response("Part of the download is missing", { status: 404 });
    const blob = await chunk.blob();
    const chunkStart = i * manifest.chunkSize;
    parts.push(blob.slice(Math.max(0, start - chunkStart), Math.min(blob.size, end - chunkStart + 1)));
  }
  const headers = { "Content-Type": manifest.type, "Accept-Ranges": "bytes", "Content-Length": String(end - start + 1) };
  if (!range) return new Response(new Blob(parts, { type: manifest.type }), { status: 200, headers });
  return new Response(new Blob(parts, { type: manifest.type }), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}` } });
}

// Push notifications: the server sends { title, body, url, tag, icon }, already in words
self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(self.registration.showNotification(message.title || "Cinemion", {
    body: message.body || "",
    icon: message.icon || "/favicon.svg",
    badge: "/favicon.svg",
    // A newer message about the same show replaces the older one
    tag: message.tag || undefined,
    renotify: !!message.tag,
    data: { url: message.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil((async () => {
    // An open Cinemion goes to the title; otherwise a new window opens there
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      if ("navigate" in open) await open.navigate(url).catch(() => { });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
