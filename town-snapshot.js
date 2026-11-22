import {completeMorning,driveForecastMaxAge} from './drive-weather.js?v=14';
import {freshFor} from './logic.js?v=6';

const morningNumbers = ['minTempC','snowCm','overnightSnowCm','rainMm','overnightRainMm','maxGustKmh','minVisibilityM'];
const morningFlags = ['snowWeather','freezingPrecip','fog','thunder'];
const measuredMorning = ['minTempC','snowCm','rainMm','maxGustKmh','minVisibilityM'];
const usableMorning = row => row && (morningNumbers.some(key=>Number.isFinite(row[key]))
  || morningFlags.some(key=>row[key]===true) || row.nwsSnowPeriods?.length);
const usableDay = row => row && (Number.isFinite(row.high) || Number.isFinite(row.low) || row.condition!=='unknown');
const byDate = rows => new Map((rows ?? []).map(row=>[row.date,row]));

function rowSources(town,row,savedAt,retained=false) {
  if (!row || !town?.source) return null;
  return {...row,source:town.source,sourceUrl:town.sourceUrl,updatedAt:town.updatedAt,
    fetchedAt:town.fetchedAt ?? savedAt,retained};
}

export function townSnapshotView(snapshot,places,now) {
  if (!snapshot) return null;
  const cache = snapshot.fallback;
  if (!cache && !snapshot.error) return snapshot;
  const index = rows => new Map((rows ?? []).map(town=>[town.id,town]));
  const saved = index(snapshot.data?.towns);
  const visual = index(cache?.visualTowns?.filter(town=>now-Date.parse(town.fetchedAt)<=driveForecastMaxAge));
  const nws = index(cache?.nwsTowns);
  const towns = places.map(place=>{
    const original=saved.get(place.id), backup=visual.get(place.id), official=nws.get(place.id);
    const series = kind => {
      const first=byDate(original?.[kind]), second=byDate(backup?.[kind]), third=byDate(official?.[kind]);
      const dates=[...new Set([...first.keys(),...second.keys(),...third.keys()])].sort();
      return dates.map(date=>{
        const previous=rowSources(original,first.get(date),snapshot.savedAt,!!snapshot.retained);
        const alternate=rowSources(backup,second.get(date),cache?.savedAt);
        const nwsRow=rowSources(official,third.get(date),cache?.savedAt);
        if (kind==='days') {
          return [alternate,nwsRow,previous].find(usableDay) ?? {date,condition:'unknown'};
        }
        const backupMeasured = alternate && measuredMorning.some(key=>Number.isFinite(alternate[key]));
        const current = [backupMeasured?alternate:null,nwsRow].find(usableMorning);
        if (!current) return usableMorning(previous)?previous:null;
        if (completeMorning(current) || !completeMorning(previous) || !snapshot.retained) return current;
        // A partial backup can add current evidence while the full saved window stays available.
        return {...previous,supplement:current};
      }).filter(Boolean);
    };
    const provenance=backup ?? official ?? original;
    return {id:place.id,name:place.name,source:provenance?.source,sourceUrl:provenance?.sourceUrl,
      updatedAt:provenance?.updatedAt,fetchedAt:provenance?.fetchedAt,days:series('days'),mornings:series('mornings')};
  });
  if (!towns.some(town=>town.source)) return snapshot;
  const newest=[snapshot.savedAt,cache?.savedAt].filter(Boolean).sort().at(-1);
  return {...snapshot,savedAt:newest,primarySavedAt:snapshot.savedAt,stale:now-Date.parse(newest)>freshFor.towns,
    data:{...snapshot.data,period:snapshot.data?.period ?? cache?.period,towns}};
}
