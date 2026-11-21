import {dateKey,forecastLength,shift,valid} from './forecast.js?v=10';

const hour = 3_600_000;
const inchCm = 2.54;
const mileM = 1609.344;
const mphKmh = 1.609344;
const minorDryColdFloorC = -2;
const minorPointLimit = 2;
export const driveForecastMaxAge = 6 * hour;

function localHours(timeZone) {
  const clock = new Intl.DateTimeFormat('en-CA',{
    timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',
  });
  return (date, hourText) => {
    const desired = Date.parse(`${date}T${hourText}:00:00Z`);
    let time = desired;
    for (let i=0;i<3;i++) {
      const p = Object.fromEntries(clock.formatToParts(time).map(part=>[part.type,part.value]));
      const rendered = Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
      if (rendered === desired) break;
      time += desired - rendered;
    }
    return time;
  };
}

export function todayDriveWindow(now, timeZone) {
  const date = dateKey(now,timeZone);
  const at = localHours(timeZone);
  const start = at(date,'05');
  const end = at(date,'09');
  return {date,start,end,phase:now>=end?'past':now>start?'during':'upcoming'};
}

export function upcomingDriveDates(now, timeZone) {
  const {date,phase} = todayDriveWindow(now,timeZone);
  const first = phase==='upcoming' ? date : shift(date,1);
  return Array.from({length:forecastLength},(_,i)=>shift(first,i));
}

export function driveDisplayDates(now, timeZone) {
  const today = dateKey(now,timeZone);
  const upcoming = upcomingDriveDates(now,timeZone);
  return upcoming[0]===today ? upcoming : [today,...upcoming];
}

function completeMorning(morning) {
  if (!morning) return false;
  const {snowCm,overnightSnowCm,minTempC,maxGustKmh,minVisibilityM,rainMm,overnightRainMm,
    freezingPrecip,fog,snowWeather,thunder} = morning;
  return [snowCm,overnightSnowCm,minTempC,maxGustKmh,minVisibilityM,rainMm,overnightRainMm].every(valid)
    && [freezingPrecip,fog,snowWeather,thunder].every(value=>typeof value === 'boolean');
}

export function hasCompleteDriveDate(data, places, dates) {
  const byPlace = new Map((data?.towns ?? []).map(town=>[town.id,town]));
  return places.length > 0 && dates.some(date=>places.every(place=>
    completeMorning(byPlace.get(place.id)?.mornings?.find(morning=>morning.date===date))));
}

function assessTown(morning, stale) {
  if (!morning || stale) return {risk:'unknown',complete:false,reasons:[stale?'stale':'missing']};
  const {snowCm,overnightSnowCm,minTempC,maxGustKmh,minVisibilityM,rainMm,overnightRainMm,
    freezingPrecip,fog,snowWeather,thunder} = morning;
  const cold = valid(minTempC) && minTempC <= 0;
  const high = [];
  const caution = [];
  if (freezingPrecip) high.push('freezingPrecip');
  if (thunder) high.push('thunder');
  if (snowCm >= inchCm) high.push('heavySnow');
  else if (snowCm > 0 || snowWeather) caution.push('snow');
  if (overnightSnowCm >= 2*inchCm && cold) high.push('heavyOvernightSnow');
  else if (overnightSnowCm > 0) caution.push('overnightSnow');
  if (maxGustKmh >= 45*mphKmh) high.push('strongGusts');
  else if (maxGustKmh >= 30*mphKmh) caution.push('gusts');
  if (valid(minVisibilityM) && minVisibilityM <= mileM/4) high.push('poorVisibility');
  else if (fog || valid(minVisibilityM) && minVisibilityM <= mileM) caution.push('fog');
  if (cold) caution.push(snowCm > 0 || overnightSnowCm > 0 || rainMm > 0 || overnightRainMm > 0 ? 'ice' : 'freezing');
  if (rainMm >= .25*25.4) caution.push('rain');
  const complete = completeMorning(morning);
  const minor = complete && !high.length && caution.length===1 && caution[0]==='freezing' && minTempC>=minorDryColdFloorC;
  return {risk:high.length?'high':caution.length?'caution':complete?'low':'unknown',complete,minor,
    reasons:[...high,...caution,...(complete?[]:['missing'])]};
}

function morningAlerts(alertSnapshot, start, end) {
  if (!alertSnapshot?.data || alertSnapshot.stale) return [];
  return (alertSnapshot.data.alerts ?? []).filter(alert=>{
    const from = Date.parse(alert.start);
    const until = Date.parse(alert.end);
    return /\b(?:warning|advisory|watch)\b/i.test(alert.title ?? '') && valid(from) && valid(until) && from < end && until > start;
  });
}

export function driveOutlook(townSnapshot, alertSnapshot, {now=Date.now(),timeZone='America/Los_Angeles'}={}) {
  const forecasts = new Map((townSnapshot?.data?.towns ?? []).map(town=>[town.id,town]));
  const places = townSnapshot?.places?.length ? townSnapshot.places : [...forecasts.values()];
  const basedOn = townSnapshot?.savedAt ?? townSnapshot?.data?.fetchedAt;
  const hasMornings = [...forecasts.values()].some(town=>town.mornings?.length);
  const fetched = Date.parse(basedOn);
  const dated = valid(fetched) && fetched <= now+5*60_000;
  const stale = !!hasMornings && (!dated || now-fetched>driveForecastMaxAge);
  const retained = townSnapshot?.retained === true && dated && hasMornings;
  const at = localHours(timeZone);
  const today = todayDriveWindow(now,timeZone);
  const days = driveDisplayDates(now,timeZone).map(date=>{
    const towns = places.map(({id,name})=>{
      const forecast = forecasts.get(id);
      const morning = forecast?.mornings?.find(item=>item.date===date) ?? null;
      const {source,sourceUrl,updatedAt,fetchedAt} = forecast ?? {};
      return {id,name,morning,source,sourceUrl,updatedAt,fetchedAt,...assessTown(morning,stale && !retained)};
    });
    const alerts = morningAlerts(alertSnapshot,at(date,'05'),at(date,'09'));
    const warning = alerts.some(alert=>/\bwarning\b/i.test(alert.title));
    const complete = towns.length>0 && towns.every(town=>town.complete);
    const minorCount = towns.filter(town=>town.minor).length;
    const materialCaution = towns.some(town=>town.risk==='caution' && !town.minor);
    const risk = warning || towns.some(town=>town.risk==='high') ? 'high'
      : alerts.length || materialCaution || minorCount>minorPointLimit ? 'caution' : complete ? 'low' : 'unknown';
    const minorNote = risk==='low' && minorCount>0 ? 'isolatedMinor'
      : risk==='caution' && minorCount>minorPointLimit && !materialCaution && !alerts.length ? 'severalMinor' : null;
    const reasons = [warning?'weatherWarning':alerts.length?'weatherAdvisory':null,stale?'stale':complete?null:'missing',minorNote].filter(Boolean);
    const alertRisk = warning?'high':alerts.length?'caution':null;
    return {date,risk,complete,towns,alerts,reasons,alertRisk};
  });
  return {days,stale,retained,basedOn,today,retryAt:townSnapshot?.retryAt,refreshFailed:!!townSnapshot?.error};
}
