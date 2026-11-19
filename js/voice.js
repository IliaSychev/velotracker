// Голосовые подсказки через speechSynthesis.
// iOS разрешает говорить только после касания пользователя, поэтому
// unlock() вызывается из обработчика кнопки «Старт».

let enabled = true;
let ruVoice = null;

function pickVoice() {
  const vs = speechSynthesis.getVoices();
  ruVoice = vs.find((v) => v.lang === 'ru-RU' && v.localService) || vs.find((v) => v.lang && v.lang.startsWith('ru')) || null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

export const voiceAvailable = () => 'speechSynthesis' in window;
export function setVoiceEnabled(v) { enabled = v; }

export function unlock() {
  if (!voiceAvailable()) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
}

export function say(text, { force = false } = {}) {
  if ((!enabled && !force) || !voiceAvailable()) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ru-RU';
  if (ruVoice) u.voice = ruVoice;
  u.rate = 1.0;
  speechSynthesis.speak(u);
}

/** Скорость голосом: 21,4 → «21 и 4 десятых»; округляем до целого — так понятнее на ходу. */
export const speedWords = (kmh) => `${Math.round(kmh)}`;
