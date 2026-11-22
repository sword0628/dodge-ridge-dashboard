const endpoint = 'https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/';
const elements = 'datetime,datetimeEpoch,temp,windgust,visibility,precip,preciptype,snow,conditions,icon,source';
const hoursPerRequest = 48;
const maxPlaces = 16;
const fetchBudget = 18_000;
const perRequestTimeout = 5_000;
const source = 'Visual Crossing Weather';
const units = {temperature_2m: '°C', snowfall: 'cm', rain: 'mm', wind_gusts_10m: 'km/h', visibility: 'm'};
const dateFormat = /^\d{4}-\d{2}-\d{2}$/;

let failures = 0;
let retryAt = 0;

function forecastUrl(place, start, end) {
  const {lat, lon} = place;
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) return null;
  const query = new URLSearchParams({unitGroup:'metric', include:'days,hours,fcst', elements, contentType:'json', lang:'en', source:'llms'});
  return `${endpoint}${lat},${lon}/${start}/${end}?${query}`;
}

function weatherAt(hour, snowfall, types) {
  const labels = [hour.conditions, hour.icon].filter(value => typeof value === 'string').join(' ').replace(/[-_,]/g, ' ').toLowerCase();
  const freezingLabel = /\bfreezing\s*(?:rain|drizzle)\b/.test(labels);
  const freezingType = types.includes('freezingrain') || types.includes('ice');
  const snowLabel = /\bsnow\b|\bflurr(?:y|ies)\b/.test(labels);
  const snowType = snowfall > 0 || types.includes('snow');
  const thunder = /\bthunder|\blightning\b/.test(labels);
  const fog = /\b(?:fog|mist)\b/.test(labels);
  const rainy = types.includes('rain') || /\brain\b|\bdrizzle\b|\bshowers\b/.test(labels);
  const cloudy = /\bcloudy\b|\bovercast\b/.test(labels);
  const clear = /\bclear\b|\bsunny\b/.test(labels);
  const snowWeather = snowLabel || snowType;
  const mixed = types.includes('ice') || (rainy && snowWeather) || /\bsleet\b|\bwintry mix\b/.test(labels);
  const code = thunder ? 95 : freezingLabel || freezingType || mixed ? 66 : snowWeather ? 71 : rainy ? 61 : fog ? 45 : cloudy ? 3 : clear ? 0 : null;
  return {code, conditionKnown:code !== null && Boolean(labels.trim()), freezingLabel, freezingType, snowLabel, snowType, thunder, fog};
}

const metric = value => Number.isFinite(value) && value >= 0 ? value : null;

function forecastHours(data) {
  const hours = new Map();
  const duplicates = new Set();
  for (const day of data.days) for (const hour of Array.isArray(day?.hours) ? day.hours : []) {
    const timestamp = hour?.datetimeEpoch;
    if (hour?.source !== 'fcst' || !Number.isSafeInteger(timestamp) || timestamp <= 0) continue;
    if (hours.has(timestamp)) {
      duplicates.add(timestamp);
      continue;
    }
    const types = Array.isArray(hour.preciptype) ? hour.preciptype.map(type => String(type).toLowerCase().replace(/[\s_-]/g, '')) : [];
    const precip = metric(hour.precip);
    const snowfall = metric(hour.snow);
    const windgust = metric(hour.windgust);
    const visibility = metric(hour.visibility);
    const rainOnly = types.length === 1 && types[0] === 'rain' && !(snowfall > 0);
    const otherPrecipOnly = types.length === 1 && ['snow','ice','freezingrain'].includes(types[0]);
    const rain = precip === 0 || otherPrecipOnly ? 0 : rainOnly ? precip : null;
    hours.set(timestamp, {time:timestamp, temperature:Number.isFinite(hour.temp) ? hour.temp : null, snowfall, rain, precip,
      windgust, visibility:visibility === null ? null : visibility * 1000, ...weatherAt(hour, snowfall, types)});
  }
  for (const timestamp of duplicates) hours.delete(timestamp);
  return hours;
}

function asGrid(hours) {
  const rows = [...hours.values()].sort((a, b) => a.time - b.time);
  return {hourly_units:units, hourly:{time:rows.map(row => row.time), temperature_2m:rows.map(row => row.temperature),
    snowfall:rows.map(row => row.snowfall), rain:rows.map(row => row.rain), wind_gusts_10m:rows.map(row => row.windgust),
    visibility:rows.map(row => row.visibility), weather_code:rows.map(row => row.code)}};
}

function withForecastFlags(town, hours, calendar) {
  const timeWindows = new Map(calendar.mornings.map(window => [window.date, window.hours]));
  return town.mornings.map(morning => {
    const times = timeWindows.get(morning.date) ?? [];
    const samples = times.map(time => hours.get(time / 1000));
    const endingSamples = times.map(time => hours.get(time / 1000 + 3600));
    const complete = samples.length > 0 && samples.every(row => row?.conditionKnown);
    const completePrecip = complete && endingSamples.every(row => row?.precip != null);
    const flag = (label, interval, covered = complete) => samples.some(row => row?.[label]) || (interval && endingSamples.some(row => row?.[interval]))
      ? true : covered ? false : null;
    return {...morning, freezingPrecip:flag('freezingLabel','freezingType',completePrecip),
      snowWeather:flag('snowLabel','snowType',completePrecip), fog:flag('fog'), thunder:flag('thunder')};
  });
}

function backOff(response) {
  const retry = response?.headers.get('retry-after');
  const now = Date.now();
  const providerRetryAt = retry && /^\d+$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry);
  failures = Math.min(failures + 1, 6);
  retryAt = Math.max(now + Math.min(6 * 3600_000, 10 * 60_000 * 2 ** (failures - 1)), providerRetryAt || 0);
}

async function getForecast(url, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {headers:{Accept:'application/json'}, signal:controller.signal});
    if (!response.ok) return {response};
    return {response, data:await response.json()};
  } finally {
    clearTimeout(timer);
  }
}

export async function visualCrossingTowns(places, calendar, timeZone, normalizeTown) {
  const forecasts = new Map();
  const start = calendar.days[0]?.date, end = calendar.days[1]?.date;
  if (!dateFormat.test(start ?? '') || !dateFormat.test(end ?? '') || Date.now() < retryAt) return {forecasts,retryAt};
  const deadline = Date.now() + fetchBudget;

  // Anonymous Timeline returns up to two current/future hourly dates. Keep the rest of the calendar as missing.
  for (const place of places.slice(0, maxPlaces)) {
    const remaining = deadline - Date.now();
    const sourceUrl = forecastUrl(place, start, end);
    if (remaining <= 0 || Date.now() < retryAt) break;
    if (!sourceUrl) continue;

    let reply;
    try {
      reply = await getForecast(sourceUrl, Math.min(remaining, perRequestTimeout));
    } catch {
      backOff();
      break;
    }
    const {response, data} = reply;
    if ([401, 403, 429].includes(response.status) || response.status >= 500) {
      backOff(response);
      break;
    }
    if (!response.ok || !Array.isArray(data?.days)) continue;
    failures = 0;

    const hours = forecastHours(data);
    if (!hours.size || hours.size > hoursPerRequest + 1) continue;
    const fetchedAt = new Date().toISOString();
    const modified = Date.parse(response.headers.get('last-modified'));
    const updatedAt = Number.isFinite(modified) ? new Date(modified).toISOString() : null;
    const forecast = normalizeTown(place, asGrid(hours), calendar, {lastModified:updatedAt, fetchedAt}, timeZone);
    if (!forecast) continue;
    forecasts.set(place, {...forecast, mornings:withForecastFlags(forecast, hours, calendar), source, sourceUrl, updatedAt, fetchedAt});
  }
  return {forecasts,retryAt};
}
