const endpoint = 'https://raw.githubusercontent.com/sword0628/dodge-ridge-dashboard/chp-data/chp.json';
const cacheKey = 'dodge-ridge-chp-snapshot-v1';
const minute = 60_000;
const maxAge = 20 * minute;
let data;
let pending;
let retryAt = 0;
let failed = false;

export const segmentKey = segment => JSON.stringify([segment.highway,segment.start,segment.end,segment.direction]);

function isSnapshot(value) {
  return value?.schema === 1 && Number.isFinite(Date.parse(value.fetchedAt))
    && Number.isFinite(Date.parse(value.sourceUpdatedAt))
    && [value.outbound,value.return].every(segments => Array.isArray(segments) && segments.every(segment =>
      typeof segment?.highway === 'string' && typeof segment.start === 'string' && typeof segment.end === 'string' && Array.isArray(segment.events)));
}

try {
  const previous = JSON.parse(localStorage.getItem(cacheKey) ?? 'null');
  if (isSnapshot(previous)) data = previous;
} catch { /* Public updates still work without browser storage. */ }

export function chpSnapshot(now = Date.now()) {
  const sourceTime = Date.parse(data?.sourceUpdatedAt);
  const stale = !data || now - sourceTime > maxAge || sourceTime > now + 2 * minute;
  return {data,stale,failed};
}

export function refreshChpSnapshot() {
  if (pending || Date.now() < retryAt) return pending;
  pending = (async () => {
    try {
      const bucket = Math.floor(Date.now() / minute);
      const response = await fetch(`${endpoint}?minute=${bucket}`,{cache:'no-store',signal:AbortSignal.timeout(7_000)});
      if (!response.ok) throw new Error(`CHP HTTP ${response.status}`);
      const next = await response.json();
      if (!isSnapshot(next) || Date.parse(next.sourceUpdatedAt) > Date.now() + 2 * minute) throw new Error('Invalid CHP snapshot');
      if (!data || Date.parse(next.sourceUpdatedAt) >= Date.parse(data.sourceUpdatedAt)) {
        data = next;
        try { localStorage.setItem(cacheKey,JSON.stringify(data)); } catch {}
      }
      failed = false;
    } catch {
      failed = true;
      retryAt = Date.now() + minute;
    }
  })().finally(() => { pending = undefined; });
  return pending;
}

export function chpSegments(snapshot, returning) {
  return snapshot?.data?.[returning?'return':'outbound'] ?? [];
}
