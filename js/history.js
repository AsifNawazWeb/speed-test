import { CONFIG } from './config.js';

export function loadHistory() {
  try {
    const raw = localStorage.getItem(CONFIG.storage.historyKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveResult(result) {
  const history = loadHistory();
  history.push(result);
  const trimmed = history.slice(-CONFIG.storage.historyLimit);
  try {
    localStorage.setItem(CONFIG.storage.historyKey, JSON.stringify(trimmed));
  } catch {
    /* storage unavailable */
  }
  return trimmed;
}

export function clearHistory() {
  try {
    localStorage.removeItem(CONFIG.storage.historyKey);
  } catch {
    /* storage unavailable */
  }
}

const formatWhen = (ts) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts));

export function renderHistoryTable(tbody, results, formatSpeed) {
  tbody.textContent = '';
  const rows = [...results].reverse();
  for (const result of rows) {
    const tr = document.createElement('tr');
    const cells = [
      formatWhen(result.ts),
      result.ping == null ? '--' : `${Math.round(result.ping)} ms`,
      result.download == null ? '--' : formatSpeed(result.download),
      result.upload == null ? '--' : formatSpeed(result.upload),
      result.bufferbloat ?? '--',
    ];
    cells.forEach((value, index) => {
      const td = document.createElement('td');
      if (index === 4 && result.bufferbloat) {
        const span = document.createElement('span');
        span.className = `grade grade-${result.bufferbloat.toLowerCase()}`;
        span.textContent = value;
        td.append(span);
      } else {
        td.textContent = value;
      }
      tr.append(td);
    });
    tbody.append(tr);
  }
}

const drawSeries = (ctx, values, max, w, h, color) => {
  if (values.length < 2) return;
  const stepX = w / (values.length - 1);
  ctx.beginPath();
  values.forEach((value, index) => {
    const x = index * stepX;
    const y = h - (value / max) * (h - 10) - 5;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
};

export function renderTrendChart(canvas, results, formatAxis) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const { clientWidth: w, clientHeight: h } = canvas;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const points = [...results].slice(-CONFIG.history.trendPoints);
  const styles = getComputedStyle(document.documentElement);
  const border = styles.getPropertyValue('--border').trim() || '#263149';
  const text = styles.getPropertyValue('--muted').trim() || '#93a1bd';
  const downColor = styles.getPropertyValue('--down').trim() || '#60a5fa';
  const upColor = styles.getPropertyValue('--up').trim() || '#34d399';

  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h - 0.5);
  ctx.lineTo(w, h - 0.5);
  ctx.stroke();

  if (!points.length) {
    ctx.fillStyle = text;
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Run a test to see trends', w / 2, h / 2);
    return;
  }

  const down = points.map((point) => point.download ?? 0);
  const up = points.map((point) => point.upload ?? 0);
  const max = Math.max(...down, ...up, 1) * 1.15;

  drawSeries(ctx, down, max, w, h, downColor);
  drawSeries(ctx, up, max, w, h, upColor);

  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = text;
  ctx.textAlign = 'left';
  ctx.fillText(formatAxis(max), 2, 11);
  ctx.fillText('0', 2, h - 6);
}
