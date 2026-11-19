// Иконки в стиле Familia: сетка 24, только обводка 1.75, скруглённые концы.
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const icons = {
  bike: svg('<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5 9 9h6.5l3 7.5M9 9l3.5 7.5h-7M15 6h2.5l-2 3"/><path d="M8 6h3"/>'),
  list: svg('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".8"/><circle cx="4" cy="12" r=".8"/><circle cx="4" cy="18" r=".8"/>'),
  chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>'),
  play: svg('<path d="M7 4.5v15l12-7.5z"/>'),
  pause: svg('<path d="M8 5v14M16 5v14"/>'),
  stop: svg('<rect x="5.5" y="5.5" width="13" height="13" rx="1.5"/>'),
  flag: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  unlock: svg('<rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>'),
  map: svg('<path d="M9 4 3 6.5v13.5L9 17.5l6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>'),
  numbers: svg('<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  upload: svg('<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  share: svg('<path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1"/>'),
  trophy: svg('<path d="M8 4h8v6a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 14v4M8 20h8"/>'),
  sound: svg('<path d="M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  pin: svg('<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>'),
};
