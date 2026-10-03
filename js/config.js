export const CONFIG = {
  appName: 'Speed Test',
  endpoints: {
    down: (bytes) =>
      `https://speed.cloudflare.com/__down?bytes=${bytes}&r=${Math.random().toString(36).slice(2)}`,
    up: 'https://speed.cloudflare.com/__up',
  },
  ping: {
    warmupCount: 1,
    count: 10,
    timeoutMs: 2000,
  },
  download: {
    streams: 4,
    maxStreams: 8,
    chunkBytes: 25 * 1024 * 1024,
    quickMs: 10000,
    fullMs: 30000,
    rampMs: 1000,
    sampleMs: 200,
  },
  upload: {
    streams: 3,
    maxStreams: 6,
    chunkBytes: 8 * 1024 * 1024,
    quickMs: 10000,
    fullMs: 30000,
    rampMs: 1000,
    sampleMs: 200,
  },
  bufferbloat: {
    probeIntervalMs: 400,
    grades: [
      { grade: 'A', maxMs: 30 },
      { grade: 'B', maxMs: 60 },
      { grade: 'C', maxMs: 150 },
      { grade: 'D', maxMs: 400 },
      { grade: 'F', maxMs: Infinity },
    ],
  },
  storage: {
    historyKey: 'speedtest.history.v1',
    settingsKey: 'speedtest.settings.v1',
    historyLimit: 50,
  },
  history: {
    trendPoints: 30,
  },
};

export const DURATIONS = {
  quick: CONFIG.download.quickMs,
  full: CONFIG.download.fullMs,
};
