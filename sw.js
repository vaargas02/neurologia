/* Sube VERSION cada vez que despliegues cambios.
   Tiene que coincidir con app.versionCache en config.json (validar.py lo comprueba). */
const VERSION = 10;
const CACHE = 'estudio-v' + VERSION;

const BASICOS = [
  './', './index.html', './estilos.css', './motor.js',
  './config.json', './contenido.json', './teoria.json',
  './manifest.json', './icono-192.png', './icono-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(BASICOS.map(u => c.add(u).catch(() => null))))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => { if (e.data === 'saltar') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // Los datos se piden a la red primero: así ves el contenido nuevo sin esperar.
  const esDatos = /\.json(\?|$)/.test(url.pathname + url.search);
  if (esDatos) {
    e.respondWith(
      fetch(e.request)
        .then(r => { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return r; })
        .catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const c = res.clone();
      caches.open(CACHE).then(k => k.put(e.request, c));
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
