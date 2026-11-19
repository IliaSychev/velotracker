// Не даём экрану погаснуть во время поездки: браузер пишет GPS только
// при включённом экране. Wake Lock API в PWA на iOS до 18.4 не работает,
// поэтому параллельно крутим беззвучное зацикленное видео (приём NoSleep.js).
import { SILENT_MP4 } from './silent-video.js';

let lock = null;
let video = null;
let wanted = false;

async function requestLock() {
  try {
    if ('wakeLock' in navigator) {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => (lock = null));
    }
  } catch { lock = null; }
}

function startVideo() {
  if (!video) {
    video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.muted = true;
    video.loop = true;
    video.setAttribute('title', 'Экран не гаснет');
    video.style.cssText = 'position:fixed;left:-10px;top:-10px;width:1px;height:1px;opacity:0;pointer-events:none';
    video.src = SILENT_MP4;
    document.body.append(video);
  }
  video.play().catch(() => {});
}

/** Вызывать из обработчика касания (иначе iOS не запустит видео). */
export function keepAwake(on) {
  wanted = on;
  if (on) {
    requestLock();
    startVideo();
  } else {
    lock?.release().catch(() => {});
    lock = null;
    video?.pause();
  }
}

document.addEventListener('visibilitychange', () => {
  if (wanted && document.visibilityState === 'visible') {
    requestLock();
    video?.play().catch(() => {});
  }
});
