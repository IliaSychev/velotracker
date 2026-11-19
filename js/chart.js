// Лёгкие графики на canvas без библиотек.
import { T } from './tracker.js';
import { fmtNum } from './util.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function setup(canvas, h) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function niceStep(range, target) {
  const raw = range / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

/**
 * График скорости по дистанции. onHover(point|null) — при касании,
 * чтобы показать место на карте.
 */
export function speedChart(canvas, points, { avg, onHover, height = 180 } = {}) {
  const pts = points.filter((p, i) => i > 0 && !p[T.SEG]);
  const totalKm = (points.at(-1)?.[T.DIST] || 0) / 1000;
  const bins = Math.max(20, Math.min(240, pts.length));
  const series = [];
  {
    let bi = 0, sum = 0, n = 0, ref = null;
    for (const p of pts) {
      const b = Math.min(bins - 1, Math.floor(((p[T.DIST] / 1000) / (totalKm || 1)) * bins));
      if (b !== bi && n) { series.push({ km: (bi + 0.5) / bins * totalKm, v: sum / n, p: ref }); sum = 0; n = 0; }
      bi = b; sum += p[T.SPD]; n++; ref = p;
    }
    if (n) series.push({ km: (bi + 0.5) / bins * totalKm, v: sum / n, p: ref });
  }
  // лёгкое сглаживание соседями
  const sm = series.map((s, i) => {
    const a = series.slice(Math.max(0, i - 1), i + 2);
    return { ...s, v: a.reduce((x, y) => x + y.v, 0) / a.length };
  });

  let hoverIdx = null;
  function draw() {
    const { ctx, w, h } = setup(canvas, height);
    const L = 34, R = 8, Tp = 10, B = 22;
    const pw = w - L - R, ph = h - Tp - B;
    const maxV = Math.max(10, ...sm.map((s) => s.v)) * 1.1;
    const yStep = niceStep(maxV, 4);
    const X = (km) => L + (totalKm ? (km / totalKm) * pw : 0);
    const Y = (v) => Tp + ph - (v / maxV) * ph;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(L, Tp, pw, ph);
    ctx.font = '11px ' + css('--font-sans');
    ctx.fillStyle = css('--c-muted');
    ctx.strokeStyle = css('--c-line');
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= maxV; v += yStep) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      ctx.fillText(String(Math.round(v)), L - 5, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const xStep = niceStep(totalKm || 1, 5);
    for (let km = 0; km <= totalKm + 1e-9; km += xStep) ctx.fillText(fmtNum(km, xStep < 1 ? 1 : 0), X(km), Tp + ph + 5);

    if (sm.length > 1) {
      const acc = css('--c-accent');
      ctx.beginPath();
      ctx.moveTo(X(sm[0].km), Y(0));
      sm.forEach((s) => ctx.lineTo(X(s.km), Y(s.v)));
      ctx.lineTo(X(sm.at(-1).km), Y(0));
      ctx.closePath();
      ctx.fillStyle = css('--c-accent-soft');
      ctx.fill();
      ctx.beginPath();
      sm.forEach((s, i) => (i ? ctx.lineTo(X(s.km), Y(s.v)) : ctx.moveTo(X(s.km), Y(s.v))));
      ctx.strokeStyle = acc;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    if (avg) {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = css('--c-text');
      ctx.lineWidth = 1;
      const y = Math.round(Y(avg)) + 0.5;
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = css('--c-edge');
    ctx.strokeRect(L + 0.5, Tp + 0.5, pw - 1, ph - 1);

    if (hoverIdx != null && sm[hoverIdx]) {
      const s = sm[hoverIdx];
      const x = Math.round(X(s.km)) + 0.5;
      ctx.strokeStyle = css('--c-text');
      ctx.beginPath(); ctx.moveTo(x, Tp); ctx.lineTo(x, Tp + ph); ctx.stroke();
      const label = `${fmtNum(s.v, 1)} км/ч · ${fmtNum(s.km, 1)} км`;
      ctx.font = '600 12px ' + css('--font-sans');
      const tw = ctx.measureText(label).width + 12;
      const bx = Math.min(Math.max(L, x - tw / 2), L + pw - tw);
      ctx.fillStyle = css('--c-text');
      ctx.fillRect(bx, Tp + 2, tw, 20);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + 6, Tp + 12);
    }
    canvas._geom = { L, pw };
  }

  function pick(ev) {
    const r = canvas.getBoundingClientRect();
    const { L, pw } = canvas._geom;
    const km = ((ev.clientX - r.left - L) / pw) * totalKm;
    let best = 0;
    sm.forEach((s, i) => { if (Math.abs(s.km - km) < Math.abs(sm[best].km - km)) best = i; });
    hoverIdx = best;
    draw();
    onHover?.(sm[best]?.p || null);
  }
  canvas.onpointerdown = (e) => { canvas.setPointerCapture(e.pointerId); pick(e); };
  canvas.onpointermove = (e) => { if (e.buttons || e.pointerType === 'mouse') pick(e); };
  canvas.onpointerleave = () => { hoverIdx = null; draw(); onHover?.(null); };
  canvas.style.touchAction = 'pan-y';

  draw();
  return { redraw: draw };
}

/** Столбики: [{label, value, hi}] — hi подсвечивает текущий период. */
export function barChart(canvas, items, { height = 150, unit = '' } = {}) {
  const { ctx, w, h } = setup(canvas, height);
  const L = 6, R = 6, Tp = 18, B = 20;
  const pw = w - L - R, ph = h - Tp - B;
  const maxV = Math.max(1, ...items.map((i) => i.value));
  const bw = pw / items.length;
  ctx.clearRect(0, 0, w, h);
  ctx.font = '10px ' + css('--font-sans');
  ctx.textAlign = 'center';
  items.forEach((it, i) => {
    const bh = (it.value / maxV) * ph;
    const x = L + i * bw + bw * 0.15;
    const y = Tp + ph - bh;
    ctx.fillStyle = it.hi ? css('--c-accent') : '#b3b3c9';
    ctx.strokeStyle = css('--c-edge');
    if (bh > 0) {
      ctx.fillRect(x, y, bw * 0.7, bh);
      ctx.strokeRect(x + 0.5, y + 0.5, bw * 0.7 - 1, bh - 1);
    }
    ctx.fillStyle = css('--c-muted');
    ctx.textBaseline = 'top';
    if (items.length <= 8 || it.hi || (items.length - 1 - i) % 2 === 0) ctx.fillText(it.label, x + bw * 0.35, Tp + ph + 5);
    if (it.value > 0 && (it.hi || items.length <= 12)) {
      ctx.fillStyle = css('--c-text');
      ctx.textBaseline = 'bottom';
      ctx.fillText(fmtNum(it.value, it.value < 10 ? 1 : 0) + unit, x + bw * 0.35, y - 2);
    }
  });
  ctx.strokeStyle = css('--c-edge');
  ctx.beginPath(); ctx.moveTo(L, Tp + ph + 0.5); ctx.lineTo(L + pw, Tp + ph + 0.5); ctx.stroke();
}
