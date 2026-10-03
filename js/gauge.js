const STEPS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const START_ANGLE = Math.PI * 0.75;
const SWEEP = Math.PI * 1.5;

const niceMax = (value) => STEPS.find((step) => value <= step * 0.85) ?? STEPS[STEPS.length - 1];

export class Gauge {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.target = 0;
    this.value = 0;
    this.max = 100;
    this.frame = null;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.loop();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const { clientWidth, clientHeight } = this.canvas;
    if (!clientWidth || !clientHeight) return;
    this.canvas.width = Math.round(clientWidth * dpr);
    this.canvas.height = Math.round(clientHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  setValue(mbps) {
    if (!Number.isFinite(mbps)) return;
    this.target = Math.max(0, mbps);
    this.max = Math.max(this.max, niceMax(this.target));
  }

  reset() {
    this.target = 0;
    this.value = 0;
    this.max = 100;
    this.draw();
  }

  color(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  loop() {
    const diff = this.target - this.value;
    if (Math.abs(diff) > 0.05) {
      this.value += diff * 0.12;
      this.draw();
    }
    this.frame = requestAnimationFrame(() => this.loop());
  }

  fraction(value) {
    const clamped = Math.min(Math.max(value, 0), this.max);
    return Math.log10(1 + clamped) / Math.log10(1 + this.max);
  }

  draw() {
    const ctx = this.ctx;
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (!w || !h) return;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) / 2 - 14;
    const track = this.color('--surface-2', '#1a2338');
    const border = this.color('--border', '#263149');
    const text = this.color('--muted', '#93a1bd');
    const accent = this.color('--accent', '#60a5fa');
    const accent2 = this.color('--accent-2', '#22d3ee');

    ctx.clearRect(0, 0, w, h);

    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.strokeStyle = track;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, START_ANGLE, START_ANGLE + SWEEP);
    ctx.stroke();

    const progress = this.fraction(this.value);
    if (progress > 0.005) {
      const gradient = ctx.createLinearGradient(0, h, w, 0);
      gradient.addColorStop(0, accent);
      gradient.addColorStop(1, accent2);
      ctx.strokeStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, START_ANGLE, START_ANGLE + SWEEP * progress);
      ctx.stroke();
    }

    const ticks = STEPS.filter((step) => step <= this.max);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.max(10, radius * 0.085)}px system-ui, sans-serif`;
    for (const tick of ticks) {
      const angle = START_ANGLE + SWEEP * this.fraction(tick);
      const inner = radius - 26;
      const outer = radius - 18;
      ctx.strokeStyle = border;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.stroke();
      ctx.fillStyle = text;
      ctx.fillText(String(tick), cx + Math.cos(angle) * (inner - 12), cy + Math.sin(angle) * (inner - 12));
    }

    const needleAngle = START_ANGLE + SWEEP * this.fraction(this.value);
    ctx.strokeStyle = this.color('--text', '#eef2ff');
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(needleAngle) * 8, cy - Math.sin(needleAngle) * 8);
    ctx.lineTo(cx + Math.cos(needleAngle) * (radius - 34), cy + Math.sin(needleAngle) * (radius - 34));
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}
