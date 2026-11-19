// Офлайн-карта Gran Buenos Aires.
// Файл map/gba.bin скачивается один раз (по кнопке в настройках) и лежит в
// Cache Storage телефона. Дальше карта не тратит ни байта трафика.
// Формат файла: [u32 длина индекса][JSON {index:{"z/x/y":[off,len]}}][gzip-тайлы].
// Данные © OpenStreetMap, сборка Protomaps; отрисовка — MapLibre GL.

import { T } from './tracker.js';

const MAP_URL = new URL('../map/gba.bin', import.meta.url).href;
const MAP_CACHE = 'velo-map-v1';
const BOUNDS = [[-62.0, -37.5], [-56.5, -32.5]];
export const BA_CENTER = [-58.4370, -34.6075];

let blob = null, base = 0, index = null;
let libPromise = null;
let protocolAdded = false;

// ───────── Данные карты ─────────

export async function mapStatus() {
  try {
    const c = await caches.open(MAP_CACHE);
    const r = await c.match(MAP_URL);
    if (!r) return { ready: false };
    return { ready: true, size: Number(r.headers.get('content-length')) || 0 };
  } catch { return { ready: false }; }
}

async function loadIndex() {
  if (index) return true;
  const c = await caches.open(MAP_CACHE);
  const r = await c.match(MAP_URL);
  if (!r) return false;
  blob = await r.blob();
  const len = new DataView(await blob.slice(0, 4).arrayBuffer()).getUint32(0, true);
  const meta = JSON.parse(await blob.slice(4, 4 + len).text());
  base = 4 + len;
  index = meta.index;
  return true;
}

export async function downloadMap(onProgress) {
  const res = await fetch(MAP_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('Сервер ответил ' + res.status);
  const total = Number(res.headers.get('content-length')) || 20_000_000;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(Math.min(1, got / total), got);
  }
  const b = new Blob(chunks, { type: 'application/octet-stream' });
  const c = await caches.open(MAP_CACHE);
  await c.put(MAP_URL, new Response(b, { headers: { 'content-length': String(b.size) } }));
  index = null;
  await loadIndex();
  try { await navigator.storage?.persist?.(); } catch {}
}

export async function deleteMap() {
  await caches.delete(MAP_CACHE);
  blob = null; index = null;
}

async function gunzip(buf) {
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return new Response(stream).arrayBuffer();
}

async function tile(z, x, y) {
  if (!(await loadIndex())) return new ArrayBuffer(0);
  const e = index[`${z}/${x}/${y}`];
  if (!e) return new ArrayBuffer(0);
  const gz = await blob.slice(base + e[0], base + e[0] + e[1]).arrayBuffer();
  return gunzip(gz);
}

// ───────── MapLibre ─────────

function loadLib() {
  if (window.maplibregl) return Promise.resolve();
  libPromise ??= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = new URL('../vendor/maplibre-gl.css', import.meta.url).href;
    document.head.append(css);
    const s = document.createElement('script');
    s.src = new URL('../vendor/maplibre-gl.js', import.meta.url).href;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Не загрузилась библиотека карты'));
    document.head.append(s);
  });
  return libPromise;
}

let layersPromise;
const getLayers = () =>
  (layersPromise ??= fetch(new URL('../map/layers.json', import.meta.url)).then((r) => r.json()));

async function buildStyle() {
  const hasData = await loadIndex().catch(() => false);
  const abs = (p) => new URL(p, import.meta.url).href;
  const style = {
    version: 8,
    glyphs: abs('../map/fonts/') + '{fontstack}/{range}.pbf',
    sprite: abs('../map/sprites/light'),
    sources: {},
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e4e4e8' } }],
  };
  if (hasData) {
    style.sources.protomaps = {
      type: 'vector',
      tiles: ['gba://{z}/{x}/{y}'],
      maxzoom: 14,
      attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> · Protomaps',
    };
    style.layers = await getLayers();
  }
  return { style, hasData };
}

/** Создать карту в контейнере. Возвращает { map, hasData }. */
export async function createMap(container, { center = BA_CENTER, zoom = 12 } = {}) {
  await loadLib();
  if (!protocolAdded) {
    maplibregl.addProtocol('gba', async (params) => {
      const [z, x, y] = params.url.replace('gba://', '').split('/').map(Number);
      return { data: await tile(z, x, y) };
    });
    protocolAdded = true;
  }
  const { style, hasData } = await buildStyle();
  const map = new maplibregl.Map({
    container,
    style,
    center,
    zoom,
    maxBounds: BOUNDS,
    maxZoom: 18,
    attributionControl: { compact: true },
    pitchWithRotate: false,
    dragRotate: false,
    fadeDuration: 0,
  });
  map.touchZoomRotate.disableRotation();
  await new Promise((r) => (map.loaded() ? r() : map.once('load', r)));
  return { map, hasData };
}

// ───────── Трек ─────────

const SPEED_COLORS = ['#2f6fd6', '#1f9d55', '#d9b200', '#e0451f'];

/** Трек, раскрашенный по скорости: синий — медленно, красный — быстро. */
export function drawRideTrack(map, points) {
  const speeds = points.filter((p) => !p[T.SEG] && p[T.SPD] > 3).map((p) => p[T.SPD]).sort((a, b) => a - b);
  const lo = speeds[Math.floor(speeds.length * 0.1)] ?? 0;
  const hi = speeds[Math.floor(speeds.length * 0.9)] ?? 30;
  const features = [];
  for (let i = 1; i < points.length; i += 4) {
    const chunk = [];
    let sum = 0, n = 0;
    for (let j = i - 1; j <= Math.min(i + 4, points.length - 1); j++) {
      if (j > i - 1 && points[j][T.SEG]) break;
      chunk.push([points[j][2], points[j][1]]);
      if (j > i - 1) { sum += points[j][T.SPD]; n++; }
    }
    if (chunk.length < 2) continue;
    const v = hi > lo ? Math.min(1, Math.max(0, (sum / n - lo) / (hi - lo))) : 0.5;
    features.push({ type: 'Feature', properties: { v }, geometry: { type: 'LineString', coordinates: chunk } });
  }
  setSource(map, 'ride', { type: 'FeatureCollection', features });
  if (!map.getLayer('ride-casing')) {
    map.addLayer({ id: 'ride-casing', type: 'line', source: 'ride', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#111114', 'line-width': 7, 'line-opacity': 0.55 } });
    map.addLayer({
      id: 'ride-line', type: 'line', source: 'ride', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-width': 4.5, 'line-color': ['interpolate', ['linear'], ['get', 'v'], 0, SPEED_COLORS[0], 0.35, SPEED_COLORS[1], 0.7, SPEED_COLORS[2], 1, SPEED_COLORS[3]] },
    });
  }
  // Старт и финиш
  const first = points[0], lastP = points[points.length - 1];
  if (first) {
    setSource(map, 'ends', { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { k: 's' }, geometry: { type: 'Point', coordinates: [first[2], first[1]] } },
      { type: 'Feature', properties: { k: 'f' }, geometry: { type: 'Point', coordinates: [lastP[2], lastP[1]] } },
    ] });
    if (!map.getLayer('ends')) map.addLayer({ id: 'ends', type: 'circle', source: 'ends', paint: { 'circle-radius': 6, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff', 'circle-color': ['match', ['get', 'k'], 's', '#1f7a3c', '#b3261e'] } });
  }
  return { lo, hi };
}

export function fitTrack(map, points, padding = 30) {
  if (!points.length) return;
  let w = 180, e = -180, s = 90, n = -90;
  for (const p of points) { w = Math.min(w, p[2]); e = Math.max(e, p[2]); s = Math.min(s, p[1]); n = Math.max(n, p[1]); }
  map.fitBounds([[w, s], [e, n]], { padding, duration: 0, maxZoom: 16 });
}

/** Живой трек текущей поездки (одним цветом) + точка «я здесь». */
export function drawLiveTrack(map, points) {
  const lines = [];
  let cur = [];
  for (const p of points) {
    if (p[T.SEG] && cur.length) { lines.push(cur); cur = []; }
    cur.push([p[2], p[1]]);
  }
  if (cur.length) lines.push(cur);
  setSource(map, 'live', { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } });
  if (!map.getLayer('live-line')) {
    map.addLayer({ id: 'live-casing', type: 'line', source: 'live', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 8 } });
    map.addLayer({ id: 'live-line', type: 'line', source: 'live', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#5151b8', 'line-width': 5 } });
  }
}

export function setMe(map, lon, lat) {
  setSource(map, 'me', { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } });
  if (!map.getLayer('me')) {
    map.addLayer({ id: 'me-halo', type: 'circle', source: 'me', paint: { 'circle-radius': 16, 'circle-color': '#5151b8', 'circle-opacity': 0.18 } });
    map.addLayer({ id: 'me', type: 'circle', source: 'me', paint: { 'circle-radius': 7, 'circle-color': '#5151b8', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff' } });
  }
}

/** Маркер на карте при касании графика. */
export function setCursor(map, lon, lat) {
  if (lon == null) { if (map.getLayer('cursor')) map.setLayoutProperty('cursor', 'visibility', 'none'); return; }
  setSource(map, 'cursor', { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } });
  if (!map.getLayer('cursor')) map.addLayer({ id: 'cursor', type: 'circle', source: 'cursor', paint: { 'circle-radius': 8, 'circle-color': '#111114', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff' } });
  map.setLayoutProperty('cursor', 'visibility', 'visible');
}

function setSource(map, id, data) {
  const s = map.getSource(id);
  if (s) s.setData(data);
  else map.addSource(id, { type: 'geojson', data });
}

export { SPEED_COLORS };
