// Экспорт GPX (для Strava, Komoot, Garmin) и резервная копия всей истории.
import { T, rideFromTrack } from './tracker.js';
import * as db from './db.js';

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

export function rideToGpx(ride) {
  const segs = [];
  let cur = [];
  for (const p of ride.points) {
    if (p[T.SEG] && cur.length) { segs.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length) segs.push(cur);
  const trk = segs
    .map((s) => '    <trkseg>\n' + s.map((p) => `      <trkpt lat="${p[1]}" lon="${p[2]}"><time>${new Date(p[0]).toISOString()}</time></trkpt>`).join('\n') + '\n    </trkseg>')
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Велотрекер" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(ride.name)}</name><time>${new Date(ride.start).toISOString()}</time></metadata>
  <trk>
    <name>${esc(ride.name)}</name>
    <type>cycling</type>
${trk}
  </trk>
</gpx>
`;
}

const stamp = (ts) => {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
};

/**
 * Отдать файл пользователю. На iPhone — через «Поделиться» (сохранить в Файлы,
 * отправить в Telegram, открыть в Strava), иначе — обычная загрузка.
 */
export async function saveFile(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return 'downloaded';
}

export const exportGpx = (ride) => saveFile(`velo_${stamp(ride.start)}.gpx`, rideToGpx(ride), 'application/gpx+xml');

export async function exportBackup() {
  const rides = await db.ridesAll();
  const settings = await db.getSettings();
  const data = { app: 'velotrack', version: 1, created: new Date().toISOString(), settings, rides };
  const res = await saveFile(`velotrack_backup_${stamp(Date.now())}.json`, JSON.stringify(data), 'application/json');
  if (res !== 'cancelled') await db.kvSet('lastBackup', Date.now());
  return { res, count: rides.length };
}

/** Восстановить из копии. Поездки с теми же id перезаписываются, остальные добавляются. */
export async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'velotrack' || !Array.isArray(data.rides)) throw new Error('Это не резервная копия велотрекера');
  const ok = data.rides.filter((r) => r && r.id && Array.isArray(r.points));
  await db.putManyRides(ok);
  if (data.settings) await db.saveSettings({ ...(await db.getSettings()), ...data.settings });
  return ok.length;
}

// ───────── Импорт GPX (треки из Open GPX Tracker и других приложений) ─────────

/** GPX-текст → сегменты [{t, lat, lon, speed?}]. Точки без времени пропускаются. */
export function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('файл повреждён или это не GPX');
  const kids = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
  const segNodes = kids(doc, 'trkseg');
  const groups = segNodes.length ? segNodes : [doc];
  const segs = [];
  for (const g of groups) {
    const seg = [];
    for (const pt of kids(g, 'trkpt')) {
      const lat = parseFloat(pt.getAttribute('lat'));
      const lon = parseFloat(pt.getAttribute('lon'));
      const t = Date.parse(kids(pt, 'time')[0]?.textContent?.trim() || '');
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(t)) continue;
      const sp = parseFloat(kids(pt, 'speed')[0]?.textContent);
      seg.push({ t, lat, lon, speed: Number.isFinite(sp) && sp >= 0 ? sp : null });
    }
    seg.sort((a, b) => a.t - b.t);
    if (seg.length) segs.push(seg);
  }
  segs.sort((a, b) => a[0].t - b[0].t);
  return segs;
}

/**
 * Импортировать GPX-файлы. Уже загруженные (тот же трек или поездка,
 * пересекающаяся по времени с записанной) пропускаются — поэтому можно
 * каждый раз выбирать всю папку целиком.
 * Возвращает { added: [ride], dup, short, bad: [имя файла] }.
 */
export async function importGpxFiles(files, settings) {
  const existing = await db.ridesSummary();
  const res = { added: [], dup: 0, short: 0, bad: [] };
  for (const f of files) {
    let ride;
    try {
      const segs = parseGpx(await f.text());
      if (!segs.length) throw new Error('нет точек трека');
      ride = rideFromTrack(segs, settings, { source: 'gpx', file: f.name });
    } catch (e) {
      res.bad.push(f.name);
      continue;
    }
    if (!ride) { res.short++; continue; }
    const all = existing.concat(res.added);
    if (all.some((r) => r.id === ride.id || (r.start < ride.end && ride.start < r.end))) { res.dup++; continue; }
    res.added.push(ride);
  }
  if (res.added.length) await db.putManyRides(res.added);
  return res;
}
