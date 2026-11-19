// Статистика по периодам и личные рекорды.
import { weekStart, monthStart, fmtKm, fmtDur, fmtSpeed, fmtNum } from './util.js';
import { EFFORTS } from './tracker.js';

export function totals(rides) {
  const t = { count: rides.length, dist: 0, moving: 0, kcal: 0 };
  for (const r of rides) { t.dist += r.dist; t.moving += r.moving; t.kcal += r.kcal || 0; }
  t.avg = t.moving ? (t.dist / t.moving) * 3.6 : 0;
  return t;
}

export function periodStart(kind, now = Date.now()) {
  const d = new Date(now);
  if (kind === 'week') return weekStart(now);
  if (kind === 'month') return monthStart(now);
  if (kind === 'year') return new Date(d.getFullYear(), 0, 1).getTime();
  return 0;
}

/** Ряды для столбиков: последние 12 недель / дни месяца / месяцы года / годы. */
export function series(rides, kind, now = Date.now()) {
  const out = [];
  if (kind === 'week') {
    const ws = weekStart(now);
    const DAY = 86400000;
    ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].forEach((label, i) => {
      const a = new Date(ws); a.setDate(a.getDate() + i);
      const b = new Date(a); b.setDate(b.getDate() + 1);
      out.push({ label, value: sumKm(rides, a.getTime(), b.getTime()), hi: now >= a && now < b });
    });
    void DAY;
  } else if (kind === 'month') {
    // по неделям последних 12 недель
    const ws = weekStart(now);
    for (let i = 11; i >= 0; i--) {
      const a = new Date(ws); a.setDate(a.getDate() - 7 * i);
      const b = new Date(a); b.setDate(b.getDate() + 7);
      out.push({ label: `${a.getDate()}.${a.getMonth() + 1}`, value: sumKm(rides, a.getTime(), b.getTime()), hi: i === 0 });
    }
  } else if (kind === 'year') {
    const y = new Date(now).getFullYear();
    'ЯФМАМИИАСОНД'.split('').forEach((label, m) => {
      out.push({ label, value: sumKm(rides, new Date(y, m, 1).getTime(), new Date(y, m + 1, 1).getTime()), hi: m === new Date(now).getMonth() });
    });
  } else {
    const years = rides.length ? [...new Set(rides.map((r) => new Date(r.start).getFullYear()))].sort() : [new Date(now).getFullYear()];
    for (let y = years[0]; y <= new Date(now).getFullYear(); y++) {
      out.push({ label: String(y), value: sumKm(rides, new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()), hi: y === new Date(now).getFullYear() });
    }
  }
  return out;
}

const sumKm = (rides, a, b) => rides.filter((r) => r.start >= a && r.start < b).reduce((s, r) => s + r.dist, 0) / 1000;

const EFFORT_NAMES = { 1000: '1 км', 5000: '5 км', 10000: '10 км', 20000: '20 км', 40000: '40 км' };

/**
 * Личные рекорды. Каждый: { key, title, value (число), text, rideId, start }.
 * better(a,b) — больше лучше, кроме времени на дистанции.
 */
export function records(rides) {
  const recs = [];
  const top = (key, title, getter, fmt, lowerBetter = false, filter = () => true) => {
    let best = null;
    for (const r of rides) {
      if (!filter(r)) continue;
      const v = getter(r);
      if (v == null || !isFinite(v) || v <= 0) continue;
      if (!best || (lowerBetter ? v < best.value : v > best.value)) best = { key, title, value: v, text: fmt(v), rideId: r.id, start: r.start, lowerBetter };
    }
    if (best) recs.push(best);
  };
  top('dist', 'Самая длинная поездка', (r) => r.dist, (v) => fmtKm(v, 1) + ' км');
  top('moving', 'Дольше всего в седле', (r) => r.moving, fmtDur);
  top('avg', 'Лучшая средняя (от 5 км)', (r) => r.avg, (v) => fmtSpeed(v) + ' км/ч', false, (r) => r.dist >= 5000);
  top('max', 'Максимальная скорость', (r) => r.max, (v) => fmtSpeed(v) + ' км/ч');
  for (const D of EFFORTS) {
    top('e' + D, 'Быстрее всего ' + EFFORT_NAMES[D], (r) => r.efforts?.[D], (v) => `${fmtDur(v)} · ${fmtNum((D / v) * 3.6, 1)} км/ч`, true);
  }
  // Лучшая неделя и месяц по километражу
  const byWeek = new Map(), byMonth = new Map();
  for (const r of rides) {
    const w = weekStart(r.start), m = monthStart(r.start);
    byWeek.set(w, (byWeek.get(w) || 0) + r.dist);
    byMonth.set(m, (byMonth.get(m) || 0) + r.dist);
  }
  const bestOf = (map, key, title) => {
    let b = null;
    for (const [k, v] of map) if (!b || v > b.value) b = { key, title, value: v, text: fmtKm(v, 1) + ' км', start: k };
    if (b) recs.push(b);
  };
  bestOf(byWeek, 'week', 'Лучшая неделя');
  bestOf(byMonth, 'month', 'Лучший месяц');
  return recs;
}

/** Какие рекорды побила новая поездка (сравнение с историей без неё). */
export function newRecords(ride, otherRides) {
  if (!otherRides.length) return [];
  const before = new Map(records(otherRides).map((r) => [r.key, r]));
  const after = records([...otherRides, ride]);
  return after.filter((r) => {
    if (r.key === 'week' || r.key === 'month') return false;
    const b = before.get(r.key);
    return r.rideId === ride.id && (!b || (r.lowerBetter ? r.value < b.value : r.value > b.value));
  });
}
