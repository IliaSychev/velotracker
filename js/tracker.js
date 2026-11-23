// Запись поездки: GPS → фильтр → дистанция, время, скорость, автопауза,
// отрезки, калории. Точки сразу пишутся в IndexedDB, поэтому поездка
// переживает закрытие вкладки или перезагрузку телефона.
//
// Точка трека: [t, lat, lon, скорость км/ч, дистанция м, время в движении с, начало_сегмента]
// «Сегмент» начинается после ручной паузы или потери сигнала — чтобы на карте
// не было прямой «телепортации», а в дистанцию не шёл прыжок.

import { haversine, cyclingMET, rideName } from './util.js';
import * as db from './db.js';

const MAX_ACC = 30;          // м: хуже — точку игнорируем
const MAX_SPEED = 25;        // м/с (90 км/ч): быстрее — это прыжок GPS
const GAP_SEC = 30;          // разрыв дольше — новый сегмент
const STOP_SPEED = 0.8;      // м/с ≈ 3 км/ч — считаем, что стоим
const GO_SPEED = 1.4;        // м/с ≈ 5 км/ч — поехали
const STOP_HOLD = 5000;      // мс медленнее STOP_SPEED до автопаузы
const NO_GPS_MS = 15000;     // нет точек дольше — «сигнал потерян»

export const T = { DIST: 4, MOV: 5, SEG: 6, SPD: 3 };

export class Tracker extends EventTarget {
  constructor({ replay = false } = {}) {
    super();
    this.replay = replay;     // пересчёт готового трека (импорт GPX): без GPS, базы и таймеров
    this.gapSec = GAP_SEC;
    this.settings = { ...db.DEFAULTS };
    this.reset();
    this.watchId = null;
    this.gps = { acc: null, at: 0, lost: false };
    this.sim = null;
    if (!replay) setInterval(() => this.checkGps(), 3000);
  }

  reset() {
    this.status = 'idle';     // idle | recording | paused
    this.autoPaused = false;
    this.id = null;
    this.start = 0;
    this.elapsed = 0;         // мс записи без ручных пауз (до resumeAt)
    this.resumeAt = 0;
    this.dist = 0;
    this.moving = 0;
    this.maxSpeed = 0;
    this.kcal = 0;
    this.speed = 0;
    this.laps = [];
    this.lapStartDist = 0;
    this.lapStartMoving = 0;
    this.nextVoiceKm = 0;
    this.points = [];
    this.last = null;
    this.speedBuf = [];
    this.slowSince = null;
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  // ───────── GPS ─────────

  startGps() {
    if (this.watchId != null || this.sim) return;
    const simParam = new URLSearchParams(location.search).get('sim');
    if (simParam) { this.sim = startSim(Number(simParam) || 1, (p) => this.onFix(p)); return; }
    if (!('geolocation' in navigator)) { this.emit('gpserror', 'Браузер не поддерживает геолокацию'); return; }
    this.watchId = navigator.geolocation.watchPosition(
      (p) => this.onFix(p),
      (e) => this.emit('gpserror', e.code === 1 ? 'Нет доступа к геолокации. Разрешите её в настройках Safari.' : 'GPS недоступен'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
  }

  stopGps() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  checkGps() {
    const lost = this.gps.at > 0 && Date.now() - this.gps.at > NO_GPS_MS;
    if (lost !== this.gps.lost) {
      this.gps.lost = lost;
      this.emit('gps', this.gps);
      if (this.status === 'recording') this.emit(lost ? 'gpslost' : 'gpsback');
    }
  }

  onFix(pos) {
    const c = pos.coords;
    const t = pos.timestamp || Date.now();
    this.gps = { acc: c.accuracy, at: Date.now(), lost: false, lat: c.latitude, lon: c.longitude };
    this.emit('gps', this.gps);
    if (this.status !== 'recording') return;
    if (c.accuracy > MAX_ACC) return;

    const cur = { t, lat: c.latitude, lon: c.longitude };
    if (!this.last) {
      this.last = cur;
      this.speedBuf = [];
      this.addPoint(cur, 0, 1);
      return;
    }
    const dt = (t - this.last.t) / 1000;
    if (dt < 0.5) return;
    const d = haversine(this.last.lat, this.last.lon, cur.lat, cur.lon);

    if (dt > this.gapSec) {               // долго не было сигнала — новый сегмент
      this.last = cur;
      this.speedBuf = [];
      this.speed = 0;
      this.addPoint(cur, 0, 1);
      return;
    }
    const implied = d / dt;
    if (implied > MAX_SPEED) return;  // прыжок GPS, точку выбрасываем

    const raw = c.speed != null && c.speed >= 0 ? c.speed : implied;
    this.speedBuf.push(raw);
    if (this.speedBuf.length > 3) this.speedBuf.shift();
    const sm = median(this.speedBuf);

    if (this.settings.autopause) {
      if (sm < STOP_SPEED) {
        this.slowSince ??= t;
        if (!this.autoPaused && t - this.slowSince >= STOP_HOLD) {
          this.autoPaused = true;
          this.speed = 0;
          this.emit('autopause', true);
        }
      } else {
        this.slowSince = null;
        if (this.autoPaused && sm > GO_SPEED) {
          this.autoPaused = false;
          this.emit('autopause', false);
        }
      }
      if (this.autoPaused) { this.last = cur; return; }
    }

    this.dist += d;
    this.moving += dt;
    this.speed = sm * 3.6;
    this.kcal += (cyclingMET(this.speed) * this.settings.weight * dt) / 3600;
    if (c.accuracy <= 20 && this.speedBuf.length === 3) this.maxSpeed = Math.max(this.maxSpeed, this.speed);
    this.last = cur;
    this.addPoint(cur, this.speed, 0);

    const lapLen = this.settings.lapKm * 1000;
    if (lapLen > 0 && this.dist - this.lapStartDist >= lapLen) this.closeLap(true);

    const every = this.settings.voiceEveryKm;
    if (every > 0 && this.dist >= this.nextVoiceKm * 1000) {
      this.emit('km', { km: this.nextVoiceKm });
      this.nextVoiceKm += every;
    }
  }

  addPoint(cur, speed, seg) {
    const p = [cur.t, +cur.lat.toFixed(6), +cur.lon.toFixed(6), Math.round(speed * 10) / 10, Math.round(this.dist), Math.round(this.moving * 10) / 10, seg];
    this.points.push(p);
    if (!this.replay) db.liveAdd(p).catch(() => {});
    this.emit('point', p);
  }

  // ───────── Управление ─────────

  async begin() {
    this.reset();
    this.id = 'r' + Date.now();
    this.start = Date.now();
    this.resumeAt = this.start;
    this.status = 'recording';
    this.nextVoiceKm = this.settings.voiceEveryKm || 0;
    await db.liveClear();
    this.saveState();
    this.startGps();
    this.emit('status');
  }

  pause() {
    if (this.status !== 'recording') return;
    this.elapsed += Date.now() - this.resumeAt;
    this.status = 'paused';
    this.autoPaused = false;
    this.last = null;      // следующая точка начнёт новый сегмент
    this.speed = 0;
    this.saveState();
    this.emit('status');
  }

  resume() {
    if (this.status !== 'paused') return;
    this.resumeAt = Date.now();
    this.status = 'recording';
    this.saveState();
    this.emit('status');
  }

  closeLap(auto) {
    const dist = this.dist - this.lapStartDist;
    if (!auto && dist < 20) return null;
    const lap = { n: this.laps.length + 1, dist, time: this.moving - this.lapStartMoving, auto, endDist: this.dist };
    this.laps.push(lap);
    this.lapStartDist = this.dist;
    this.lapStartMoving = this.moving;
    this.saveState();
    this.emit('lap', lap);
    return lap;
  }

  totalMs() {
    return this.elapsed + (this.status === 'recording' ? Date.now() - this.resumeAt : 0);
  }

  lapNow() {
    return { n: this.laps.length + 1, dist: this.dist - this.lapStartDist, time: this.moving - this.lapStartMoving };
  }

  /** Завершить и сохранить. Возвращает поездку (или null, если записывать нечего). */
  async finish() {
    if (this.status === 'recording') this.elapsed += Date.now() - this.resumeAt;
    if (this.dist - this.lapStartDist >= 50 && this.laps.length) {
      const lap = this.closeLap(false);
      if (lap) lap.finish = true;
    }
    const ride = this.dist >= 50 ? buildRide(this) : null;
    if (ride) await db.ridePut(ride);
    await db.kvDel('active');
    await db.liveClear();
    this.reset();
    this.emit('status');
    return ride;
  }

  async discard() {
    await db.kvDel('active');
    await db.liveClear();
    this.reset();
    this.emit('status');
  }

  // ───────── Восстановление после закрытия ─────────

  saveState() {
    if (this.status === 'idle' || this.replay) return;
    const { id, start, dist, moving, maxSpeed, kcal, laps, lapStartDist, lapStartMoving, nextVoiceKm } = this;
    db.kvSet('active', {
      id, start, dist, moving, maxSpeed, kcal, laps, lapStartDist, lapStartMoving, nextVoiceKm,
      elapsed: this.totalMs(), savedAt: Date.now(),
    }).catch(() => {});
  }

  /** Есть ли незаконченная поездка. Восстанавливает её в состоянии «пауза». */
  async restore() {
    const st = await db.kvGet('active');
    if (!st) return false;
    this.reset();
    Object.assign(this, st);
    this.points = await db.liveAll();
    // Состояние сохраняется раз в 5 с, а точки — каждая; берём то, что свежее.
    const lastP = this.points.at(-1);
    if (lastP) {
      this.dist = Math.max(this.dist, lastP[T.DIST]);
      this.moving = Math.max(this.moving, lastP[T.MOV]);
    }
    this.status = 'paused';
    this.emit('status');
    return true;
  }
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

// ───────── Итог поездки ─────────

export const EFFORTS = [1000, 5000, 10000, 20000, 40000];

/** Лучшее время на дистанции внутри поездки (по времени в движении). */
export function bestEfforts(points) {
  const res = {};
  for (const D of EFFORTS) {
    let best = null, i = 0;
    for (let j = 0; j < points.length; j++) {
      while (i + 1 < j && points[j][T.DIST] - points[i + 1][T.DIST] >= D) i++;
      const dd = points[j][T.DIST] - points[i][T.DIST];
      if (dd >= D) {
        const tt = ((points[j][T.MOV] - points[i][T.MOV]) * D) / dd;
        if (tt > 0 && (best == null || tt < best)) best = tt;
      }
    }
    if (best != null) res[D] = Math.round(best);
  }
  return res;
}

function buildRide(tr) {
  const points = tr.points;
  return {
    id: tr.id,
    name: rideName(tr.start),
    start: tr.start,
    end: points.length ? points[points.length - 1][0] : Date.now(),
    dist: Math.round(tr.dist),
    moving: Math.round(tr.moving),
    total: Math.round(tr.elapsed / 1000),
    avg: tr.moving > 0 ? (tr.dist / tr.moving) * 3.6 : 0,
    max: Math.round(tr.maxSpeed * 10) / 10,
    kcal: Math.round(tr.kcal),
    laps: tr.laps,
    efforts: bestEfforts(points),
    points,
  };
}

// ───────── Поездка из готового трека (импорт GPX) ─────────

/**
 * Прогнать точки чужого трека через тот же фильтр, автопаузу и отрезки,
 * что и живую запись. segs — массив сегментов [{t, lat, lon, speed?}].
 * Между сегментами — как ручная пауза: время и дистанция не считаются.
 */
export function rideFromTrack(segs, settings, extra = {}) {
  const tr = new Tracker({ replay: true });
  tr.settings = { ...db.DEFAULTS, ...settings };
  tr.gapSec = 120;   // приложения в фоне пишут реже — короткие провалы не рвут трек
  segs = segs.filter((s) => s.length);
  if (!segs.length) return null;
  tr.start = segs[0][0].t;
  tr.id = 'g' + tr.start;
  tr.status = 'recording';
  for (const seg of segs) {
    tr.last = null;
    tr.speedBuf = [];
    tr.slowSince = null;
    tr.autoPaused = false;
    tr.speed = 0;
    for (const p of seg) {
      tr.onFix({ timestamp: p.t, coords: { latitude: p.lat, longitude: p.lon, accuracy: 10, speed: p.speed ?? null } });
    }
    tr.elapsed += seg.at(-1).t - seg[0].t;
  }
  if (tr.dist - tr.lapStartDist >= 50 && tr.laps.length) {
    const lap = tr.closeLap(false);
    if (lap) lap.finish = true;
  }
  if (tr.dist < 50) return null;
  return { ...buildRide(tr), ...extra };
}

// ───────── Симулятор для проверки без велосипеда: ?sim=1 (или ?sim=5 — в 5 раз быстрее) ─────────

function startSim(factor, cb) {
  // Круг вокруг озёр Палермо и по Авенида Фигероа Алькорта.
  const route = [
    [-34.5712, -58.4166], [-34.5679, -58.4122], [-34.5651, -58.4152], [-34.5627, -58.4110],
    [-34.5596, -58.4148], [-34.5622, -58.4205], [-34.5668, -58.4256], [-34.5717, -58.4227],
    [-34.5745, -58.4195], [-34.5712, -58.4166],
  ];
  let seg = 0, frac = 0, vt = Date.now(), sec = 0;
  const id = setInterval(() => {
    sec++;
    vt += 1000;
    // 20 секунд стоим на 90-й секунде — проверка автопаузы
    const stopped = sec % 300 > 90 && sec % 300 < 110;
    const v = stopped ? 0 : (22 + 6 * Math.sin(sec / 25)) / 3.6;
    let move = v;
    while (move > 0) {
      const [a, b] = [route[seg], route[(seg + 1) % route.length]];
      const len = haversine(a[0], a[1], b[0], b[1]);
      const left = len * (1 - frac);
      if (move < left) { frac += move / len; move = 0; }
      else { move -= left; seg = (seg + 1) % (route.length - 1); frac = 0; }
    }
    const [a, b] = [route[seg], route[seg + 1]];
    const jitter = () => (Math.random() - 0.5) * 0.00002;
    cb({
      timestamp: vt,
      coords: { latitude: a[0] + (b[0] - a[0]) * frac + jitter(), longitude: a[1] + (b[1] - a[1]) * frac + jitter(), accuracy: 5 + Math.random() * 4, speed: v + (Math.random() - 0.5) * 0.3 },
    });
  }, 1000 / factor);
  return { stop: () => clearInterval(id) };
}
