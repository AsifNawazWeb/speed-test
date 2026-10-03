import { CONFIG } from './config.js';

const now = () => performance.now();

const sum = (values) => values.reduce((acc, value) => acc + value, 0);

export const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const jitter = (values) => {
  if (values.length < 2) return null;
  const deltas = [];
  for (let i = 1; i < values.length; i += 1) deltas.push(Math.abs(values[i] - values[i - 1]));
  return sum(deltas) / deltas.length;
};

const withTimeout = (timeoutMs, outerSignal) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs);
  const onAbort = () => controller.abort(outerSignal.reason);
  if (outerSignal) {
    if (outerSignal.aborted) controller.abort(outerSignal.reason);
    else outerSignal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (outerSignal) outerSignal.removeEventListener('abort', onAbort);
    },
  };
};

const isAbort = (error) => error && (error.name === 'AbortError' || error.name === 'TimeoutError');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const parseServerTiming = (header) => {
  if (!header) return null;
  const match = header.match(/cfL4;desc="([^"]*)"/i);
  if (!match) return null;
  const params = new URLSearchParams(match[1].replace(/^\?/, ''));
  const micros = (key) => {
    const value = Number(params.get(key));
    return Number.isFinite(value) ? value / 1000 : null;
  };
  return { rtt: micros('rtt'), minRtt: micros('min_rtt'), rttVar: micros('rtt_var') };
};

const resourceTimingRtt = (url) => {
  const entries = performance.getEntriesByName(url, 'resource');
  const entry = entries[entries.length - 1];
  if (!entry || !(entry.responseStart > 0) || !(entry.requestStart > 0)) return null;
  return {
    rtt: entry.responseStart - entry.requestStart,
    newConnection: entry.connectEnd > entry.connectStart,
  };
};

async function probeLatency(signal, timeoutMs = CONFIG.ping.timeoutMs) {
  const url = CONFIG.endpoints.down(0);
  const { signal: timedSignal, cleanup } = withTimeout(timeoutMs, signal);
  const started = now();
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: timedSignal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const serverTiming = parseServerTiming(response.headers.get('server-timing'));
    const ip = response.headers.get('cf-meta-ip');
    await response.arrayBuffer();
    const timing = resourceTimingRtt(url);
    const wallRtt = now() - started;
    const rtt = serverTiming?.rtt ?? timing?.rtt ?? wallRtt;
    return {
      rtt,
      minRtt: serverTiming?.minRtt ?? rtt,
      rttVar: serverTiming?.rttVar ?? null,
      newConnection: timing?.newConnection ?? false,
      ip,
    };
  } finally {
    cleanup();
  }
}

export async function measureLatency({ signal, onProgress } = {}) {
  for (let i = 0; i < CONFIG.ping.warmupCount; i += 1) {
    if (signal?.aborted) break;
    try {
      await probeLatency(signal, CONFIG.ping.warmupTimeoutMs);
    } catch {
      /* retry the warm-up */
    }
    if (i < CONFIG.ping.warmupCount - 1) await sleep(CONFIG.ping.warmupDelayMs);
  }

  const samples = [];
  const allSamples = [];
  const minSamples = [];
  const jitterSamples = [];
  let failures = 0;
  let ip = null;

  const snapshot = () => {
    const usable = samples.length ? samples : allSamples;
    const usableMin = minSamples.length ? minSamples : allSamples;
    return {
      ping: median(usable),
      pingMin: usableMin.length ? Math.min(...usableMin) : null,
      jitter: jitterSamples.length ? median(jitterSamples) : jitter(usable),
    };
  };

  for (let i = 0; i < CONFIG.ping.count; i += 1) {
    if (signal?.aborted) break;
    try {
      const probe = await probeLatency(signal);
      allSamples.push(probe.rtt);
      minSamples.push(probe.minRtt);
      if (!probe.newConnection) samples.push(probe.rtt);
      if (probe.rttVar != null) jitterSamples.push(probe.rttVar);
      if (probe.ip) ip = probe.ip;
    } catch {
      if (signal?.aborted) break;
      failures += 1;
    }
    const stats = snapshot();
    onProgress?.({
      done: i + 1,
      total: CONFIG.ping.count,
      ping: stats.ping,
      pingMin: stats.pingMin,
      jitter: stats.jitter,
      loss: (failures / CONFIG.ping.count) * 100,
    });
    if (i < CONFIG.ping.count - 1) await sleep(CONFIG.ping.probeDelayMs);
  }

  const stats = snapshot();
  return {
    ping: stats.ping,
    pingMin: stats.pingMin,
    jitter: stats.jitter,
    loss: (failures / CONFIG.ping.count) * 100,
    samples: samples.length ? samples : allSamples,
    ip,
  };
}

const computeSpeedMbps = (samples, rampMs) => {
  if (samples.length < 2) return 0;
  const usable = samples.filter((sample) => sample.t >= rampMs);
  const window = usable.length >= 2 ? usable : samples;
  const first = window[0];
  const last = window[window.length - 1];
  const seconds = (last.t - first.t) / 1000;
  if (seconds <= 0) return 0;
  return ((last.bytes - first.bytes) * 8) / seconds / 1e6;
};

export async function measureDownload({ durationMs, streams, signal, onSample, onProgress } = {}) {
  const streamCount = streams ?? CONFIG.download.streams;
  const totals = new Float64Array(streamCount);
  const samples = [];
  const started = now();
  let stopped = false;

  const totalBytes = () => sum(totals);

  const emit = () => {
    const sample = { t: now() - started, bytes: totalBytes() };
    samples.push(sample);
    onSample?.(sample);
    onProgress?.({
      elapsedMs: sample.t,
      durationMs,
      speedMbps: computeSpeedMbps(samples, CONFIG.download.rampMs),
    });
  };

  const sampler = setInterval(emit, CONFIG.download.sampleMs);

  const worker = async (index) => {
    while (!stopped && !signal?.aborted && now() - started < durationMs) {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      const remaining = durationMs - (now() - started);
      const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), remaining + 5000);
      try {
        const response = await fetch(CONFIG.endpoints.down(CONFIG.download.chunkBytes), {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) totals[index] += value.byteLength;
          if (stopped || signal?.aborted || now() - started >= durationMs) {
            reader.cancel().catch(() => {});
            break;
          }
        }
      } catch {
        if (signal?.aborted || stopped) break;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    }
  };

  await Promise.all(Array.from({ length: streamCount }, (_, index) => worker(index)));
  stopped = true;
  clearInterval(sampler);
  emit();

  return {
    mbps: computeSpeedMbps(samples, CONFIG.download.rampMs),
    samples,
    bytes: totalBytes(),
  };
}

let uploadPayload = null;

const getUploadPayload = () => {
  if (!uploadPayload) {
    const chunk = new Uint8Array(CONFIG.upload.chunkBytes);
    const max = 65536;
    for (let offset = 0; offset < chunk.length; offset += max) {
      crypto.getRandomValues(chunk.subarray(offset, Math.min(offset + max, chunk.length)));
    }
    uploadPayload = new Blob([chunk], { type: 'application/octet-stream' });
  }
  return uploadPayload;
};

function sendChunk({ blob, signal, onBytes }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let counted = 0;
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      xhr.upload.onprogress = null;
      xhr.onload = null;
      xhr.onerror = null;
      xhr.onabort = null;
    };

    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };

    const onAbort = () => xhr.abort();

    xhr.open('POST', CONFIG.endpoints.up, true);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.timeout = 30000;

    xhr.upload.onprogress = (event) => {
      const delta = event.loaded - counted;
      counted = event.loaded;
      if (delta > 0) onBytes(delta);
    };

    xhr.onload = () => {
      if (counted < blob.size) {
        onBytes(blob.size - counted);
        counted = blob.size;
      }
      if (xhr.status >= 200 && xhr.status < 300) settle(resolve, xhr);
      else settle(reject, new Error(`HTTP ${xhr.status}`));
    };
    xhr.onerror = () => settle(reject, new Error('Network error'));
    xhr.onabort = () => settle(reject, new DOMException('Aborted', 'AbortError'));
    xhr.ontimeout = () => settle(reject, new Error('Upload timeout'));

    if (signal) {
      if (signal.aborted) {
        settle(reject, signal.reason ?? new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    xhr.send(blob);
  });
}

export async function measureUpload({ durationMs, streams, signal, onSample, onProgress } = {}) {
  const streamCount = streams ?? CONFIG.upload.streams;
  const totals = new Float64Array(streamCount);
  const samples = [];
  const started = now();
  const blob = getUploadPayload();
  let stopped = false;

  const totalBytes = () => sum(totals);

  const emit = () => {
    const sample = { t: now() - started, bytes: totalBytes() };
    samples.push(sample);
    onSample?.(sample);
    onProgress?.({
      elapsedMs: sample.t,
      durationMs,
      speedMbps: computeSpeedMbps(samples, CONFIG.upload.rampMs),
    });
  };

  const sampler = setInterval(emit, CONFIG.upload.sampleMs);

  const worker = async (index) => {
    while (!stopped && !signal?.aborted && now() - started < durationMs) {
      try {
        await sendChunk({
          blob,
          signal,
          onBytes: (bytes) => {
            totals[index] += bytes;
          },
        });
      } catch (error) {
        if (isAbort(error) || signal?.aborted) break;
      }
    }
  };

  await Promise.all(Array.from({ length: streamCount }, (_, index) => worker(index)));
  stopped = true;
  clearInterval(sampler);
  emit();

  return {
    mbps: computeSpeedMbps(samples, CONFIG.upload.rampMs),
    samples,
    bytes: totalBytes(),
  };
}

export function createLatencyMonitor({ intervalMs = CONFIG.bufferbloat.probeIntervalMs } = {}) {
  const rtts = [];
  let timer = null;
  let running = false;

  const tick = async () => {
    if (!running) return;
    try {
      const { rtt } = await probeLatency();
      rtts.push(rtt);
    } catch {
      /* probe failed while link is saturated */
    }
  };

  return {
    rtts,
    start() {
      if (running) return;
      running = true;
      tick();
      timer = setInterval(tick, intervalMs);
    },
    stop() {
      running = false;
      clearInterval(timer);
      timer = null;
    },
  };
}

export function gradeBufferbloat(idleMs, loadedRtts) {
  const loaded = median(loadedRtts.filter((value) => Number.isFinite(value)));
  if (idleMs == null || loaded == null) return { grade: null, increaseMs: null, loadedMs: null };
  const increaseMs = Math.max(0, loaded - idleMs);
  const entry = CONFIG.bufferbloat.grades.find((item) => increaseMs <= item.maxMs);
  return { grade: entry.grade, increaseMs, loadedMs: loaded };
}
