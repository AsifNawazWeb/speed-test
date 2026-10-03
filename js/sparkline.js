export class Sparkline {
  constructor(canvas, { maxPoints = 300 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.maxPoints = maxPoints;
    this.values = [];
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
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

  push(value) {
    if (!Number.isFinite(value)) return;
    this.values.push(Math.max(0, value));
    if (this.values.length > this.maxPoints) this.values.shift();
    this.draw();
  }

  clear() {
    this.values = [];
    this.draw();
  }

  color(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  draw() {
    const ctx = this.ctx;
    const { clientWidth: w, clientHeight: h } = this.canvas;
    ctx.clearRect(0, 0, w, h);
    if (!w || !h) return;

    const grid = this.color('--border', '#263149');
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(w, h - 0.5);
    ctx.stroke();

    if (this.values.length < 2) return;

    const max = Math.max(...this.values, 1) * 1.15;
    const stepX = w / (this.values.length - 1);

    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    const accent = this.color('--accent', '#60a5fa');
    gradient.addColorStop(0, `${accent}55`);
    gradient.addColorStop(1, `${accent}00`);

    ctx.beginPath();
    this.values.forEach((value, index) => {
      const x = index * stepX;
      const y = h - (value / max) * (h - 8) - 4;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    const linePath = new Path2D();
    this.values.forEach((value, index) => {
      const x = index * stepX;
      const y = h - (value / max) * (h - 8) - 4;
      if (index === 0) linePath.moveTo(x, y);
      else linePath.lineTo(x, y);
    });

    ctx.save();
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke(linePath);
  }
}
