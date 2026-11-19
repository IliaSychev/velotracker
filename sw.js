// Сервис-воркер: всё приложение лежит в кэше и открывается без сети.
// Файл карты (map/gba.bin) сюда не входит — он скачивается отдельно по
// кнопке в настройках и хранится в своём кэше (velo-map-v1).
// При изменении файлов приложения увеличьте VERSION.

const VERSION = 'v1.0.0';
const APP_CACHE = 'velo-app-' + VERSION;

const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'].flatMap((f) =>
  ['0-255', '256-511', '8192-8447'].map((r) => `map/fonts/${encodeURIComponent(f)}/${r}.pbf`));

const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/tracker.js', 'js/voice.js', 'js/awake.js', 'js/silent-video.js',
  'js/map.js', 'js/chart.js', 'js/files.js', 'js/stats.js', 'js/util.js', 'js/icons.js',
  'vendor/maplibre-gl.js', 'vendor/maplibre-gl.css',
  'map/layers.json', 'map/sprites/light.json', 'map/sprites/light.png', 'map/sprites/light@2x.json', 'map/sprites/light@2x.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon.png',
  ...FONTS,
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('velo-app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // Карту отдаёт сама страница из своего кэша; запрос на скачивание идёт мимо.
  if (url.pathname.endsWith('/map/gba.bin')) return;
  // Сначала кэш — ноль трафика; чего нет — из сети (и в кэш).
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(APP_CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
