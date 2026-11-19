// Хранилище в IndexedDB — всё живёт только на телефоне.
//   rides   — завершённые поездки (вместе с точками трека)
//   live    — точки текущей поездки, пишутся по одной (переживают закрытие вкладки)
//   kv      — настройки и состояние текущей поездки

const DB_NAME = 'velotrack';
const DB_VER = 1;
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('rides')) db.createObjectStore('rides', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('live')) db.createObjectStore('live', { autoIncrement: true });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        let result;
        Promise.resolve(fn(s)).then((r) => (result = r));
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

const req2p = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export const kvGet = (key) => tx('kv', 'readonly', (s) => req2p(s.get(key)));
export const kvSet = (key, val) => tx('kv', 'readwrite', (s) => s.put(val, key));
export const kvDel = (key) => tx('kv', 'readwrite', (s) => s.delete(key));

export const liveAdd = (pt) => tx('live', 'readwrite', (s) => s.add(pt));
export const liveAll = () => tx('live', 'readonly', (s) => req2p(s.getAll()));
export const liveClear = () => tx('live', 'readwrite', (s) => s.clear());

export const ridePut = (ride) => tx('rides', 'readwrite', (s) => s.put(ride));
export const rideGet = (id) => tx('rides', 'readonly', (s) => req2p(s.get(id)));
export const rideDel = (id) => tx('rides', 'readwrite', (s) => s.delete(id));
export const ridesAll = () =>
  tx('rides', 'readonly', (s) => req2p(s.getAll())).then((r) => r.sort((a, b) => b.start - a.start));

/** Список без точек трека — для истории и статистики. */
export async function ridesSummary() {
  const all = await ridesAll();
  return all.map(({ points, ...rest }) => rest);
}

export async function putManyRides(rides) {
  return tx('rides', 'readwrite', (s) => {
    for (const r of rides) s.put(r);
  });
}

// Настройки по умолчанию.
export const DEFAULTS = {
  weight: 75,          // кг — для калорий
  lapKm: 1,            // длина автоотрезка, км
  voice: true,         // голосовые подсказки
  voiceEveryKm: 1,     // как часто говорить (км)
  voicePause: true,    // говорить «Пауза» / «Поехали»
  autopause: true,
  keepAwake: true,
};

export async function getSettings() {
  return { ...DEFAULTS, ...((await kvGet('settings')) || {}) };
}
export const saveSettings = (s) => kvSet('settings', s);
