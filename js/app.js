// Велотрекер — экраны и связка модулей.
import * as db from './db.js';
import { Tracker, T, EFFORTS } from './tracker.js';
import * as voice from './voice.js';
import { keepAwake } from './awake.js';
import * as mapx from './map.js';
import { speedChart, barChart } from './chart.js';
import { exportGpx, exportBackup, importBackup } from './files.js';
import * as stats from './stats.js';
import { icons } from './icons.js';
import { $, el, fmtKm, fmtDur, fmtSpeed, fmtNum, fmtDate, fmtTime, fmtWeekday, durWords, plural, MONTHS_NOM, monthStart } from './util.js';

const VERSION = '1.0.0';
const tracker = new Tracker();
let settings = { ...db.DEFAULTS };
let recovery = false;            // есть незаконченная поездка, ждём решения
let cleanup = [];                // что убрать при смене экрана (карты, таймеры)
const view = $('#view');
const rideRoot = $('#ride-root');

// ═════════════ Общие помощники ═════════════

function toast(text, ms = 2600) {
  document.querySelector('.toast')?.remove();
  const t = el('div', { class: 'toast', role: 'status' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

function card(title, ...body) {
  return el('section', { class: 'card' }, el('div', { class: 'card__head' }, el('h2', {}, title)), ...body);
}

function tile(k, v, u, cls = '') {
  return el('div', { class: 'tile ' + cls }, el('div', { class: 'tile__k' }, k), el('div', { class: 'tile__v' }, v, u ? el('span', { class: 'tile__u' }, u) : null));
}

function icon(name) { return el('span', { html: icons[name], style: 'display:contents' }); }

/** Кнопка, срабатывающая только после удержания (защита от случайного касания). */
function holdButton(btn, ms, onDone) {
  let timer = null;
  btn.style.setProperty('--hold-ms', ms + 'ms');
  const start = (e) => {
    e.preventDefault();
    btn.classList.add('is-holding');
    timer = setTimeout(() => { btn.classList.remove('is-holding'); timer = null; navigator.vibrate?.(40); onDone(); }, ms);
  };
  const cancel = () => { if (timer) clearTimeout(timer); timer = null; btn.classList.remove('is-holding'); };
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', cancel);
  btn.addEventListener('pointerleave', cancel);
  btn.addEventListener('pointercancel', cancel);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  return btn;
}

function setTop(title, { back, right } = {}) {
  const bar = $('#topbar');
  bar.replaceChildren(...[
    back ? el('a', { class: 'btn btn--ghost btn--sm topbar__back', href: back, 'aria-label': 'Назад' }, icon('back')) : null,
    el('span', { class: 'topbar__title' }, title),
    el('span', { class: 'topbar__spacer' }),
    right ? el('span', { class: 'topbar__right' }, right) : null,
  ].filter(Boolean));
}

function gpsBadge() {
  const g = tracker.gps;
  let cls = 'dot--wait', text = 'Ищу GPS…';
  if (g.lost) { cls = 'dot--bad'; text = 'Нет GPS'; }
  else if (g.acc != null) {
    cls = g.acc <= 15 ? 'dot--ok' : g.acc <= 30 ? 'dot--wait' : 'dot--bad';
    text = `GPS ± ${Math.round(g.acc)} м`;
  }
  return el('span', { class: 'small', 'data-gps': '' }, el('span', { class: 'dot ' + cls }), ' ', text);
}

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

// ═════════════ Маршрутизация ═════════════

const routes = {
  '': renderHome,
  history: renderHistory,
  ride: renderRide,
  stats: renderStats,
  settings: renderSettings,
};

function route() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const [name, arg] = path.split('/');
  return { name: name || '', arg, params: new URLSearchParams(query || '') };
}

async function render() {
  cleanup.forEach((f) => { try { f(); } catch {} });
  cleanup = [];
  const r = route();
  const nav = r.name === 'ride' ? 'history' : r.name;
  document.querySelectorAll('.nav a').forEach((a) => {
    if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  // GPS держим включённым на главном экране — чтобы к старту спутники уже были найдены
  if (r.name === '' || tracker.status !== 'idle') tracker.startGps();
  else tracker.stopGps();
  view.replaceChildren();
  await (routes[r.name] || renderHome)(r);
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);

// ═════════════ Главный экран ═════════════

async function renderHome() {
  setTop('Велотрекер', { right: gpsBadge() });
  const parts = [];

  if (recovery) {
    parts.push(card('Незаконченная поездка',
      el('p', { style: 'margin:0 0 10px' }, `Запись прервалась: ${fmtKm(tracker.dist)} км, ${fmtDur(tracker.moving)} в движении. Что с ней сделать?`),
      el('div', { class: 'stack' },
        el('button', { class: 'btn btn--accent btn--block', onclick: () => { recovery = false; startFlow(true); } }, icon('play'), 'Продолжить запись'),
        el('button', { class: 'btn btn--ghost btn--block', onclick: async () => { recovery = false; await finishFlow(); } }, icon('flag'), 'Завершить и сохранить'),
        el('button', { class: 'btn btn--ghost btn--danger btn--block', onclick: async () => { recovery = false; await tracker.discard(); render(); } }, icon('trash'), 'Удалить запись'))));
  } else {
    parts.push(el('button', { class: 'btn btn--accent start-btn', onclick: () => startFlow(false) }, icon('play'), 'СТАРТ', el('small', {}, 'Экран будет оставаться включённым')));
  }

  const rides = await db.ridesSummary();
  const wk = stats.totals(rides.filter((r) => r.start >= stats.periodStart('week')));
  parts.push(card('Эта неделя',
    el('div', { class: 'tiles tiles--3' },
      tile('Км', fmtKm(wk.dist, 1), null, 'tile--sm'),
      tile('Поездок', String(wk.count), null, 'tile--sm'),
      tile('Время', fmtDur(wk.moving), null, 'tile--sm'))));

  if (rides[0]) parts.push(card('Последняя поездка', el('div', { class: 'dlist' }, rideRow(rides[0]))));

  const ms = await mapx.mapStatus();
  if (!ms.ready) parts.push(el('div', { class: 'note note--warn' }, el('b', {}, 'Офлайн-карта не скачана'), 'Скачайте её один раз по Wi-Fi (20 МБ), и карта будет работать без интернета. ', el('a', { href: '#/settings' }, 'В настройки →')));
  if (isIOS && !isStandalone) parts.push(el('div', { class: 'note' }, el('b', {}, 'Установите на экран «Домой»'), 'В Safari нажмите «Поделиться» → «На экран „Домой“». Так приложение откроется на весь экран и данные не удалятся.'));

  view.append(el('div', { class: 'stack' }, parts));
}

function rideRow(r) {
  return el('a', { class: 'ride-row', href: '#/ride/' + r.id },
    el('div', { class: 'grow' },
      el('div', { class: 'title' }, r.name),
      el('div', { class: 'meta' }, `${fmtWeekday(r.start)}, ${fmtDate(r.start)}, ${fmtTime(r.start)} · ${fmtDur(r.moving)} · ${fmtSpeed(r.avg)} км/ч`)),
    el('div', { class: 'km num' }, fmtKm(r.dist, 1), el('span', { class: 'tile__u' }, 'км')));
}

// ═════════════ Запись поездки ═════════════

let rideUI = null;

async function startFlow(resume) {
  // Всё, что требует касания на iOS, — прямо здесь, синхронно в обработчике.
  voice.unlock();
  if (settings.keepAwake) keepAwake(true);
  if (resume) tracker.resume();
  else await tracker.begin();
  voice.say(resume ? 'Продолжаю запись' : 'Поехали! Запись началась');
  try { await navigator.storage?.persist?.(); } catch {}
  showRideUI();
}

async function finishFlow() {
  keepAwake(false);
  const ride = await tracker.finish();
  hideRideUI();
  if (!ride) { toast('Поездка короче 50 метров — не сохранил'); location.hash = '#/'; render(); return; }
  voice.say(`Поездка завершена. ${fmtNum(ride.dist / 1000, 1).replace(',', ' и ')} километра за ${durWords(ride.moving)}. Средняя скорость ${Math.round(ride.avg)}.`);
  location.hash = `#/ride/${ride.id}?new=1`;
}

function showRideUI() {
  if (rideUI) return;
  let mode = 'numbers';
  let map = null, follow = true;

  const statusText = el('span', { class: 'grow' });
  const dot = el('span', { class: 'dot dot--rec' });
  const gpsSlot = el('span');
  const modeBtn = el('button', { class: 'btn btn--ghost btn--sm', 'aria-label': 'Карта или цифры' }, icon('map'));
  const lockBtn = el('button', { class: 'btn btn--ghost btn--sm', 'aria-label': 'Заблокировать экран' }, icon('lock'));

  const v = {
    speed: el('span', { class: 'hero__v' }, '0'),
    dist: el('span', {}), moving: el('span', {}), avg: el('span', {}), max: el('span', {}),
    lap: el('span', {}), lapLabel: el('span', {}), kcal: el('span', {}), total: el('span', {}),
  };
  const t = (k, node, u) => el('div', { class: 'tile' }, el('div', { class: 'tile__k' }, k), el('div', { class: 'tile__v' }, node, u ? el('span', { class: 'tile__u' }, u) : null));

  const numbers = el('div', { class: 'ride__body' },
    el('div', { class: 'hero' }, v.speed, el('div', { class: 'hero__u' }, 'км/ч')),
    el('div', { class: 'tiles' }, t('Дистанция', v.dist, 'км'), t('В движении', v.moving), t('Средняя', v.avg, 'км/ч'), t('Максимум', v.max, 'км/ч')),
    el('div', { class: 'tiles tiles--3' },
      el('div', { class: 'tile' }, el('div', { class: 'tile__k' }, v.lapLabel), el('div', { class: 'tile__v' }, v.lap)),
      t('Ккал', v.kcal), t('Всего', v.total)));

  const mapBox = el('div', { class: 'ride__map' });
  const mapSpeed = el('div', { class: 'hero', style: 'display:flex;align-items:baseline;justify-content:space-around;padding:6px' });
  const mapBody = el('div', { class: 'ride__body hidden' }, mapSpeed, mapBox);

  const pauseBtn = el('button', { class: 'btn btn--ghost' });
  const lapBtn = el('button', { class: 'btn btn--ghost' }, icon('flag'), 'Отрезок');
  const stopBtn = holdButton(el('button', { class: 'btn btn--danger hold wide' }, el('span', { html: icons.stop, style: 'display:contents' }), el('span', {}, 'Стоп — удерживайте')), 1200, finishFlow);

  const unlockBtn = holdButton(el('button', { class: 'btn btn--accent hold' }, el('span', { html: icons.unlock, style: 'display:contents' }), el('span', {}, 'Удерживайте, чтобы разблокировать')), 1000, () => root.classList.remove('is-locked'));

  const root = el('div', { class: 'ride' },
    el('div', { class: 'ride__status' }, dot, statusText, gpsSlot, modeBtn, lockBtn),
    numbers, mapBody,
    el('div', { class: 'ride__controls' }, pauseBtn, lapBtn, stopBtn),
    el('div', { class: 'lockshield' }),
    el('div', { class: 'unlock' }, unlockBtn));
  rideRoot.replaceChildren(root);

  pauseBtn.onclick = () => {
    if (tracker.status === 'recording') { tracker.pause(); voice.say('Пауза'); }
    else { tracker.resume(); voice.say('Продолжаем'); }
  };
  lapBtn.onclick = () => {
    const lap = tracker.closeLap(false);
    if (lap) voice.say(`Отрезок ${lap.n}. ${fmtNum(lap.dist / 1000, 2).replace(',', ' и ')} километра за ${durWords(lap.time)}.`);
    else toast('Отрезок слишком короткий');
  };
  lockBtn.onclick = () => { root.classList.add('is-locked'); toast('Экран заблокирован от случайных касаний'); };
  modeBtn.onclick = async () => {
    mode = mode === 'numbers' ? 'map' : 'numbers';
    numbers.classList.toggle('hidden', mode !== 'numbers');
    mapBody.classList.toggle('hidden', mode !== 'map');
    modeBtn.replaceChildren(icon(mode === 'map' ? 'numbers' : 'map'));
    if (mode === 'map' && !map) {
      const g = tracker.gps;
      const { map: m, hasData } = await mapx.createMap(mapBox, { center: g.lon ? [g.lon, g.lat] : mapx.BA_CENTER, zoom: 15 });
      map = m;
      if (!hasData) mapBox.append(el('div', { class: 'map-empty' }, el('span', {}, 'Офлайн-карта не скачана — видно только трек')));
      map.on('dragstart', () => (follow = false));
      const recenter = el('button', { class: 'btn btn--ghost btn--sm', style: 'position:absolute;right:8px;bottom:28px;z-index:2' }, icon('pin'));
      recenter.onclick = () => { follow = true; const g2 = tracker.gps; if (g2.lon) map.easeTo({ center: [g2.lon, g2.lat], duration: 300 }); };
      mapBox.append(recenter);
      drawMapNow();
    }
    if (map) map.resize();
  };

  function drawMapNow() {
    if (!map) return;
    mapx.drawLiveTrack(map, tracker.points);
    const g = tracker.gps;
    if (g.lon) {
      mapx.setMe(map, g.lon, g.lat);
      if (follow) map.easeTo({ center: [g.lon, g.lat], duration: 500 });
    }
  }

  function update() {
    const s = tracker.status;
    root.classList.toggle('is-paused', s === 'paused');
    root.classList.toggle('is-autopaused', s === 'recording' && tracker.autoPaused);
    dot.className = 'dot ' + (s === 'paused' ? 'dot--wait' : tracker.autoPaused ? 'dot--wait' : 'dot--rec');
    statusText.textContent = s === 'paused' ? 'Пауза' : tracker.autoPaused ? 'Автопауза' : 'Запись';
    gpsSlot.replaceChildren(gpsBadge());
    const spd = s === 'recording' && !tracker.autoPaused ? tracker.speed : 0;
    v.speed.textContent = spd < 1 ? '0' : fmtSpeed(spd);
    v.dist.textContent = fmtKm(tracker.dist);
    v.moving.textContent = fmtDur(tracker.moving);
    v.avg.textContent = fmtSpeed(tracker.moving ? (tracker.dist / tracker.moving) * 3.6 : 0);
    v.max.textContent = fmtSpeed(tracker.maxSpeed);
    const lap = tracker.lapNow();
    v.lapLabel.textContent = `Отрезок ${lap.n}`;
    v.lap.textContent = fmtKm(lap.dist);
    v.kcal.textContent = String(Math.round(tracker.kcal));
    v.total.textContent = fmtDur(tracker.totalMs() / 1000);
    mapSpeed.replaceChildren(
      el('span', {}, el('b', { style: 'font-size:34px' }, v.speed.textContent), ' км/ч'),
      el('span', {}, el('b', { style: 'font-size:24px' }, v.dist.textContent), ' км'),
      el('span', {}, el('b', { style: 'font-size:24px' }, v.moving.textContent)));
    pauseBtn.replaceChildren(icon(s === 'paused' ? 'play' : 'pause'), s === 'paused' ? 'Продолжить' : 'Пауза');
    pauseBtn.classList.toggle('btn--accent', s === 'paused');
  }

  const onPoint = () => { update(); drawMapNow(); };
  const onAny = () => update();
  tracker.addEventListener('point', onPoint);
  tracker.addEventListener('gps', onAny);
  tracker.addEventListener('status', onAny);
  tracker.addEventListener('autopause', onAny);
  const tick = setInterval(update, 1000);
  const save = setInterval(() => tracker.saveState(), 5000);
  update();

  rideUI = {
    destroy() {
      tracker.removeEventListener('point', onPoint);
      tracker.removeEventListener('gps', onAny);
      tracker.removeEventListener('status', onAny);
      tracker.removeEventListener('autopause', onAny);
      clearInterval(tick); clearInterval(save);
      map?.remove();
      rideRoot.replaceChildren();
    },
  };
}

function hideRideUI() { rideUI?.destroy(); rideUI = null; }

// Голос во время поездки
tracker.addEventListener('autopause', (e) => {
  if (settings.voicePause) voice.say(e.detail ? 'Пауза' : 'Поехали');
});
tracker.addEventListener('km', (e) => {
  const km = e.detail.km;
  const avg = tracker.moving ? (tracker.dist / tracker.moving) * 3.6 : 0;
  let text = `${km} ${plural(km, 'километр', 'километра', 'километров')}. Время ${durWords(tracker.moving)}. Средняя ${Math.round(avg)}.`;
  const lap = tracker.laps.at(-1);
  if (lap?.auto && Math.abs(lap.endDist - tracker.dist) < 30) {
    text += ` Последний ${settings.lapKm === 1 ? 'километр' : 'отрезок'} за ${durWords(lap.time)}.`;
  }
  voice.say(text);
});
tracker.addEventListener('gpslost', () => voice.say('Сигнал GPS потерян'));
tracker.addEventListener('gpsback', () => voice.say('Сигнал GPS восстановлен'));
tracker.addEventListener('gps', () => {
  const b = document.querySelector('#topbar [data-gps]');
  if (b) b.replaceWith(gpsBadge());
});
tracker.addEventListener('gpserror', (e) => toast(e.detail, 5000));

// ═════════════ История ═════════════

async function renderHistory() {
  setTop('История');
  const rides = await db.ridesSummary();
  if (!rides.length) {
    view.append(el('div', { class: 'card empty' }, el('b', {}, 'Поездок пока нет'), 'Здесь появятся все ваши заезды: карта, графики скорости, отрезки. ', el('a', { href: '#/' }, 'Начать первую →')));
    return;
  }
  const groups = new Map();
  for (const r of rides) {
    const k = monthStart(r.start);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = [];
  for (const [k, list] of groups) {
    const d = new Date(k);
    const t = stats.totals(list);
    out.push(el('div', { class: 'month-h' }, el('b', {}, `${MONTHS_NOM[d.getMonth()]} ${d.getFullYear()}`), el('span', { class: 'small muted num' }, `${fmtKm(t.dist, 1)} км · ${t.count} ${plural(t.count, 'поездка', 'поездки', 'поездок')}`)));
    out.push(el('div', { class: 'dlist' }, list.map(rideRow)));
  }
  view.append(el('div', { class: 'stack' }, out));
}

// ═════════════ Поездка подробно ═════════════

async function renderRide({ arg, params }) {
  const ride = await db.rideGet(arg);
  setTop(ride ? ride.name : 'Поездка', { back: '#/history' });
  if (!ride) { view.append(el('div', { class: 'card empty' }, el('b', {}, 'Поездка не найдена'))); return; }
  const parts = [];

  if (params.get('new')) {
    const others = (await db.ridesSummary()).filter((r) => r.id !== ride.id);
    const recs = stats.newRecords(ride, others);
    parts.push(el('div', { class: 'note note--ok' }, el('b', {}, 'Поездка сохранена'), recs.length ? '' : 'Отличная работа!'));
    if (recs.length) {
      parts.push(card('Новые рекорды', el('div', { class: 'dlist' }, recs.map((r) => el('div', { class: 'rec' }, icon('trophy'), el('div', { class: 'rec__t' }, r.title), el('div', { class: 'rec__v num' }, r.text))))));
      voice.say('Новый рекорд! ' + recs.map((r) => r.title).join('. '));
    }
  }

  // Карта
  const mapBox = el('div', { class: 'mapbox' });
  parts.push(el('section', { class: 'card card--flush' },
    el('div', { class: 'card__head' }, el('h2', {}, `${fmtWeekday(ride.start)}, ${fmtDate(ride.start)} · ${fmtTime(ride.start)}–${fmtTime(ride.end)}`)),
    mapBox,
    el('div', { class: 'legend' }, 'медленно', el('i'), 'быстро')));

  // Цифры
  parts.push(el('div', { class: 'tiles' },
    tile('Дистанция', fmtKm(ride.dist), 'км'),
    tile('В движении', fmtDur(ride.moving)),
    tile('Средняя', fmtSpeed(ride.avg), 'км/ч'),
    tile('Максимум', fmtSpeed(ride.max), 'км/ч'),
    tile('Калории', String(ride.kcal), 'ккал'),
    tile('Всего с паузами', fmtDur(ride.total))));

  // График
  const canvas = el('canvas', { class: 'chart' });
  const chartCard = card('Скорость, км/ч', canvas, el('div', { class: 'small muted', style: 'margin-top:6px' }, 'По горизонтали — километры. Пунктир — средняя. Проведите пальцем, чтобы увидеть точку на карте.'));
  parts.push(chartCard);

  // Отрезки
  if (ride.laps?.length) {
    const speeds = ride.laps.map((l) => (l.time ? (l.dist / l.time) * 3.6 : 0));
    const full = ride.laps.filter((l) => l.auto);
    const best = full.length > 1 ? Math.max(...full.map((l) => (l.dist / l.time) * 3.6)) : null;
    const worst = full.length > 1 ? Math.min(...full.map((l) => (l.dist / l.time) * 3.6)) : null;
    parts.push(card('Отрезки',
      el('table', { class: 'laps' },
        el('thead', {}, el('tr', {}, el('th', {}, '№'), el('th', {}, 'Км'), el('th', {}, 'Время'), el('th', {}, 'Км/ч'))),
        el('tbody', {}, ride.laps.map((l, i) => el('tr', { class: l.auto && speeds[i] === best ? 'best' : l.auto && speeds[i] === worst ? 'worst' : '' },
          el('td', {}, String(l.n), l.auto ? '' : el('span', { class: 'faint small' }, l.finish ? ' финиш' : ' вручную')),
          el('td', {}, fmtKm(l.dist)), el('td', {}, fmtDur(l.time)), el('td', {}, fmtSpeed(speeds[i]))))))));
  }

  // Лучшие отрезки внутри поездки
  const eff = EFFORTS.filter((D) => ride.efforts?.[D]);
  if (eff.length) {
    parts.push(card('Лучшее время в этой поездке', el('div', { class: 'dlist' }, eff.map((D) =>
      el('div', { class: 'rec' }, el('div', { class: 'rec__t' }, `${D / 1000} км`), el('div', { class: 'rec__v num' }, `${fmtDur(ride.efforts[D])} · ${fmtSpeed((D / ride.efforts[D]) * 3.6)} км/ч`))))));
  }

  // Действия
  const actions = el('div', { class: 'stack' });
  const nameInput = el('input', { class: 'input', value: ride.name, maxlength: 60, 'aria-label': 'Название поездки' });
  nameInput.addEventListener('change', async () => {
    ride.name = nameInput.value.trim() || ride.name;
    await db.ridePut(ride);
    setTop(ride.name, { back: '#/history' });
    toast('Название сохранил');
  });
  const delZone = el('div');
  const delBtn = el('button', { class: 'btn btn--ghost btn--danger btn--block' }, icon('trash'), 'Удалить поездку');
  delBtn.onclick = () => {
    delZone.replaceChildren(el('div', { class: 'confirm' },
      el('div', {}, el('b', {}, 'Удалить поездку?'), ` ${fmtKm(ride.dist, 1)} км от ${fmtDate(ride.start)} пропадут из истории и статистики. Это действие необратимо.`),
      el('div', { class: 'row' },
        el('button', { class: 'btn btn--danger grow', onclick: async () => { await db.rideDel(ride.id); toast('Поездку удалил'); location.hash = '#/history'; } }, 'Да, удалить'),
        el('button', { class: 'btn btn--ghost grow', onclick: () => delZone.replaceChildren(delBtn) }, 'Отмена'))));
  };
  delZone.append(delBtn);
  actions.append(
    el('label', { class: 'field' }, el('span', { class: 'label' }, 'Название'), nameInput),
    el('button', { class: 'btn btn--block', onclick: () => exportGpx(ride) }, icon('share'), 'Экспорт GPX (Strava, Komoot)'),
    delZone);
  parts.push(card('Поездка', actions));

  view.append(el('div', { class: 'stack' }, parts));

  // Карта и график — после вставки в DOM (нужны размеры)
  let map = null;
  const chart = speedChart(canvas, ride.points, {
    avg: ride.avg,
    onHover: (p) => { if (map) mapx.setCursor(map, p?.[2], p?.[1]); },
  });
  const onResize = () => { chart.redraw(); map?.resize(); };
  window.addEventListener('resize', onResize);
  cleanup.push(() => window.removeEventListener('resize', onResize));
  try {
    const res = await mapx.createMap(mapBox);
    map = res.map;
    cleanup.push(() => map.remove());
    if (!res.hasData) mapBox.append(el('div', { class: 'map-empty' }, el('span', {}, 'Офлайн-карта не скачана — видно только трек. ', el('a', { href: '#/settings' }, 'Скачать'))));
    mapx.drawRideTrack(map, ride.points);
    mapx.fitTrack(map, ride.points);
  } catch (e) {
    mapBox.append(el('div', { class: 'map-empty' }, el('span', {}, 'Карта не загрузилась: ' + e.message)));
  }
}

// ═════════════ Статистика ═════════════

let statsPeriod = 'month';

async function renderStats() {
  setTop('Статистика');
  const rides = await db.ridesSummary();
  if (!rides.length) {
    view.append(el('div', { class: 'card empty' }, el('b', {}, 'Пока нечего считать'), 'После первой поездки здесь появятся километры по неделям и месяцам и личные рекорды.'));
    return;
  }
  const periods = [['week', 'Неделя'], ['month', 'Месяц'], ['year', 'Год'], ['all', 'Всё время']];
  const seg = el('div', { class: 'seg', role: 'group' }, periods.map(([k, n]) =>
    el('button', { 'aria-pressed': String(k === statsPeriod), onclick: () => { statsPeriod = k; render(); } }, n)));

  const from = stats.periodStart(statsPeriod);
  const t = stats.totals(rides.filter((r) => r.start >= from));
  const canvas = el('canvas', { class: 'chart' });
  const chartTitle = { week: 'Км по дням недели', month: 'Км по неделям (12 недель)', year: 'Км по месяцам', all: 'Км по годам' }[statsPeriod];

  const recs = stats.records(rides);
  const recList = el('div', { class: 'dlist' }, recs.map((r) => {
    const inner = [el('div', { class: 'rec__t' }, el('div', {}, r.title), el('div', { class: 'rec__d' }, r.key === 'week' ? 'неделя с ' + fmtDate(r.start) : r.key === 'month' ? MONTHS_NOM[new Date(r.start).getMonth()] + ' ' + new Date(r.start).getFullYear() : fmtDate(r.start))), el('div', { class: 'rec__v num' }, r.text)];
    return r.rideId ? el('a', { class: 'rec', href: '#/ride/' + r.rideId }, inner) : el('div', { class: 'rec' }, inner);
  }));

  view.append(el('div', { class: 'stack' },
    seg,
    el('div', { class: 'tiles' },
      tile('Километры', fmtKm(t.dist, 1), 'км'),
      tile('Поездок', String(t.count)),
      tile('В движении', fmtDur(t.moving)),
      tile('Средняя', fmtSpeed(t.avg), 'км/ч'),
      tile('Калории', fmtNum(t.kcal, 0), 'ккал'),
      tile('В среднем за поездку', t.count ? fmtKm(t.dist / t.count, 1) : '—', 'км')),
    card(chartTitle, canvas),
    card('Личные рекорды', recList)));

  const draw = () => barChart(canvas, stats.series(rides, statsPeriod));
  draw();
  window.addEventListener('resize', draw);
  cleanup.push(() => window.removeEventListener('resize', draw));
}

// ═════════════ Настройки ═════════════

async function renderSettings() {
  setTop('Настройки');
  const save = async (patch) => {
    settings = { ...settings, ...patch };
    tracker.settings = settings;
    voice.setVoiceEnabled(settings.voice);
    await db.saveSettings(settings);
  };
  const check = (key, label, hint) => {
    const inp = el('input', { type: 'checkbox' });
    inp.checked = !!settings[key];
    inp.onchange = () => save({ [key]: inp.checked });
    return el('label', { class: 'check' }, inp, el('span', {}, label, hint ? el('div', { class: 'small muted' }, hint) : null));
  };
  const select = (key, label, options) => {
    const s = el('select', { class: 'input' }, options.map(([v, n]) => el('option', { value: v }, n)));
    s.value = String(settings[key]);
    s.onchange = () => save({ [key]: Number(s.value) });
    return el('label', { class: 'field' }, el('span', { class: 'label' }, label), s);
  };

  const weight = el('input', { class: 'input', type: 'number', inputmode: 'decimal', min: 30, max: 200, value: settings.weight });
  weight.onchange = () => { const w = Number(String(weight.value).replace(',', '.')); if (w >= 30 && w <= 200) { save({ weight: w }); toast('Вес сохранил'); } };

  // Карта
  const mapZone = el('div', { class: 'stack' });
  async function drawMapZone() {
    const st = await mapx.mapStatus();
    if (st.ready) {
      mapZone.replaceChildren(
        el('div', { class: 'note note--ok' }, el('b', {}, 'Карта скачана'), `Gran Buenos Aires, ${fmtNum((st.size || 0) / 1048576, 1)} МБ. Работает без интернета.`),
        el('button', { class: 'btn btn--ghost btn--block', onclick: async () => { await mapx.deleteMap(); toast('Карту удалил'); drawMapZone(); } }, icon('trash'), 'Удалить карту с телефона'));
    } else {
      const bar = el('div', { class: 'progress hidden' }, el('i'));
      const btn = el('button', { class: 'btn btn--accent btn--block' }, icon('download'), 'Скачать карту (≈ 20 МБ)');
      btn.onclick = async () => {
        btn.disabled = true; bar.classList.remove('hidden');
        try {
          await mapx.downloadMap((f, got) => { bar.firstChild.style.width = f * 100 + '%'; btn.lastChild.textContent = `Скачиваю… ${fmtNum(got / 1048576, 1)} МБ`; });
          toast('Карта скачана — теперь она работает офлайн');
          drawMapZone();
        } catch (e) {
          toast('Не получилось: ' + e.message, 5000);
          btn.disabled = false; bar.classList.add('hidden');
          btn.lastChild.textContent = 'Скачать карту (≈ 20 МБ)';
        }
      };
      mapZone.replaceChildren(el('div', { class: 'small muted' }, 'Город и пригороды (Gran Buenos Aires). Скачивается один раз — лучше по Wi-Fi. Потом карта не тратит трафик.'), btn, bar);
    }
  }
  drawMapZone();

  // Данные
  const rides = await db.ridesSummary();
  const lastBackup = await db.kvGet('lastBackup');
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', class: 'hidden' });
  const restoreZone = el('div');
  fileInput.onchange = () => {
    const f = fileInput.files[0];
    if (!f) return;
    restoreZone.replaceChildren(el('div', { class: 'confirm' },
      el('div', {}, el('b', {}, `Восстановить из «${f.name}»?`), ' Поездки из копии добавятся к текущим; совпадающие — перезапишутся. Настройки заменятся настройками из копии.'),
      el('div', { class: 'row' },
        el('button', { class: 'btn btn--accent grow', onclick: async () => {
          try { const n = await importBackup(f); settings = await db.getSettings(); tracker.settings = settings; toast(`Восстановил ${n} ${plural(n, 'поездку', 'поездки', 'поездок')}`); render(); }
          catch (e) { toast('Не получилось: ' + e.message, 5000); }
        } }, 'Восстановить'),
        el('button', { class: 'btn btn--ghost grow', onclick: () => { fileInput.value = ''; restoreZone.replaceChildren(); } }, 'Отмена'))));
  };

  view.append(el('div', { class: 'stack' },
    card('Поездка',
      el('div', { class: 'stack' },
        el('label', { class: 'field' }, el('span', { class: 'label' }, 'Ваш вес, кг — для калорий'), weight),
        select('lapKm', 'Автоотрезок', [[0, 'Выключен'], [1, 'Каждый 1 км'], [2, 'Каждые 2 км'], [5, 'Каждые 5 км'], [10, 'Каждые 10 км']]),
        check('autopause', 'Автопауза', 'Остановились — таймер встаёт, поехали — снова идёт'),
        check('keepAwake', 'Не гасить экран во время записи', 'Без этого iPhone перестанет писать GPS, когда экран погаснет'))),
    card('Голосовые подсказки',
      el('div', { class: 'stack' },
        check('voice', 'Говорить во время поездки'),
        select('voiceEveryKm', 'Сводка голосом', [[0, 'Не говорить'], [1, 'Каждый километр'], [2, 'Каждые 2 км'], [5, 'Каждые 5 км'], [10, 'Каждые 10 км']]),
        check('voicePause', 'Говорить «Пауза» и «Поехали» при автопаузе'),
        el('button', { class: 'btn btn--ghost btn--block', onclick: () => { voice.unlock(); voice.say('5 километров. Время 14 минут 30 секунд. Средняя 21.', { force: true }); } }, icon('sound'), 'Проверить голос'),
        voice.voiceAvailable() ? null : el('div', { class: 'note note--warn' }, 'Этот браузер не умеет говорить.'))),
    card('Офлайн-карта', mapZone),
    card('Данные и резервная копия',
      el('div', { class: 'stack' },
        el('div', { class: 'small muted' }, `Все поездки хранятся только на этом телефоне: ${rides.length} ${plural(rides.length, 'поездка', 'поездки', 'поездок')}. `, lastBackup ? `Последняя копия: ${fmtDate(lastBackup)}.` : 'Копию ещё не делали.'),
        el('button', { class: 'btn btn--block', onclick: async () => { const r = await exportBackup(); if (r.res !== 'cancelled') { toast('Копия готова — сохраните её в «Файлы» или iCloud'); } } }, icon('download'), 'Сделать резервную копию'),
        el('button', { class: 'btn btn--ghost btn--block', onclick: () => fileInput.click() }, icon('upload'), 'Восстановить из копии'),
        fileInput, restoreZone)),
    card('О приложении',
      el('div', { class: 'small muted stack', style: 'gap:6px' },
        el('div', {}, `Велотрекер ${VERSION}. Работает без сервера: данные на телефоне, карта офлайн.`),
        el('div', {}, 'Во время поездки экран должен оставаться включённым: браузер на iPhone не пишет GPS с выключенным экраном. Убавьте яркость и включите блокировку касаний (замок).'),
        el('div', {}, 'Калории — оценка по скорости, весу и времени (таблица MET), не измерение.'),
        el('div', {}, 'Карта © участники OpenStreetMap, сборка Protomaps. Отрисовка — MapLibre GL.')))));
}

// ═════════════ Запуск ═════════════

async function init() {
  settings = await db.getSettings();
  tracker.settings = settings;
  voice.setVoiceEnabled(settings.voice);
  recovery = await tracker.restore();
  // На localhost сервис-воркер не ставим (иначе правки кода не видны), кроме ?sw=1
  const dev = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !new URLSearchParams(location.search).has('sw');
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !dev) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  render();
}

init();
