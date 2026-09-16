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
//
// v9: GitHub Pages sirve todo atrás de su CDN (Fastly) con
// Cache-Control: max-age=600 fijo — esa cabecera no se puede
// desactivar ni personalizar en GitHub Pages. Eso significa que el
// fetch() "primero red" de acá abajo podía toparse con una copia de
// hasta 10 minutos de vieja en ese CDN, aunque desde el service worker
// pareciera que fue derecho a la red. Se rompe agregando un parámetro
// de cache-busting (timestamp) a la URL de red: como el CDN cachea por
// URL exacta, una URL que cambia siempre es siempre un cache miss ahí.
// La copia sigue guardándose en el Cache Storage bajo la URL ORIGINAL
// (sin el parámetro), así que el fallback offline (caches.match más
// abajo) no cambia en nada.
//
// v8: bump por el escapeHtml() agregado a index.html (revisión de
// seguridad) + fallback offline agregado acá mismo para navegaciones
// que no matchean una URL cacheada exacta (ver el catch() de fetch).
const CACHE_NAME = 'asistencia-emfp10-v9';

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

  // Cache-busting: ver nota v9 arriba. Solo afecta la URL que se manda
  // a la red — lo que se guarda/busca en el Cache Storage sigue usando
  // event.request (la URL limpia), así que caches.match() de abajo no
  // se entera de este parámetro.
  const urlRed = new URL(event.request.url);
  urlRed.searchParams.set('_sw', Date.now());
  const pedidoRed = new Request(urlRed.toString(), {
    headers: event.request.headers,
    mode: 'same-origin',
    credentials: event.request.credentials
  });

  event.respondWith(
    fetch(pedidoRed)
      .then(respuestaRed => {
        const copia = respuestaRed.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copia));
        return respuestaRed;
      })
      .catch(() =>
        // Sin señal: usar lo último guardado para esa URL exacta. Si es
        // una navegación (abrir la app) y esa URL puntual nunca se
        // cacheó — por ejemplo, un link con ?algo=x abierto por primera
        // vez sin conexión — caer al shell de la app ya cacheado en vez
        // de dejar la pantalla en blanco.
        caches.match(event.request).then(respuestaCache => {
          if (respuestaCache) return respuestaCache;
          if (event.request.mode === 'navigate') return caches.match('./index.html');
          return undefined;
        })
      )
  );
});
