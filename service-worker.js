// Service worker de Asistencia EMFP10.
//
// IMPORTANTE: subí el número de CACHE_NAME cada vez que actualices el
// HTML/CSS/JS de la app (ej: 'asistencia-emfp10-v2'). Si no lo hacés,
// algunos celulares van a seguir viendo la versión vieja cacheada por
// un tiempo después de que subas los cambios.
const CACHE_NAME = 'asistencia-emfp10-v2';

const ARCHIVOS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ARCHIVOS))
      .catch(() => {}) // si falla el precache, la app igual arranca por red
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(nombres =>
      Promise.all(nombres.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Solo cachea el shell de la app (GET, mismo origen). Las llamadas al
  // backend de Apps Script son de otro dominio y siempre van a la red
  // — nunca a caché, para no mostrar datos de asistencia viejos.
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then(cacheado => cacheado || fetch(event.request))
  );
});
