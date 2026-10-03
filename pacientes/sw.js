/**
 * Service worker del portal de pacientes.
 * Guarda SOLO la "cáscara" del portal (pantallas, estilos, íconos) para que abra rápido
 * y se pueda instalar. Nunca guarda datos del paciente: los pedidos al servidor
 * (turnos, estudios, archivos) siempre van directo a internet.
 */
const VERSION = 'passo-pacientes-v7';
const CASCARA = ['./', './index.html', './styles.css?v=6', './iconos.js?v=2', './plantillas.js?v=1', './app.js?v=7', './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CASCARA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Solo archivos propios de /pacientes/ y solo GET. Todo lo demás (API, estudios, fuentes) va directo a la red.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  e.respondWith(
    fetch(e.request)
      .then(r => { if (r.ok) { const copia = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copia)); } return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: false }).then(r => r || caches.match('./index.html')))
  );
});
