// MACC PrintLab — Service Worker
// Caches the app shell so it works offline or when Google Fonts fails

var CACHE = "printlab-v2";
var SHELL = [
  "/macc-printlab/",
  "/macc-printlab/index.html",
];

self.addEventListener("install", function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) { return c.addAll(SHELL); })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function(e) {
  // Only handle GET requests
  if (e.request.method !== "GET") return;
  var url = e.request.url;

  // For Google Fonts — serve from cache if available, fall back to network, fail silently
  if (url.includes("fonts.googleapis.com") || url.includes("fonts.gstatic.com")) {
    e.respondWith(
      caches.open(CACHE).then(function(c) {
        return c.match(e.request).then(function(cached) {
          var fresh = fetch(e.request).then(function(r) { c.put(e.request, r.clone()); return r; }).catch(function() { return cached; });
          return cached || fresh;
        });
      })
    );
    return;
  }

  // For app assets — network first, fall back to cache
  if (url.includes("/macc-printlab/assets/") || url.includes("/macc-printlab/index.html")) {
    e.respondWith(
      fetch(e.request).then(function(r) {
        caches.open(CACHE).then(function(c) { c.put(e.request, r.clone()); });
        return r;
      }).catch(function() {
        return caches.match(e.request).then(function(c) {
          return c || caches.match("/macc-printlab/index.html");
        });
      })
    );
  }
});
