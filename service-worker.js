// Service worker de Asistencia EMFP10.
//
// Estrategia: "primero red, con respaldo en caché". Con conexión, cada
// pedido va siempre a la red — la respuesta fresca reemplaza en
// silencio lo que había guardado. Sin conexión, se usa lo último que
// haya quedado cacheado. Esto es lo que hace que las actualizaciones
// lleguen solas a cada celular la próxima vez que abran la app con
// señal, sin depender de que alguien se acuerde de subir CACHE_NAME.
//
// CACHE_NAME sigue existiendo para dos cosas que no cambian: (1) tener
// algo que servir la primera vez que se abre sin conexión, y (2)
// limpiar versiones viejas del caché cuando se sube una nueva. Ya no
// es la única forma de que un cambio llegue a los usuarios — conviene
// subirlo igual en cambios grandes, para mantener el caché prolijo.
const CACHE_NAME = 'asistencia-emfp10-v7';

const ARCHIVOS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './logo-emfp10.png'
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
  // Solo maneja el shell de la app (GET, mismo origen). Las llamadas al
  // backend de Apps Script son de otro dominio y siempre van directo a
  // la red — nunca pasan por acá, para no mostrar datos de asistencia
  // viejos.
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(event.request)
      .then(respuestaRed => {
        const copia = respuestaRed.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copia));
        return respuestaRed;
      })
      .catch(() => caches.match(event.request)) // sin señal: usar lo último guardado
  );
});
