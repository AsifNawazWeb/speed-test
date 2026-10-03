const UNIT_LABEL = { mbps: 'Mbps', mbs: 'MB/s' };

export const toUnit = (mbps, unit) => (mbps == null ? null : unit === 'mbs' ? mbps / 8 : mbps);

export const formatNumber = (value, digits = 1) =>
  value == null ? '--' : value.toLocaleString(undefined, { maximumFractionDigits: digits });

export const formatSpeed = (mbps, unit) => `${formatNumber(toUnit(mbps, unit))} ${UNIT_LABEL[unit]}`;

export function buildSummary(result, unit) {
  const lines = [`Speed Test result (${new Date(result.ts).toLocaleString()})`];
  lines.push(`Download: ${formatSpeed(result.download, unit)}`);
  lines.push(`Upload: ${formatSpeed(result.upload, unit)}`);
  lines.push(`Ping: ${formatNumber(result.ping, 0)} ms`);
  lines.push(`Jitter: ${formatNumber(result.jitter, 0)} ms`);
  if (result.loss != null) lines.push(`Packet loss: ${formatNumber(result.loss, 1)}%`);
  if (result.bufferbloat) {
    lines.push(`Bufferbloat grade: ${result.bufferbloat} (+${formatNumber(result.bufferbloatIncrease, 0)} ms under load)`);
  }
  if (result.ip) lines.push(`IP: ${result.ip}`);
  return lines.join('\n');
}

export async function copySummary(result, unit) {
  const text = buildSummary(result, unit);
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall back to legacy copy */
    }
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

const download = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const columns = [
  { key: 'ts', label: 'timestamp' },
  { key: 'download', label: 'download_mbps' },
  { key: 'upload', label: 'upload_mbps' },
  { key: 'ping', label: 'ping_ms' },
  { key: 'jitter', label: 'jitter_ms' },
  { key: 'loss', label: 'packet_loss_pct' },
  { key: 'bufferbloat', label: 'bufferbloat_grade' },
  { key: 'bufferbloatIncrease', label: 'bufferbloat_increase_ms' },
  { key: 'ip', label: 'ip' },
];

export function exportJson(results) {
  download(
    new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' }),
    `speed-test-history-${Date.now()}.json`,
  );
}

export function exportCsv(results) {
  const header = columns.map((column) => column.label).join(',');
  const rows = results.map((result) =>
    columns
      .map((column) => {
        const value = result[column.key];
        if (value == null) return '';
        const text = String(value);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      })
      .join(','),
  );
  download(new Blob([[header, ...rows].join('\n')], { type: 'text/csv' }), `speed-test-history-${Date.now()}.csv`);
}

function drawCard(result, unit) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext('2d');

  const background = ctx.createLinearGradient(0, 0, 1200, 630);
  background.addColorStop(0, '#0b1020');
  background.addColorStop(1, '#14213d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 1200, 630);

  ctx.fillStyle = '#eef2ff';
  ctx.font = '700 42px system-ui, sans-serif';
  ctx.fillText('Speed Test', 60, 86);

  ctx.fillStyle = '#93a1bd';
  ctx.font = '24px system-ui, sans-serif';
  ctx.fillText(new Date(result.ts).toLocaleString(), 60, 124);

  const cards = [
    { label: 'DOWNLOAD', value: `${formatNumber(toUnit(result.download, unit))}`, unit: UNIT_LABEL[unit], color: '#60a5fa' },
    { label: 'UPLOAD', value: `${formatNumber(toUnit(result.upload, unit))}`, unit: UNIT_LABEL[unit], color: '#34d399' },
  ];

  cards.forEach((card, index) => {
    const x = 60 + index * 545;
    ctx.fillStyle = '#131a2d';
    ctx.beginPath();
    ctx.roundRect(x, 180, 505, 230, 24);
    ctx.fill();

    ctx.fillStyle = '#93a1bd';
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.fillText(card.label, x + 36, 232);

    ctx.fillStyle = card.color;
    ctx.font = '800 92px system-ui, sans-serif';
    ctx.fillText(card.value, x + 36, 330);

    const width = ctx.measureText(card.value).width;
    ctx.fillStyle = '#93a1bd';
    ctx.font = '600 24px system-ui, sans-serif';
    ctx.fillText(card.unit, x + 48 + width, 330);
  });

  const stats = [
    ['PING', result.ping == null ? '--' : `${formatNumber(result.ping, 0)} ms`],
    ['JITTER', result.jitter == null ? '--' : `${formatNumber(result.jitter, 0)} ms`],
    ['LOSS', result.loss == null ? '--' : `${formatNumber(result.loss, 1)} %`],
    ['BUFFERBLOAT', result.bufferbloat ?? '--'],
  ];

  stats.forEach(([label, value], index) => {
    const x = 60 + index * 272;
    ctx.fillStyle = '#93a1bd';
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillText(label, x, 490);
    ctx.fillStyle = '#eef2ff';
    ctx.font = '700 34px system-ui, sans-serif';
    ctx.fillText(value, x, 532);
  });

  ctx.fillStyle = '#5b6b83';
  ctx.font = '20px system-ui, sans-serif';
  ctx.fillText(result.ip ? `IP ${result.ip}` : 'Browser based measurement', 60, 585);

  return canvas;
}

export async function shareCard(result, unit) {
  const canvas = drawCard(result, unit);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return false;
  const file = new File([blob], 'speed-test.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Speed Test result' });
      return true;
    } catch {
      return false;
    }
  }
  download(blob, 'speed-test.png');
  return true;
}
