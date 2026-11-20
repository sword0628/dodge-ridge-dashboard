const OPEN_METEO = 'https://open-meteo.com/en/docs';
const NWS = 'https://www.weather.gov/documentation/services-web-api';
const QUICKMAP = 'https://quickmap.dot.ca.gov/';
const CWWP = 'https://cwwp2.dot.ca.gov';
const BC = 'https://api.open511.gov.bc.ca';
const HOUR = 3_600_000;
const DODGE_RIDGE = 'https://dodgeridge.com/';
const iso = ms => new Date(ms).toISOString();
const num = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const validTime = value => value && Number.isFinite(Date.parse(value)) ? iso(Date.parse(value)) : null;
const epoch = value => num(value) > 0 ? iso(Number(value) * 1000) : null;
const fulfilled = result => result.status === 'fulfilled' ? result.value : null;
const yes = value => value === true || String(value).toLowerCase() === 'true';
const unique = (rows, key) => [...new Map(rows.map(row => [key(row), row])).values()];
const pointOk = p => !!p && num(p.lat) !== null && num(p.lon) !== null && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
const point = (lat, lon) => ({lat: num(lat), lon: num(lon)});

async function fetchSource(url, accept = 'application/json') {
  const response = await fetch(url, {headers: {Accept: accept}, signal: AbortSignal.timeout?.(12_000)});
  if (!response.ok) {
    const error = new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    error.status = response.status;
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) error.retryAfterMs = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now());
    throw error;
  }
  return response;
}

async function fetchJson(url, accept) {
  const response = await fetchSource(url, accept);
  return {data: await response.json(), fetchedAt: iso(Date.now()), lastModified: validTime(response.headers.get('last-modified'))};
}

async function openMeteo(places, forecastDays = 8) {
  const parameters = new URLSearchParams({
    latitude: places.map(p => p.lat).join(','), longitude: places.map(p => p.lon).join(','),
    hourly: 'temperature_2m,apparent_temperature,snowfall,rain,wind_speed_10m,wind_gusts_10m,freezing_level_height',
    timezone: 'GMT', timeformat: 'unixtime', forecast_days: String(forecastDays), past_days: '1',
    temperature_unit: 'celsius', wind_speed_unit: 'kmh', precipitation_unit: 'mm',
  });
  if (places.every(p => num(p.elevation) !== null)) parameters.set('elevation', places.map(p => p.elevation).join(','));
  const {data, fetchedAt, lastModified} = await fetchJson(`https://api.open-meteo.com/v1/forecast?${parameters}`);
  const locations = Array.isArray(data) ? data : [data];
  if (locations.length !== places.length) throw new Error('Open-Meteo 返回的点位数量不符。');
  return locations.map(({hourly: h}) => {
    if (!h?.time?.length) throw new Error('Open-Meteo 逐小时数据缺失。');
    const hourly = h.time.map((time, i) => ({
      time: iso(time * 1000), temp: num(h.temperature_2m?.[i]), feels: num(h.apparent_temperature?.[i]),
      snow: num(h.snowfall?.[i]), rain: num(h.rain?.[i]), wind: num(h.wind_speed_10m?.[i]),
      gust: num(h.wind_gusts_10m?.[i]), freezingLevel: num(h.freezing_level_height?.[i]), snowLevel: null, snowRatio: null,
    }));
    return {hourly, source: 'Open-Meteo', sourceUrl: OPEN_METEO, updatedAt: lastModified ?? fetchedAt, fetchedAt,
      timestampKind: lastModified ? 'source-last-modified' : 'retrieved'};
  });
}

function durationMs(value = '') {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  return m ? 1000 * (Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0)) : 0;
}

function gridIntervals(layer) {
  return (layer?.values || []).map(({validTime: interval, value}) => {
    const [stamp, duration] = String(interval).split('/');
    const start = Date.parse(stamp);
    return {start, end: start + durationMs(duration), value: num(value)};
  }).filter(row => Number.isFinite(row.start) && row.end > row.start);
}

async function nwsGrid(place) {
  const {data: metadata} = await fetchJson(`https://api.weather.gov/points/${place.lat},${place.lon}`, 'application/geo+json');
  const sourceUrl = metadata?.properties?.forecastGridData;
  if (!sourceUrl || new URL(sourceUrl).origin !== 'https://api.weather.gov') throw new Error('NWS 网格点未发布。');
  const {data, fetchedAt} = await fetchJson(sourceUrl, 'application/geo+json');
  return {data: data.properties ?? {}, source: 'NWS 网格预报', sourceUrl, updatedAt: validTime(data.properties?.updateTime), fetchedAt};
}

function officialHourly(official) {
  const fields = {temp: 'temperature', feels: 'apparentTemperature', wind: 'windSpeed', gust: 'windGust', snowLevel: 'snowLevel'};
  const grids = Object.fromEntries(Object.entries(fields).map(([name, layer]) => [name, gridIntervals(official.data[layer])]));
  const start = Math.floor(Date.now() / HOUR) * HOUR;
  const hourly = Array.from({length: 8 * 24}, (_, i) => {
    const time = start + i * HOUR;
    return {time: iso(time), ...Object.fromEntries(Object.entries(grids).map(([field, intervals]) => [field,
      intervals.find(item => item.start <= time && time < item.end)?.value ?? null])), snow: null, rain: null, freezingLevel: null, snowRatio: null};
  });
  const snowfall = official.data.snowfallAmount;
  const snowScale = /:mm$/.test(String(snowfall?.uom)) ? 0.1 : /:cm$/.test(String(snowfall?.uom)) ? 1 : /:m$/.test(String(snowfall?.uom)) ? 100 : null;
  const accumulations = snowScale === null ? [] : gridIntervals(snowfall).filter(row => row.value !== null && row.end - row.start === 6 * HOUR)
    .map(row => ({start: iso(row.start), end: iso(row.end), snow: row.value * snowScale, source: official.source, sourceUrl: official.sourceUrl, updatedAt: official.updatedAt}));
  return {hourly, accumulations, source: official.source, sourceUrl: official.sourceUrl, updatedAt: official.updatedAt,
    fetchedAt: official.fetchedAt, timestampKind: 'source-reported'};
}

export async function weather(place) {
  if (!pointOk(place)) throw new Error('请先确认预报点经纬度。');
  const [main, grid, ratio] = await Promise.allSettled([openMeteo([place]), nwsGrid(place), null]);
  const official = fulfilled(grid);
  const snowRatio = fulfilled(ratio);
  const warnings = [];
  const discrepancies = [];
  if (main.status === 'rejected' && (!official || main.reason?.status === 429)) throw main.reason;
  const result = main.status === 'fulfilled' ? main.value[0] : officialHourly(official);
  if (main.status === 'rejected') warnings.push('Open-Meteo 暂不可用，当前为 NWS 网格预报。NWS 降雪量按 6 小时发布，逐小时降雪暂缺。');
  if (official) {
    const layer = official.data.snowLevel;
    const levels = /:(m|meter|metre)$/.test(String(layer?.uom)) ? gridIntervals(layer) : [];
    for (const row of result.hourly) {
      const time = Date.parse(row.time);
      row.snowLevel = levels.find(level => level.start <= time && time < level.end)?.value ?? null;
    }
    if (!levels.some(level => level.value !== null)) warnings.push('NWS 未发布该点的雪线高度。');
    const depth = official.data.snowfallAmount;
    const factor = /:mm$/.test(String(depth?.uom)) ? 0.1 : /:cm$/.test(String(depth?.uom)) ? 1 : /:m$/.test(String(depth?.uom)) ? 100 : null;
    if (factor !== null && main.status === 'fulfilled') for (const interval of gridIntervals(depth)) {
      if (interval.value === null || interval.start % HOUR || interval.end - interval.start !== 6 * HOUR) continue;
      // Open-Meteo stamps each preceding-hour accumulation at its end.
      const matched = result.hourly.filter(row => Date.parse(row.time) > interval.start && Date.parse(row.time) <= interval.end);
      if (matched.length !== (interval.end - interval.start) / HOUR || matched.some(row => row.snow === null)) continue;
      const nws = interval.value * factor;
      const openMeteo = matched.reduce((sum, row) => sum + row.snow, 0);
      if (Math.abs(nws - openMeteo) > 0.000001) discrepancies.push({start: iso(interval.start), end: iso(interval.end), nws, openMeteo,
        sourceUrl: official.sourceUrl, otherSourceUrl: OPEN_METEO, updatedAt: official.updatedAt, otherUpdatedAt: result.updatedAt});
    }
  } else {
    warnings.push('此点的 NWS 网格数据暂无数据。');
  }
  if (snowRatio?.intervals.length) {
    for (const row of result.hourly) {
      const time = Date.parse(row.time);
      row.snowRatio = snowRatio.intervals.find(interval => interval.start <= time && time < interval.end)?.value ?? null;
    }
  } else {
    warnings.push('该点当前暂无 NWS 雪水比。');
  }
  return {...result, nws: official && {source: official.source, sourceUrl: official.sourceUrl, updatedAt: official.updatedAt, fetchedAt: official.fetchedAt},
    snowRatioSource: snowRatio && {source: snowRatio.source, sourceUrl: snowRatio.sourceUrl, updatedAt: snowRatio.updatedAt, fetchedAt: snowRatio.fetchedAt}, discrepancies, warnings};
}

const routeNumber = name => {
  const match = /(?:^|\b)(?:(I|INTERSTATE|US|SR|CA|HWY|HIGHWAY|ROUTE)[.\s-]*)?(\d{1,4})(?:\b|[NSEW]\b)/i.exec(String(name ?? ''));
  return match ? {number: Number(match[2]), type: {INTERSTATE: 'I', CA: 'SR'}[match[1]?.toUpperCase()] ?? match[1]?.toUpperCase()} : null;
};
function sameRoad(a, b) {
  const x = routeNumber(a), y = routeNumber(b);
  return !!(x && y && x.number === y.number && (!['I','US','SR'].includes(x.type) || !['I','US','SR'].includes(y.type) || x.type === y.type));
}

const countiesByDistrict = {
  1: 'Del Norte:DN,Humboldt:HUM,Lake:LAK,Mendocino:MEN',
  2: 'Lassen:LAS,Modoc:MOD,Plumas:PLU,Shasta:SHA,Siskiyou:SIS,Tehama:TEH,Trinity:TRI',
  3: 'Butte:BUT,Colusa:COL,El Dorado:ED,Glenn:GLE,Nevada:NEV,Placer:PLA,Sacramento:SAC,Sierra:SIE,Sutter:SUT,Yolo:YOL,Yuba:YUB',
  4: 'Alameda:ALA,Contra Costa:CC,Marin:MRN,Napa:NAP,San Francisco:SF,San Mateo:SM,Santa Clara:SCL,Solano:SOL,Sonoma:SON',
  5: 'Monterey:MON,San Benito:SBT,San Luis Obispo:SLO,Santa Barbara:SB,Santa Cruz:SCR',
  6: 'Fresno:FRE,Kern:KER,Kings:KIN,Madera:MAD,Tulare:TUL',
  7: 'Los Angeles:LA,Ventura:VEN', 8: 'Riverside:RIV,San Bernardino:SBD', 9: 'Inyo:INY,Mono:MNO',
  10: 'Alpine:ALP,Amador:AMA,Calaveras:CAL,Mariposa:MPA,Merced:MER,San Joaquin:SJ,Stanislaus:STA,Tuolumne:TUO',
  11: 'Imperial:IMP,San Diego:SD', 12: 'Orange:ORA',
};
const tidyCounty = value => String(value || '').trim().replace(/\s+county$/i, '').toLowerCase();
const counties = new Map(Object.entries(countiesByDistrict).flatMap(([district, list]) => list.split(',').flatMap(pair => {
  const [name, alias] = pair.split(':');
  const details = {name: tidyCounty(name), district: Number(district)};
  return [[tidyCounty(name), details], [alias.toLowerCase(), details]];
})));

function lineFor(segment) {
  // GeoJSON coordinates are longitude, latitude. Object points are also accepted.
  const input = segment.geometry?.coordinates ?? segment.geometry ?? [];
  return Array.isArray(input) ? input.map(p => Array.isArray(p) ? point(p[1], p[0]) : point(p?.lat, p?.lon)).filter(pointOk) : [];
}

function distance(p, q) {
  const rad = Math.PI / 180;
  const h = Math.sin((q.lat - p.lat) * rad / 2) ** 2 + Math.cos(p.lat * rad) * Math.cos(q.lat * rad) * Math.sin((q.lon - p.lon) * rad / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function nearLine(p, line, corridor = 0.2) {
  if (!pointOk(p) || line.length < 2) return false;
  const scale = 111.2 * Math.cos(p.lat * Math.PI / 180);
  return line.slice(1).some((end, i) => {
    const start = line[i];
    const x = (start.lon - p.lon) * scale, y = (start.lat - p.lat) * 111.2;
    const dx = (end.lon - start.lon) * scale, dy = (end.lat - start.lat) * 111.2;
    const v = dx * dx + dy * dy;
    if (!v) return Math.hypot(x, y) <= corridor;
    const projection = -(x * dx + y * dy) / v;
    return projection >= 0 && projection <= 1 && Math.hypot(x + projection * dx, y + projection * dy) <= corridor;
  });
}

function withinPostmiles(segment, county, start, end = start) {
  const wanted = counties.get(tidyCounty(segment.county))?.name;
  const actual = counties.get(tidyCounty(county))?.name;
  const from = num(segment.postmileStart), to = num(segment.postmileEnd);
  const first = num(start), last = num(end);
  return !!wanted && wanted === actual && [from, to, first, last].every(value => value !== null)
    && Math.max(from, to) >= Math.min(first, last) && Math.max(first, last) >= Math.min(from, to);
}

function localInstant(date, time, timezone = 'America/Los_Angeles') {
  const guess = Date.parse(`${date || ''}T${time || ''}Z`);
  if (!Number.isFinite(guess)) return null;
  const parts = new Intl.DateTimeFormat('en-US', {timeZone: timezone, timeZoneName: 'longOffset', year: 'numeric'}).formatToParts(new Date(guess));
  const offset = /GMT([+-])(\d+):(\d+)/.exec(parts.find(p => p.type === 'timeZoneName')?.value || '');
  if (!offset) return iso(guess);
  const minutes = (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === '-' ? -1 : 1);
  return iso(guess - minutes * 60000);
}

const cardinal = {
  n: 'N', nb: 'N', north: 'N', northbound: 'N',
  s: 'S', sb: 'S', south: 'S', southbound: 'S',
  e: 'E', eb: 'E', east: 'E', eastbound: 'E',
  w: 'W', wb: 'W', west: 'W', westbound: 'W',
};

function directions(value) {
  const text = String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
    .replace(/\b([nsew])\s*[/.-]\s*b\b/g, '$1b')
    .replace(/\b(north|south|east|west)[ -]+bound\b/g, '$1bound');
  if (!text || /^n\s*\/\s*a$/.test(text)) return null;
  if (/^(?:(?:both|all)(?: directions?| ways?)?|bi-?directional|b)$/.test(text)) return ['N', 'S', 'E', 'W'];
  const codes = text.split(/\s*(?:[/,&;]|\band\b)\s*/).filter(word => Object.hasOwn(cardinal, word)).map(word => cardinal[word]);
  return codes.length ? codes : null;
}

function matchedDirection(segment, route, direction) {
  const reported = directions(direction);
  const matches = item => {
    const expected = directions(item.direction);
    return sameRoad(item.highway, route) && (!reported || !expected || reported.some(code => expected.includes(code)));
  };
  const ownRoad = matches(segment);
  // Without an official direction, require a geographically matched point instead of matching by postmile alone.
  return {primary: ownRoad && !!reported, relevant: ownRoad || (segment.aliases ?? []).some(matches)};
}

function officialRoadNotice(route) {
  const number=routeNumber(route)?.number;
  return number ? `https://roads.dot.ca.gov/roadscell.php?roadnumber=${number}` : null;
}

function checkpointLink(p) {
  if (!pointOk(p)) return null;
  const query=new URLSearchParams({layers:'chain_controls,full_closures',view:`${p.lat.toFixed(5)},${p.lon.toFixed(5)},14`});
  return `${QUICKMAP}?${query}`;
}

function caltransChecks(segment, items, line, sourceUrl) {
  return items.flatMap(({cc: row}) => {
    const l = row?.location;
    const s = row?.statusData;
    if (!l || !s || !yes(row.inService)) return [];
    const match = matchedDirection(segment,l.route,l.direction);
    if (!match.relevant) return [];
    const p = point(l.latitude, l.longitude);
    if (!nearLine(p,line) && !(match.primary && withinPostmiles(segment,l.county,l.postmile))) return [];
    const level = String(s.status ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
    const kind = level === 'RC' || level === 'ROAD CLOSED' ? 'closure' : /^(?:R-[123]M?|ESC|HT|MAX|MIN|TH|TS|TTA|TTS|TTSD|VM)$/.test(level) ? 'restriction' : 'advisory';
    if (!level || level === 'R-0') return [];
    return [{id: `cc-${row.index}`, kind, title: l.locationName || l.nearbyPlace || segment.highway, description: s.statusDescription || '',
      level, start: segment.start, end: segment.end, ...p, direction: l.direction, active: true, source: 'Caltrans QuickMap · CC', sourceUrl,
      noticeUrl:officialRoadNotice(l.route), checkpointUrl:checkpointLink(p), recordId:row.index ?? null,
      updatedAt: localInstant(s.statusTimestamp?.statusDate, s.statusTimestamp?.statusTime),
      verifiedAt: localInstant(row.recordTimestamp?.recordDate, row.recordTimestamp?.recordTime)}];
  });
}

function caltransClosures(segment, items, line, sourceUrl) {
  const now = Date.now();
  return items.flatMap(({lcs: row}) => {
    const {begin: a, end: b, travelFlowDirection: direction} = row?.location || {};
    const c = row?.closure;
    if (!a || !c || yes(c.code1022?.isCode1022) || yes(c.code1098?.isCode1098)) return [];
    const match = matchedDirection(segment,a.beginRoute,direction);
    if (!match.relevant) return [];
    const startPoint = point(a.beginLatitude, a.beginLongitude);
    const endPoint = point(b?.endLatitude, b?.endLongitude);
    const postmile = tidyCounty(a.beginCounty) === tidyCounty(b?.endCounty) ? b.endPostmile : a.beginPostmile;
    if (!(match.primary && withinPostmiles(segment,a.beginCounty,a.beginPostmile,postmile)) && !nearLine(startPoint,line) && !nearLine(endPoint,line)) return [];
    const start = epoch(c.closureTimestamp?.closureStartEpoch), end = epoch(c.closureTimestamp?.closureEndEpoch);
    if (!start || (end && Date.parse(end) <= now)) return [];
    const active = yes(c.code1097?.isCode1097) && Date.parse(start) <= now;
    const mainline = /^(mainline|freeway|conventional hwy|expressway)$/i.test(c.facility || '');
    const kind = active && mainline && /^full$/i.test(c.typeOfClosure || '') ? 'closure' : 'construction';
    const beginLabel = a.beginLocationName || a.beginNearbyPlace;
    const endLabel = b?.endLocationName || b?.endNearbyPlace;
    return [{id: `lcs-${row.index}`, kind, title: `${c.typeOfClosure || '施工'} · ${c.facility || segment.highway}`,
      description: [c.typeOfWork, beginLabel, endLabel].filter(Boolean).join(' · '), start: beginLabel, end: endLabel, ...startPoint, direction,
      active, startsAt: start, endsAt: end, updatedAt: epoch(c.code1097?.code1097Timestamp?.code1097Epoch) ?? epoch(row.recordTimestamp?.recordEpoch),
      source: 'Caltrans QuickMap · LCS', sourceUrl}];
  });
}

function caltransCameras(segment, items, line, sourceUrl) {
  return items.flatMap(({cctv: row}) => {
    const loc = row?.location;
    const url = row?.imageData?.static?.currentImageURL;
    if (!loc || !cameraUrlAllowed(url)) return [];
    const direction = /^median$/i.test(loc.direction?.trim()) ? 'both' : loc.direction;
    const match = matchedDirection(segment,loc.route,direction);
    if (!match.relevant) return [];
    const p = point(loc.latitude, loc.longitude);
    if (!nearLine(p,line) && !(match.primary && withinPostmiles(segment,loc.county,loc.postmile))) return [];
    return [{id: `caltrans-${loc.district}-${row.index}`, title: loc.locationName ?? loc.nearbyPlace ?? segment.highway,
      ...p, url, updatedAt: localInstant(row.recordTimestamp?.recordDate, row.recordTimestamp?.recordTime), source: 'Caltrans CCTV', sourceUrl}];
  });
}

function xmlText(value = '') {
  return value.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').replace(/<br\s*\/?>/gi, ' · ').replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
}

function kmlField(body, tag) {
  return new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(body)?.[1]?.trim() ?? '';
}

function chpCategory(title, location, style) {
  if (style === '#full-closure') {
    const ramp = /\b(?:onr|ofr|con|connector|on[- ]?ramp|off[- ]?ramp)\b/i.test(location);
    return ramp ? 'ramp-closure' : 'closure';
  }
  if (/^(?:1179|118[0-3]|20001|20002)-/i.test(title)) return 'collision';
  if (/^(?:1125A?-|SLIDE-)|\b(?:traffic hazard|disabled vehicle)\b/i.test(title)) return 'hazard';
  if (/^FLOOD-.*\broadway flooding\b/i.test(title)) return 'flood';
  if (/^SPINOUT\b/i.test(title)) return 'spinout';
  if (/^(?:CFIRE|FIRE)-/i.test(title)) return 'fire';
  return null;
}

function chpRoadClearAt(notes, verifiedAt, category) {
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const stamp = /^(\w{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP])M\s*\[(\d+)\]\s*(.+)$/i;
  const cleared = /^(?:[A-Z]\d{1,3}-\d{1,4}\s+)?(?:(?:RDWY|ROADWAY)\s+(?:IS\s+)?(?:CLR|CLEAR)(?:\s+(?:ON|TO)\s+(?:THE\s+)?(?:RHS|RIGHT SHOULDER)(?:\s+NOW)?)?|ALL\s+(?:LNS|LANES)\s+(?:ARE\s+)?(?:CLR|CLEAR|OPEN))[. ]*(?:\[SHARED\])?$/i;
  const removed = /^(?:[A-Z]\d{1,3}-\d{1,4}\s+)?FSP\s+TOOK\s+(?:THE\s+)?VEH(?:ICLE)?\s+OFF\s+(?:THE\s+)?(?:FRWY|FREEWAY)(?:\s*\/\s*1098)?[. ]*(?:\[SHARED\])?$/i;
  const blockage = /\b(?:BLK?ING|BLOCK(?:ING|ED))\s+(?:#|(?:ALL\s+)?(?:RDWY|ROADWAY|LNS?|LANES?)\b)|\b(?:RDWY|ROADWAY|LNS?|LANES?)\s+(?:(?:IS|ARE)\s+)?(?:BLOCKED|CLOSED)\b/i;
  const pad = value => String(value).padStart(2, '0');
  const updates = notes.split(/<br\s*\/?>/i).flatMap(line => {
    const match = stamp.exec(xmlText(line));
    if (!match) return [];
    const [, month, day, year, hour, minute, second = '00', meridiem, index, message] = match;
    const monthNumber = monthNames.findIndex(name => name.toLowerCase() === month.toLowerCase()) + 1;
    const hour24 = Number(hour) % 12 + (meridiem.toUpperCase() === 'P' ? 12 : 0);
    const time = localInstant(`${year}-${pad(monthNumber)}-${pad(day)}`, `${pad(hour24)}:${minute}:${second}`);
    if (!time || Date.parse(time) > Date.parse(verifiedAt) + 60_000) return [];
    const clear = cleared.test(message) || category==='hazard' && removed.test(message);
    return clear || blockage.test(message) ? [{time,index:Number(index),clear}] : [];
  });
  const latest = updates.sort((a,b) => b.time.localeCompare(a.time) || b.index-a.index)[0];
  return latest?.clear ? latest.time : null;
}

function chpEvents(segment, feed, line) {
  if (!feed || line.length < 2) return [];
  return Array.from(feed.text.matchAll(/<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi)).flatMap(match => {
    const body = match[1];
    const [lon, lat] = kmlField(body, 'coordinates').split(',');
    const p = point(lat, lon);
    if (!nearLine(p, line, 0.12)) return [];
    const html = kmlField(body, 'description');
    const headline = xmlText(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(html)?.[1] ?? '');
    const title = /^[\w &.,/()+'’:-]{1,120}$/.test(headline) ? headline : 'CHP traffic incident';
    const paragraphs = Array.from(html.matchAll(/<p class="iw-text">([\s\S]*?)<\/p>/gi), match => match[1]);
    const summary = xmlText(paragraphs[0]);
    const location = summary.replace(/^\w{3} \d{1,2} \d{4} \d{1,2}:\d{2}[AP]M\s*·\s*/i, '');
    const category = chpCategory(title,location,kmlField(body, 'styleUrl'));
    if (!category) return [];
    const roadPattern = /\b((?:I|US|SR|CA|HWY|INTERSTATE|HIGHWAY|ROUTE)[\s-]*\d{1,4})(?:\s*((?:NORTH|SOUTH|EAST|WEST)(?:[ -]?BOUND)?|[NSEW](?:[\/.-]?B)?)\b(?!\s*(?:\/\s*O\b|\bOF\b)))?\b/ig;
    const references = [...location.matchAll(roadPattern)].filter(([, road]) => matchedDirection(segment,road,null).relevant);
    const explicit = references.filter(([, , direction]) => direction);
    const matched = (explicit.length ? explicit : references).find(([, road, direction]) => matchedDirection(segment,road,direction).relevant);
    if (!matched) return [];
    const incidentId = /CHP Incident\s+([0-9A-Z]{8,22})\b/i.exec(html)?.[1];
    if (!incidentId) return [];
    const stamp = /Last updated:\s*<strong>(\d{1,2})\/(\d{1,2})\/(\d{4})<\/strong>\s*(\d{1,2}):(\d{2})\s*([ap])m/i.exec(html);
    const pad = value => String(value).padStart(2, '0');
    const hour = stamp && Number(stamp[4]) % 12 + (stamp[6].toLowerCase() === 'p' ? 12 : 0);
    const updatedAt = stamp && localInstant(`${stamp[3]}-${pad(stamp[1])}-${pad(stamp[2])}`, `${pad(hour)}:${stamp[5]}:00`);
    const roadClearAt = chpRoadClearAt(paragraphs[1] ?? '', updatedAt ?? feed.sourceUpdatedAt, category);
    return [{id: `chp-${incidentId}`, recordId:incidentId, kind:category === 'closure' ? 'closure' : 'accident',category,
      title, description:summary.slice(0,200), ...p, start: segment.start, end: segment.end, direction: matched[2] ?? segment.direction,
      active: true, updatedAt: updatedAt ?? feed.sourceUpdatedAt, timestampKind:'source-reported', source:'CHP · Caltrans QuickMap',
      sourceUrl:`https://m.chp.ca.gov/incident.aspx?id=${incidentId}`, ...(roadClearAt ? {roadClear:true,roadClearAt} : {})}];
  });
}

export function scopeChpSegments(segments, feed) {
  return segments.map(segment => ({highway:segment.highway,start:segment.start,end:segment.end,direction:segment.direction,
    events:chpEvents(segment,feed,lineFor(segment))}));
}

const cleanState = state => (String(state ?? '').trim().toUpperCase().replace(/^US[- ]|^CA[- ]/, ''));
const regions = {
  CA: ['Caltrans QuickMap', QUICKMAP], CALIFORNIA: ['Caltrans QuickMap', QUICKMAP],
  UT: ['UDOT Traffic', 'https://www.udottraffic.utah.gov/'], UTAH: ['UDOT Traffic', 'https://www.udottraffic.utah.gov/'],
  CO: ['CDOT COtrip', 'https://www.cotrip.org/'], COLORADO: ['CDOT COtrip', 'https://www.cotrip.org/'],
  WA: ['WSDOT', 'https://wsdot.com/travel/real-time/'], OR: ['ODOT TripCheck', 'https://tripcheck.com/'], NV: ['Nevada 511', 'https://www.nvroads.com/'],
  BC: ['DriveBC', 'https://www.drivebc.ca/'], 'BRITISH COLUMBIA': ['DriveBC', 'https://www.drivebc.ca/'],
  JP: ['北海道開発局', 'https://info-road.hdb.hkd.mlit.go.jp/RoadInfo/index.htm'], JAPAN: ['北海道開発局', 'https://info-road.hdb.hkd.mlit.go.jp/RoadInfo/index.htm'],
  HOKKAIDO: ['北海道開発局', 'https://info-road.hdb.hkd.mlit.go.jp/RoadInfo/index.htm'],
};

function unavailableSegment(segment, warning, source, sourceUrl) {
  return {...segment, status: 'unavailable', events: [], cameras: [], warnings: [warning], source, sourceUrl, updatedAt: null};
}

async function bcSegment(segment, request) {
  const source = 'DriveBC Open511';
  const sourceUrl = 'https://www.drivebc.ca/';
  const line = lineFor(segment);
  if (line.length < 2) return unavailableSegment(segment, '需先确认本段实际公路几何。', source, sourceUrl);
  const url = `${BC}/events?status=ACTIVE&format=json&limit=500`;
  const feed = await request(url).catch(() => null);
  if (!Array.isArray(feed?.data?.events)) return unavailableSegment(segment, 'DriveBC 实时路况暂无数据。', source, sourceUrl);
  const events = feed.data.events.flatMap(row => {
    const roads = (row.roads ?? []).filter(road => sameRoad(segment.highway, road.name) && inDirection(segment, road.direction));
    const coords = row.geography?.type === 'Point' ? [row.geography.coordinates] : row.geography?.type === 'LineString' ? row.geography.coordinates : [];
    const onRoad = coords.map(p => point(p[1], p[0])).find(p => nearLine(p, line, 0.2));
    if (!onRoad || roads.length === 0 || row.status !== 'ACTIVE') return [];
    const restrictions = roads.some(road => road.state === 'RESTRICTIONS');
    const closure = roads.some(road => road.state === 'CLOSED');
    const kind = closure ? 'closure' : restrictions ? 'restriction' : row.event_type === 'INCIDENT' ? 'accident' : ['CONSTRUCTION', 'MAINTENANCE'].includes(row.event_type) ? 'construction' : 'advisory';
    return [{id: `bc-${row.id}`, kind, title: row.headline ?? row.event_type, description: row.description ?? '', ...onRoad,
      direction: roads[0].direction, start: segment.start, end: segment.end, level: restrictions ? roads[0].state : null,
      active: true, updatedAt: validTime(row.updated), source, sourceUrl}];
  });
  return {...segment, status: 'partial', events, cameras: [], warnings: ['本路段 DriveBC 沿途摄像头暂未接入。'],
    source, sourceUrl, updatedAt: feed.fetchedAt};
}

async function caltransSegment(segment, request, chp) {
  const district = num(segment.district) ?? counties.get(tidyCounty(segment.county))?.district;
  const line = lineFor(segment);
  const havePostmiles = counties.has(tidyCounty(segment.county)) && [segment.postmileStart, segment.postmileEnd].every(value => num(value) !== null);
  if (!district || district < 1 || district > 12 || (!havePostmiles && line.length < 2)) {
    return unavailableSegment(segment, '需确认 Caltrans 区与本段官方几何，或县名及两端 postmile。', 'Caltrans QuickMap', QUICKMAP);
  }
  const feed = name => `${CWWP}/data/d${district}/${name}/${name}StatusD${String(district).padStart(2, '0')}.json`;
  const publishesChains = [1, 2, 3, 6, 7, 8, 9, 10, 11].includes(district);
  const [cc, lcs, cctv, chpResult] = await Promise.allSettled([publishesChains ? request(feed('cc')) : null,
    request(feed('lcs')), request(feed('cctv')), line.length >= 2 ? chp() : null]);
  const verifiedFeed = result => Array.isArray(fulfilled(result)?.data?.data) ? result.value : null;
  const reports = [verifiedFeed(cc), verifiedFeed(lcs), verifiedFeed(cctv), fulfilled(chpResult)];
  const [chains, closures, cameras, incidents] = reports;
  const coverage = {chainControls: chains?'available':publishesChains?'unavailable':'notPublished',
    closures:closures?'available':'unavailable', incidents:incidents?'available':'unavailable', cameras:cameras?'available':'unavailable'};
  const warnings = [];
  if (!chains) warnings.push(publishesChains?'Caltrans 链条检查点本次未能抓取。':`Caltrans 第 ${district} 区未发布链条检查点数据。`);
  if (!closures) warnings.push('Caltrans 施工及封闭暂无数据。');
  if (!cameras) warnings.push('Caltrans 摄像头目录暂无数据。');
  if (!incidents) warnings.push(line.length >= 2 ? 'CHP 实时事故暂无数据。' : 'CHP 事故需要核实路段几何才能定位。');
  const events = [
    ...caltransChecks(segment, chains?.data?.data ?? [], line, feed('cc')),
    ...caltransClosures(segment, closures?.data?.data ?? [], line, feed('lcs')),
    ...chpEvents(segment, incidents, line),
  ];
  return {...segment, status: warnings.length ? reports.some(Boolean) ? 'partial' : 'unavailable' : 'ok', events, coverage,
    cameras: caltransCameras(segment, cameras?.data?.data ?? [], line, feed('cctv')), warnings,
    source: 'Caltrans QuickMap / CHP', sourceUrl: QUICKMAP,
    updatedAt: reports.map(report => report?.fetchedAt).filter(Boolean).sort().at(-1) ?? null};
}

export async function roads(route, cache = new Map()) {
  const request = url => {
    if (!cache.has(url)) cache.set(url, fetchJson(url));
    return cache.get(url);
  };
  const pending = (route?.segments ?? []).map(async segment => {
    const state = cleanState(segment.state);
    const [source, sourceUrl] = regions[state] ?? ['本地交通部门', null];
    if (state === 'CA' || state === 'CALIFORNIA') return caltransSegment(segment, request, () => null);
    if (state === 'BC' || state === 'BRITISH COLUMBIA') return bcSegment(segment, request);
    return unavailableSegment(segment, '这段公路的实时数据接口尚未接通。', source, sourceUrl);
  });
  const segments = await Promise.all(pending);
  return {segments, updatedAt: segments.map(segment => segment.updatedAt).filter(Boolean).sort().at(-1) ?? null,timestampKind:'retrieved',
    fetchedAt: iso(Date.now()), warnings: segments.flatMap(segment => (segment.warnings ?? []).map(message => `${segment.highway} · ${message}`))};
}

function segmentSamples(segment) {
  const geometry = lineFor(segment);
  if (geometry.length < 2) {
    return [{...point(segment.startLat, segment.startLon), name: segment.start},
      {...point(segment.endLat, segment.endLon), name: segment.end}].filter(pointOk);
  }
  const points = [{...geometry[0], name: segment.start}];
  let carried = 0;
  for (let i = 1; i < geometry.length; i++) {
    const start = geometry[i - 1], end = geometry[i];
    const length = distance(start, end);
    if (length > 0) {
      for (let offset = 20 - carried; offset < length; offset += 20) {
        const share = offset / length;
        points.push({lat: start.lat + (end.lat - start.lat) * share, lon: start.lon + (end.lon - start.lon) * share,
          name: segment.highway});
      }
      carried = (carried + length) % 20;
    }
  }
  points.push({...geometry.at(-1), name: segment.end});
  return points;
}

async function nwsAlerts(place) {
  const {data, fetchedAt} = await fetchJson(`https://api.weather.gov/alerts/active?point=${place.lat.toFixed(4)},${place.lon.toFixed(4)}`, 'application/geo+json');
  if (!Array.isArray(data?.features)) throw new Error('NWS 沿途警报暂无数据。');
  return data.features.flatMap(feature => {
    const item = feature.properties;
    if (!item?.event || !/(?:winter storm|blizzard|snow squall|ice storm|lake effect snow|heavy snow|freezing rain) warning/i.test(item.event)) return [];
    return [{id: item.id ?? feature.id, title: item.event, description: item.headline || item.description || '',
      start: validTime(item.onset ?? item.effective), end: validTime(item.ends ?? item.expires),
      updatedAt: validTime(item.sent), fetchedAt, source: 'NWS 沿途风暴警报', sourceUrl: item['@id'] ?? NWS,
      highway: place.highway, name: place.name, lat: place.lat, lon: place.lon, severe: true}];
  });
}

export async function routeWeather(route) {
  const segments = route?.segments ?? [];
  const candidates = unique(segments.flatMap(segment => segmentSamples(segment).map(p => ({...p, highway: segment.highway,
    state: cleanState(segment.state)}))), p => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`);
  const maxPoints = 14;
  const limited = candidates.length > maxPoints;
  const locations = limited ? Array.from({length: maxPoints}, (_, i) => candidates[Math.round(i * (candidates.length - 1) / (maxPoints - 1))]) : candidates;
  const usStates = new Set(['CA', 'CALIFORNIA', 'UT', 'UTAH', 'CO', 'COLORADO', 'WA', 'OR', 'NV', 'WY', 'ID', 'MT', 'NM', 'AZ', 'AK', 'NH', 'VT', 'ME', 'NY', 'PA', 'MA', 'MI', 'WI', 'MN', 'WV', 'VA']);
  const alertLocations = locations.filter(p => usStates.has(p.state));
  const result = {alerts: [], samples: [], coverage: 'unavailable', complete: false, updatedAt: null, fetchedAt: iso(Date.now()), warnings: []};
  if (!locations.length) return {...result, warnings: ['尚未确认可用的沿途天气点位。']};
  const [forecast, weatherAlerts] = await Promise.all([Promise.allSettled([openMeteo(locations, 3)]), Promise.allSettled(alertLocations.map(nwsAlerts))]);
  const batch = fulfilled(forecast[0]);
  if (batch) {
    result.samples = locations.map((place, i) => ({...place, ...batch[i]}));
    result.forecastCoverage = 'sampled-hourly';
  } else {
    const grids = await Promise.allSettled(alertLocations.map(async place => ({...place, ...officialHourly(await nwsGrid(place))})));
    result.samples = grids.map(fulfilled).filter(Boolean);
    result.forecastCoverage = result.samples.length ? 'sampled-6h' : 'unavailable';
    result.warnings.push(result.samples.length ? 'Open-Meteo 沿途暂无数据。NWS 已返回部分或全部沿途点位的 6 小时降雪量。' : '沿途降雪暂无数据。');
  }
  result.alerts = unique(weatherAlerts.flatMap(row => fulfilled(row) ?? []), row => row.id || `${row.title}-${row.start}`);
  if (alertLocations.length !== locations.length || weatherAlerts.some(row => row.status === 'rejected')) result.warnings.push('有沿途地点的当地风暴警报暂无数据。');
  if (segments.some(segment => lineFor(segment).length < 2)) result.warnings.push('缺少完整公路几何的路段仅提供已确认点位的天气，覆盖有限。');
  if (limited) result.warnings.push('跨长距离路段按点位抽样，点与点之间可能有局地天气。');
  result.coverage = result.samples.length || weatherAlerts.some(row => row.status === 'fulfilled') ? 'sampled' : 'unavailable';
  result.alertCoverage = alertLocations.length === locations.length && weatherAlerts.every(row => row.status === 'fulfilled') ? 'sampled' : 'partial';
  result.complete = !limited && segments.every(segment => lineFor(segment).length >= 2) && result.alertCoverage === 'sampled'
    && result.samples.length === locations.length && result.samples.every(sample => sample.hourly.some(row => row.snow !== null) || sample.accumulations?.length);
  result.updatedAt = [...result.samples, ...result.alerts].map(row => row.updatedAt).filter(Boolean).sort().at(-1) ?? (result.coverage === 'sampled' ? iso(Date.now()) : null);
  result.fetchedAt = iso(Date.now());
  return result;
}

function cameraUrlAllowed(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && (url.hostname === 'dot.ca.gov' || url.hostname.endsWith('.dot.ca.gov') || url.hostname === 'images.drivebc.ca' || url.hostname === 'www.drivebc.ca');
  } catch {
    return false;
  }
}

function townCalendar(timeZone, now = Date.now()) {
  const format = new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});
  const localClock = instant => Object.fromEntries(format.formatToParts(instant).map(part => [part.type, part.value]));
  const dateAt = instant => {
    const local = localClock(instant);
    return `${local.year}-${local.month}-${local.day}`;
  };
  const atHour = (date, hour) => {
    const utc = Date.parse(`${date}T${hour}:00:00Z`);
    let instant = utc;
    for (let attempt = 0; attempt < 3; attempt++) {
      const local = localClock(instant);
      instant += utc - Date.UTC(+local.year, +local.month - 1, +local.day, +local.hour, +local.minute, +local.second);
    }
    return instant;
  };
  const first = Date.parse(`${dateAt(now)}T00:00:00Z`);
  const calendarDate = offset => iso(first + offset * 24 * HOUR).slice(0, 10);
  const hoursBetween = (start, end) => {
    const hours = [];
    for (let hour = start; hour < end; hour += HOUR) hours.push(hour);
    return hours;
  };
  const days = Array.from({length: 7}, (_, i) => {
    const date = calendarDate(i);
    const start = atHour(date, '07'), end = atHour(date, '19');
    return {date, start, end, hours: hoursBetween(start, end)};
  });
  const mornings = Array.from({length: 8}, (_, offset) => {
    const date = calendarDate(offset);
    const start = atHour(date, '05'), end = atHour(date, '09');
    const overnightStart = atHour(calendarDate(offset - 1), '19');
    return {date, start, end, overnightStart, hours: hoursBetween(start, end), overnightHours: hoursBetween(overnightStart, start)};
  });
  return {days, mornings};
}

function townDay(day, temperatures, conditions) {
  const complete = day.hours.length && temperatures.length === day.hours.length && temperatures.every(Number.isFinite);
  return {date: day.date, periodStart: iso(day.start), periodEnd: iso(day.end),
    high: complete ? Math.max(...temperatures) : null, low: complete ? Math.min(...temperatures) : null, ...conditions};
}

function townMorning(morning, values = {}) {
  return {date: morning.date, startAt: iso(morning.start), endAt: iso(morning.end), overnightStartAt: iso(morning.overnightStart),
    snowCm: null, overnightSnowCm: null, minTempC: null, maxGustKmh: null, minVisibilityM: null, rainMm: null, overnightRainMm: null,
    freezingPrecip: null, fog: null, snowWeather: null, thunder: null, ...values};
}

const completeAggregate = (values, reduce) => values.length && values.every(Number.isFinite) ? reduce(values) : null;
const sum = values => values.reduce((total, value) => total + value, 0);
const minimum = values => Math.min(...values);
const maximum = values => Math.max(...values);
const weatherFlag = (present, complete) => present ? true : complete ? false : null;

function openMeteoCondition(value) {
  const code = num(value);
  if ([0, 1].includes(code)) return 'clear';
  if ([2, 3].includes(code)) return 'cloudy';
  if ([45, 48].includes(code)) return 'fog';
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return 'rain';
  if ([56, 57, 66, 67].includes(code)) return 'mix';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  return [95, 96, 97, 99].includes(code) ? 'thunder' : 'unknown';
}

function townOpenMeteoUrl(places, timeZone) {
  const parameters = new URLSearchParams({latitude: places.map(place => place.lat).join(','), longitude: places.map(place => place.lon).join(','),
    hourly: 'temperature_2m,weather_code,snowfall,rain,wind_gusts_10m,visibility', timezone: timeZone, timeformat: 'unixtime',
    forecast_days: '8', past_days: '1', temperature_unit: 'celsius', precipitation_unit: 'mm', wind_speed_unit: 'kmh'});
  // Towns without a supplied height keep Open-Meteo's default terrain correction.
  if (places.every(place => num(place.elevation) !== null)) parameters.set('elevation', places.map(place => num(place.elevation)).join(','));
  return `https://api.open-meteo.com/v1/forecast?${parameters}`;
}

function daytimeOpenMeteoCondition(codes) {
  const conditions = new Set(codes.map(openMeteoCondition));
  if (conditions.has('unknown')) return 'unknown';
  if (conditions.has('thunder')) return 'thunder';
  if (conditions.has('mix') || (conditions.has('rain') && conditions.has('snow'))) return 'mix';
  return ['snow', 'rain', 'fog', 'cloudy', 'clear'].find(condition => conditions.has(condition)) ?? 'unknown';
}

function openMeteoTown(place, grid, calendar, response, timeZone) {
  const hourly = grid?.hourly;
  if (!Array.isArray(hourly?.time) || grid.hourly_units?.temperature_2m !== '°C') return null;
  const indexAt = new Map(hourly.time.map((seconds, i) => [seconds * 1000, i]));
  const days = calendar.days.map(day => {
    const indexes = day.hours.map(time => indexAt.get(time));
    const temperatures = indexes.map(i => num(hourly.temperature_2m?.[i]));
    const condition = daytimeOpenMeteoCondition(indexes.map(i => hourly.weather_code?.[i]));
    return townDay(day, temperatures, {condition});
  });
  const read = (field, unit, hours) => grid.hourly_units?.[field] === unit
    ? hours.map(time => num(hourly[field]?.[indexAt.get(time)])) : [];
  const mornings = calendar.mornings.map(morning => {
    // Open-Meteo labels accumulation and peak gust with the end of the preceding hour.
    const endingHours = morning.hours.map(time => time + HOUR);
    const endingOvernight = morning.overnightHours.map(time => time + HOUR);
    const codes = morning.hours.map(time => openMeteoCondition(hourly.weather_code?.[indexAt.get(time)]));
    const completeWeather = codes.every(code => code !== 'unknown');
    const snow = read('snowfall', 'cm', endingHours);
    return townMorning(morning, {
      snowCm: completeAggregate(snow, sum), overnightSnowCm: completeAggregate(read('snowfall', 'cm', endingOvernight), sum),
      minTempC: completeAggregate(read('temperature_2m', '°C', morning.hours), minimum),
      maxGustKmh: completeAggregate(read('wind_gusts_10m', 'km/h', endingHours), maximum),
      minVisibilityM: completeAggregate(read('visibility', 'm', morning.hours), minimum),
      rainMm: completeAggregate(read('rain', 'mm', endingHours), sum), overnightRainMm: completeAggregate(read('rain', 'mm', endingOvernight), sum),
      freezingPrecip: weatherFlag(codes.includes('mix'), completeWeather), fog: weatherFlag(codes.includes('fog'), completeWeather),
      snowWeather: weatherFlag(codes.includes('snow') || snow.some(value => value > 0), completeWeather),
      thunder: weatherFlag(codes.includes('thunder'), completeWeather),
    });
  });
  if (!days.some(day => day.high !== null || day.low !== null || day.condition !== 'unknown')) return null;
  return {id: place.id, name: place.name, days, mornings, source: 'Open-Meteo', sourceUrl: townOpenMeteoUrl([place], timeZone),
    updatedAt: response.lastModified, fetchedAt: response.fetchedAt};
}

function townNwsWeatherIntervals(layer) {
  return (layer?.values ?? []).flatMap(row => {
    const [stamp, duration] = String(row.validTime).split('/');
    const start = Date.parse(stamp), end = start + durationMs(duration);
    if (!Number.isFinite(start) || end <= start || !Array.isArray(row.value)) return [];
    return [{start, end, weather: row.value}];
  });
}

function townNwsConditions(intervals) {
  return intervals.flatMap(({start, end, weather}) => weather.flatMap(item => {
    const label = String(item?.weather ?? '').replace(/_/g, ' ').toLowerCase().trim();
    const condition = /freezing|sleet|ice pellets|mix/.test(label) ? 'mix' : /thunder/.test(label) ? 'thunder'
      : /snow|flurr(?:ies|y)|blizzard/.test(label) ? 'snow' : /rain|drizzle|showers/.test(label) ? 'rain'
      : /fog|mist/.test(label) ? 'fog' : null;
    const coverage = String(item?.coverage ?? '').replace(/_/g, ' ').toLowerCase();
    const weight = {'definite': 1, 'likely': 0.7, 'chance': 0.5, 'slight chance': 0.2, 'isolated': 0.2}[coverage] ?? 0.65;
    return condition ? [{start, end, condition, weight, sourceText: [coverage, item.intensity, label].filter(Boolean).join(' '),
      freezingPrecip: /\bfreezing (?:rain|drizzle|precipitation)\b/.test(label)}] : [];
  }));
}

function townConditionForDay(day, weather, skies) {
  const overlap = row => Math.max(0, Math.min(row.end, day.end) - Math.max(row.start, day.start));
  const scores = new Map(), labels = new Map();
  for (const row of weather) {
    const weight = overlap(row) * row.weight;
    if (!weight) continue;
    scores.set(row.condition, (scores.get(row.condition) ?? 0) + weight);
    if (weight > (labels.get(row.condition)?.weight ?? 0)) labels.set(row.condition, {weight, notes: row.sourceText});
  }
  const strongest = [...scores].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (strongest) {
    if (strongest !== 'thunder' && scores.get('rain') >= HOUR && scores.get('snow') >= HOUR) {
      return {condition: 'mix', sourceText: `${labels.get('rain').notes} / ${labels.get('snow').notes}`};
    }
    return {condition: strongest, sourceText: labels.get(strongest).notes};
  }
  let duration = 0, cloudTotal = 0;
  for (const row of skies) {
    if (row.value === null) continue;
    const time = overlap(row);
    duration += time;
    cloudTotal += time * row.value;
  }
  return {condition: duration >= day.end - day.start ? cloudTotal / duration > 25 ? 'cloudy' : 'clear' : 'unknown'};
}

async function nwsTown(place, calendar) {
  const official = await nwsGrid(place);
  const layer = official.data.temperature;
  const temperature = /:degC$/.test(String(layer?.uom)) ? gridIntervals(layer) : [];
  const intervals = townNwsWeatherIntervals(official.data.weather);
  const weather = townNwsConditions(intervals);
  const skies = gridIntervals(official.data.skyCover);
  const atHours = (rows, hours) => hours.map(hour => rows.find(row => row.start <= hour && hour < row.end)?.value ?? null);
  const days = calendar.days.map(day => {
    return townDay(day, atHours(temperature, day.hours), townConditionForDay(day, weather, skies));
  });
  const gustLayer = official.data.windGust;
  const gustFactor = /:km_h-1$/.test(gustLayer?.uom) ? 1 : /:m_s-1$/.test(gustLayer?.uom) ? 3.6 : null;
  const gusts = gustFactor === null ? [] : gridIntervals(gustLayer);
  const snowLayer = official.data.snowfallAmount;
  const snowUnit = /:(mm|cm|m)$/.exec(snowLayer?.uom)?.[1];
  const snowFactor = {mm: 0.1, cm: 1, m: 100}[snowUnit];
  const snowPeriods = snowFactor === undefined ? [] : gridIntervals(snowLayer)
    .filter(row => row.value !== null && row.value >= 0 && row.end - row.start === 6 * HOUR)
    .sort((a, b) => a.start-b.start);
  const mornings = calendar.mornings.map(morning => {
    const conditions = weather.filter(row => row.start < morning.end && row.end > morning.start);
    const completeWeather = morning.hours.every(hour => intervals.some(row => row.start <= hour && row.end >= hour + HOUR));
    const peak = completeAggregate(atHours(gusts, morning.hours), maximum);
    return townMorning(morning, {
      minTempC: completeAggregate(atHours(temperature, morning.hours), minimum), maxGustKmh: peak === null ? null : peak * gustFactor,
      freezingPrecip: weatherFlag(conditions.some(row => row.freezingPrecip), completeWeather),
      fog: weatherFlag(conditions.some(row => row.condition === 'fog'), completeWeather),
      snowWeather: weatherFlag(conditions.some(row => row.condition === 'snow'), completeWeather),
      thunder: weatherFlag(conditions.some(row => row.condition === 'thunder'), completeWeather),
      nwsSnowPeriods: snowPeriods.filter(row => row.start < morning.end && row.end > morning.overnightStart)
        .map(row => ({startAt: iso(row.start), endAt: iso(row.end), snowCm: row.value * snowFactor})),
    });
  });
  if (!days.some(day => day.high !== null || day.low !== null || day.condition !== 'unknown')) return null;
  return {id: place.id, name: place.name, days, mornings, source: official.source, sourceUrl: official.sourceUrl,
    updatedAt: official.updatedAt, fetchedAt: official.fetchedAt};
}

export async function townsWeather(places, timeZone = 'America/Los_Angeles') {
  const calendar = townCalendar(timeZone);
  const warnings = [];
  const valid = places.filter(pointOk);
  const forecasts = new Map();
  if (valid.length) {
    const terrain = valid.filter(place => num(place.elevation) === null);
    const heights = valid.filter(place => num(place.elevation) !== null);
    const batches = [terrain, heights].filter(group => group.length > 0);
    const results = await Promise.allSettled(batches.map(async group => {
      const response = await fetchJson(townOpenMeteoUrl(group, timeZone));
      const locations = Array.isArray(response.data) ? response.data : [response.data];
      if (locations.length !== group.length) throw new Error('Open-Meteo returned an unexpected number of towns.');
      group.forEach((place, i) => forecasts.set(place, openMeteoTown(place, locations[i], calendar, response, timeZone)));
    }));
    const limited = results.find(result => result.status === 'rejected' && result.reason?.status === 429);
    if (limited) throw limited.reason;
    const missing = valid.filter(place => !forecasts.get(place));
    if (missing.length) {
      const resolved = await Promise.allSettled(missing.map(place => nwsTown(place, calendar)));
      resolved.forEach((value, i) => forecasts.set(missing[i], fulfilled(value)));
      if (resolved.some(value => fulfilled(value))) warnings.push('部分或全部地点使用 NWS 网格预报。');
    }
  }
  const towns = places.map(place => forecasts.get(place) ?? {id: place.id, name: place.name,
    days: calendar.days.map(day => townDay(day, [], {condition: 'unknown'})), mornings: calendar.mornings.map(morning => townMorning(morning)),
    source: null, sourceUrl: null, updatedAt: null, fetchedAt: null});
  const unavailable = towns.filter(town => !town.source).map(town => town.name);
  if (unavailable.length) warnings.push(`暂无预报：${unavailable.join('、')}`);
  return {towns, period: {startHour: 7, endHour: 19, timeZone}, fetchedAt: iso(Date.now()),
    updatedAt: towns.map(town => town.updatedAt).filter(Boolean).sort().at(-1) ?? null, warnings};
}
