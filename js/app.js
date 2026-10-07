import { CONFIG } from './config.js';
import {
  measureLatency,
  measureDownload,
  measureUpload,
  createLatencyMonitor,
  gradeBufferbloat,
} from './engine.js';
import { Gauge } from './gauge.js';
import { Sparkline } from './sparkline.js';
import {
  loadHistory,
  saveResult,
  clearHistory,
  renderHistoryTable,
  renderTrendChart,
} from './history.js';
import {
  formatNumber,
  formatSpeed,
  toUnit,
  copySummary,
  shareCard,
  exportJson,
  exportCsv,
} from './share.js';

const $ = (id) => document.getElementById(id);

const els = {
  offlineBanner: $('offlineBanner'),
  installBtn: $('installBtn'),
  themeToggle: $('themeToggle'),
  gauge: $('gauge'),
  speedValue: $('speedValue'),
  speedUnit: $('speedUnit'),
  phaseLabel: $('phaseLabel'),
  progressBar: $('progressBar'),
  startBtn: $('startBtn'),
  sparkline: $('sparkline'),
  statPing: $('statPing'),
  statPingDetail: $('statPingDetail'),
  statJitter: $('statJitter'),
  statLoss: $('statLoss'),
  statDownload: $('statDownload'),
  statUpload: $('statUpload'),
  statBufferbloat: $('statBufferbloat'),
  statBufferbloatDetail: $('statBufferbloatDetail'),
  infoIp: $('infoIp'),
  infoType: $('infoType'),
  infoDownlink: $('infoDownlink'),
  infoRtt: $('infoRtt'),
  resultDelta: $('resultDelta'),
  shareBtn: $('shareBtn'),
  copyBtn: $('copyBtn'),
  exportJsonBtn: $('exportJsonBtn'),
  exportCsvBtn: $('exportCsvBtn'),
  clearHistoryBtn: $('clearHistoryBtn'),
  trendChart: $('trendChart'),
  historyBody: $('historyBody'),
  historyEmpty: $('historyEmpty'),
};

const settings = {
  unit: 'mbps',
  duration: 'quick',
  theme: null,
};

const loadSettings = () => {
  try {
    const raw = localStorage.getItem(CONFIG.storage.settingsKey);
    if (raw) Object.assign(settings, JSON.parse(raw));
  } catch {
    /* storage unavailable */
  }
};

const saveSettings = () => {
  try {
    localStorage.setItem(CONFIG.storage.settingsKey, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
};

loadSettings();
if (!settings.theme) {
  settings.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
document.documentElement.dataset.theme = settings.theme;

const gauge = new Gauge(els.gauge);
const sparkline = new Sparkline(els.sparkline);

let state = 'idle';
let activeController = null;
let lastResult = null;
let lastSample = null;
let emaSpeed = 0;
let deferredPrompt = null;

const unitLabel = () => (settings.unit === 'mbs' ? 'MB/s' : 'Mbps');

const displaySpeed = (mbps) => {
  els.speedValue.textContent = formatNumber(toUnit(mbps, settings.unit));
  els.speedUnit.textContent = unitLabel();
};

const setPhase = (label, progress) => {
  els.phaseLabel.textContent = label;
  if (progress != null) els.progressBar.style.width = `${Math.min(100, progress * 100)}%`;
};

const setRunning = (running) => {
  state = running ? 'running' : 'idle';
  els.startBtn.textContent = running ? 'Stop' : 'Start test';
  els.startBtn.classList.toggle('btn-danger', running);
  document.body.classList.toggle('is-running', running);
};

const updateUnitLabels = () => {
  els.statDownload.nextElementSibling.textContent = unitLabel();
  els.statUpload.nextElementSibling.textContent = unitLabel();
  els.speedUnit.textContent = unitLabel();
};

const resetStats = () => {
  els.statPing.textContent = '--';
  els.statPingDetail.textContent = '';
  els.statJitter.textContent = '--';
  els.statLoss.textContent = '--';
  els.statDownload.textContent = '--';
  els.statUpload.textContent = '--';
  els.statBufferbloat.textContent = '--';
  els.statBufferbloatDetail.textContent = '';
  els.resultDelta.textContent = '';
  els.resultDelta.className = 'delta';
};

const renderResult = (result) => {
  els.statPing.textContent = result.ping == null ? '--' : formatNumber(result.ping, 0);
  els.statPingDetail.textContent = result.pingMin == null ? '' : `min ${formatNumber(result.pingMin, 0)} ms`;
  els.statJitter.textContent = result.jitter == null ? '--' : formatNumber(result.jitter, 0);
  els.statLoss.textContent = result.loss == null ? '--' : formatNumber(result.loss, 1);
  els.statDownload.textContent = result.download == null ? '--' : formatNumber(toUnit(result.download, settings.unit));
  els.statUpload.textContent = result.upload == null ? '--' : formatNumber(toUnit(result.upload, settings.unit));
  els.statBufferbloat.textContent = result.bufferbloat ?? '--';
  els.statBufferbloatDetail.textContent =
    result.bufferbloatIncrease == null ? '' : `+${formatNumber(result.bufferbloatIncrease, 0)} ms under load`;
  displaySpeed(result.download ?? 0);
};

const updateDelta = (result, previous) => {
  if (!previous?.download || !result.download) return;
  const change = ((result.download - previous.download) / previous.download) * 100;
  els.resultDelta.textContent = `${change >= 0 ? '+' : ''}${formatNumber(change, 1)}% download vs previous run`;
  els.resultDelta.className = `delta ${change >= 0 ? 'positive' : 'negative'}`;
};

const refreshHistoryUI = () => {
  const history = loadHistory();
  renderHistoryTable(els.historyBody, history, (mbps) => formatSpeed(mbps, settings.unit));
  renderTrendChart(els.trendChart, history, (mbps) => formatSpeed(mbps, settings.unit));
  els.historyEmpty.hidden = history.length > 0;
  els.exportJsonBtn.disabled = history.length === 0;
  els.exportCsvBtn.disabled = history.length === 0;
  els.clearHistoryBtn.disabled = history.length === 0;
};

const updateConnectionInfo = () => {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  els.infoType.textContent = connection?.effectiveType ? connection.effectiveType.toUpperCase() : '--';
  els.infoDownlink.textContent = connection?.downlink != null ? `${connection.downlink} Mbps` : '--';
  els.infoRtt.textContent = connection?.rtt != null ? `${connection.rtt} ms` : '--';
};

const onPingProgress = ({ done, total, ping, pingMin, jitter, loss }) => {
  setPhase(`Measuring latency... ${done}/${total}`, done / total);
  els.statPing.textContent = ping == null ? '--' : formatNumber(ping, 0);
  els.statPingDetail.textContent = pingMin == null ? '' : `min ${formatNumber(pingMin, 0)} ms`;
  els.statJitter.textContent = jitter == null ? '--' : formatNumber(jitter, 0);
  els.statLoss.textContent = formatNumber(loss, 1);
};

const resetLive = () => {
  lastSample = null;
  emaSpeed = 0;
};

const onSpeedSample = (sample) => {
  if (lastSample) {
    const dt = (sample.t - lastSample.t) / 1000;
    const bytes = sample.bytes - lastSample.bytes;
    if (dt > 0) {
      const instant = (bytes * 8) / dt / 1e6;
      emaSpeed = emaSpeed ? emaSpeed * 0.6 + instant * 0.4 : instant;
      displaySpeed(emaSpeed);
      gauge.setValue(emaSpeed);
      sparkline.push(emaSpeed);
    }
  }
  lastSample = sample;
};

const onSpeedProgress = ({ elapsedMs, durationMs }) => {
  setPhase(els.phaseLabel.textContent, elapsedMs / durationMs);
};

const finishResult = (result) => {
  const previous = loadHistory().at(-1) ?? null;
  saveResult(result);
  updateDelta(result, previous);
  lastResult = result;
  renderResult(result);
  gauge.setValue(result.download ?? 0);
  setPhase('Test complete', 1);
  els.shareBtn.disabled = false;
  els.copyBtn.disabled = false;
  refreshHistoryUI();
};

async function runTest() {
  if (state === 'running') return;

  const controller = new AbortController();
  activeController = controller;
  lastResult = null;
  els.shareBtn.disabled = true;
  els.copyBtn.disabled = true;
  gauge.reset();
  sparkline.clear();
  resetStats();
  resetLive();
  setRunning(true);
  document.body.dataset.phase = '';

  const durationMs = settings.duration === 'full' ? CONFIG.download.fullMs : CONFIG.download.quickMs;
  const result = { ts: Date.now() };
  const monitor = createLatencyMonitor();

  try {
    if (!navigator.onLine) throw new Error('No internet connection');

    setPhase('Measuring latency...', 0);
    document.body.dataset.phase = 'ping';
    const latency = await measureLatency({ signal: controller.signal, onProgress: onPingProgress });
    if (controller.signal.aborted) return;
    Object.assign(result, {
      ping: latency.ping,
      pingMin: latency.pingMin,
      jitter: latency.jitter,
      loss: latency.loss,
      ip: latency.ip,
    });
    if (latency.ip) els.infoIp.textContent = latency.ip;

    monitor.start();

    resetLive();
    sparkline.clear();
    document.body.dataset.phase = 'download';
    setPhase('Testing download...', 0);
    const download = await measureDownload({
      durationMs,
      signal: controller.signal,
      onSample: onSpeedSample,
      onProgress: onSpeedProgress,
    });
    if (controller.signal.aborted) return;
    result.download = download.mbps;
    els.statDownload.textContent = formatNumber(toUnit(download.mbps, settings.unit));
    gauge.setValue(download.mbps);
    displaySpeed(download.mbps);

    resetLive();
    sparkline.clear();
    document.body.dataset.phase = 'upload';
    setPhase('Testing upload...', 0);
    const upload = await measureUpload({
      durationMs,
      signal: controller.signal,
      onSample: onSpeedSample,
      onProgress: onSpeedProgress,
    });
    if (controller.signal.aborted) return;
    result.upload = upload.mbps;
    els.statUpload.textContent = formatNumber(toUnit(upload.mbps, settings.unit));
    gauge.setValue(upload.mbps);
    displaySpeed(upload.mbps);

    const bufferbloat = gradeBufferbloat(result.ping, monitor.rtts);
    result.bufferbloat = bufferbloat.grade;
    result.bufferbloatIncrease = bufferbloat.increaseMs;
    finishResult(result);
  } catch (error) {
    if (controller.signal.aborted) {
      setPhase('Test cancelled', 0);
    } else {
      setPhase(`Test failed: ${error.message}`, 0);
      console.error(error);
    }
  } finally {
    monitor.stop();
    activeController = null;
    document.body.dataset.phase = '';
    setRunning(false);
  }
}

els.startBtn.addEventListener('click', () => {
  if (state === 'running') {
    activeController?.abort();
    return;
  }
  runTest();
});

$('durationQuick').addEventListener('click', () => {
  settings.duration = 'quick';
  $('durationQuick').classList.add('is-active');
  $('durationFull').classList.remove('is-active');
  saveSettings();
});

$('durationFull').addEventListener('click', () => {
  settings.duration = 'full';
  $('durationFull').classList.add('is-active');
  $('durationQuick').classList.remove('is-active');
  saveSettings();
});

const applyUnit = (unit) => {
  settings.unit = unit;
  $('unitMbps').classList.toggle('is-active', unit === 'mbps');
  $('unitMBs').classList.toggle('is-active', unit === 'mbs');
  updateUnitLabels();
  saveSettings();
  if (lastResult) renderResult(lastResult);
  refreshHistoryUI();
};

$('unitMbps').addEventListener('click', () => applyUnit('mbps'));
$('unitMBs').addEventListener('click', () => applyUnit('mbs'));

els.themeToggle.addEventListener('click', () => {
  settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = settings.theme;
  saveSettings();
  sparkline.draw();
  refreshHistoryUI();
});

els.shareBtn.addEventListener('click', async () => {
  if (!lastResult) return;
  const ok = await shareCard(lastResult, settings.unit);
  if (!ok) setPhase('Sharing not available', 0);
});

els.copyBtn.addEventListener('click', async () => {
  if (!lastResult) return;
  const ok = await copySummary(lastResult, settings.unit);
  els.copyBtn.textContent = ok ? 'Copied!' : 'Copy failed';
  setTimeout(() => {
    els.copyBtn.textContent = 'Copy summary';
  }, 1500);
});

els.exportJsonBtn.addEventListener('click', () => exportJson(loadHistory()));
els.exportCsvBtn.addEventListener('click', () => exportCsv(loadHistory()));

els.clearHistoryBtn.addEventListener('click', () => {
  if (!window.confirm('Delete all saved test results?')) return;
  clearHistory();
  refreshHistoryUI();
});

window.addEventListener('online', () => {
  els.offlineBanner.hidden = true;
  updateConnectionInfo();
});
window.addEventListener('offline', () => {
  els.offlineBanner.hidden = false;
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
  els.installBtn.hidden = false;
});

els.installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  els.installBtn.hidden = true;
});

window.addEventListener('appinstalled', () => {
  els.installBtn.hidden = true;
  deferredPrompt = null;
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => refreshHistoryUI(), 150);
});

const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
connection?.addEventListener?.('change', updateConnectionInfo);

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

const init = () => {
  applyUnit(settings.unit);
  if (settings.duration === 'full') {
    $('durationFull').classList.add('is-active');
    $('durationQuick').classList.remove('is-active');
  }
  els.offlineBanner.hidden = navigator.onLine;
  updateConnectionInfo();
  refreshHistoryUI();
  displaySpeed(0);
};

init();
