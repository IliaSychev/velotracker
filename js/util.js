// Общие функции: геометрия, форматирование, калории.

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

/** Расстояние между двумя точками, метры. */
export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Числа — как в Аргентине: запятая в дроби.
export function fmtNum(v, digits = 1) {
  if (v == null || !isFinite(v)) return '—';
  return v.toFixed(digits).replace('.', ',');
}

export const fmtKm = (m, d = 2) => fmtNum(m / 1000, d);
export const fmtSpeed = (kmh) => fmtNum(kmh, 1);

/** 3725 → «1:02:05», 125 → «2:05». */
export function fmtDur(sec) {
  if (sec == null || !isFinite(sec)) return '—';
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
}

/** Длительность словами — для голоса и подписей: «1 час 5 минут». */
export function durWords(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [];
  if (h) parts.push(h + ' ' + plural(h, 'час', 'часа', 'часов'));
  if (m) parts.push(m + ' ' + plural(m, 'минута', 'минуты', 'минут'));
  if (!h && s && m < 10) parts.push(s + ' ' + plural(s, 'секунда', 'секунды', 'секунд'));
  return parts.join(' ') || '0 секунд';
}

export function plural(n, one, few, many) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`;
}
export function fmtTime(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
export const fmtWeekday = (ts) => WD[new Date(ts).getDay()];

/** Название поездки по времени суток: «Утренняя поездка». */
export function rideName(ts) {
  const h = new Date(ts).getHours();
  if (h < 5) return 'Ночная поездка';
  if (h < 12) return 'Утренняя поездка';
  if (h < 17) return 'Дневная поездка';
  if (h < 22) return 'Вечерняя поездка';
  return 'Ночная поездка';
}

/**
 * MET езды на велосипеде по скорости (Compendium of Physical Activities).
 * Ккал = MET × вес(кг) × часы. Оценка, не измерение.
 */
export function cyclingMET(kmh) {
  if (kmh < 3) return 0;
  if (kmh < 10) return 3.5;
  if (kmh < 16) return 5.8;
  if (kmh < 19) return 6.8;
  if (kmh < 22.5) return 8.0;
  if (kmh < 25.5) return 10.0;
  if (kmh < 30.5) return 12.0;
  return 15.8;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

/** Начало недели (понедельник 00:00) для метки времени. */
export function weekStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}
export function monthStart(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}
