export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const freshFor = { weather: 26 * HOUR, roads: 45 * MIN, routeWeather: 6 * HOUR, towns:26*HOUR, resort: 4 * HOUR };
export const fresh = (snapshot, type, now = Date.now()) => !!snapshot?.data && now - Date.parse(snapshot.savedAt) <= freshFor[type];
export const restricted = (event) => {
  if (event.kind !== 'restriction') return 0;
  const level = String(event.level ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^R[0-3]M?$/.test(level)) return Number(level[1]);
  if (level === 'RC' || level === 'HT') return 4;
  return level ? 1 : 0;
};

function departureWindow(now, zone, clockTime) {
  if (!clockTime) return now;
  const f=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const calendar=(stamp)=>Object.fromEntries(f.formatToParts(new Date(stamp)).map(x=>[x.type,x.value]));
  const asUTC=(p)=>Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second));
  const local=calendar(now);
  const [hour,minute]=clockTime.split(':').map(Number);
  let target=Date.UTC(Number(local.year),Number(local.month)-1,Number(local.day),hour,minute);
  const solve=(wanted)=>{
    let actual=wanted;
    for(let i=0;i<3;i++)actual+=wanted-asUTC(calendar(actual));
    return asUTC(calendar(actual))===wanted?actual:null;
  };
  let start=solve(target);
  if (start===null||start < now-MIN) {
    target+=24*HOUR;
    start=solve(target);
  }
  return start ?? now;
}

export function tripVerdict(profile, roadSnap, routeSnap, now = Date.now(), liveChp = null, chpCheckedAt) {
  const route = profile.segments.filter(s => s.highway && s.start && s.end);
  const destination = profile.dayTrip ? profile.resort : profile.lodging;
  const result = {status:'setup', evidence:[], uncertain:[], route:route.map(s=>s.highway), destination};
  if (!profile.origin || !destination || !route.length) return result;
  const roadFresh = fresh(roadSnap,'roads',now);
  const weatherFresh = fresh(routeSnap,'routeWeather',now);
  const roadSegments = roadSnap?.data?.segments ?? [];
  const hours = profile.durationMinutes ? profile.durationMinutes / 60 : 3;
  const start = departureWindow(now,profile.timeZone,profile.departureTime);
  const end = start + hours * HOUR;
  result.windowStart=new Date(start).toISOString();
  result.windowEnd=new Date(end).toISOString();
  const isActive = (e) => (!(e.startsAt??e.startTime) || Date.parse(e.startsAt??e.startTime) <= now) && (!(e.endsAt??e.endTime) || Date.parse(e.endsAt??e.endTime) > now);
  result.status = 'go';
  const flag = (status) => {
    if (status === 'stop' || (status === 'caution' && result.status === 'go')) result.status = status;
  };
  if (!profile.routeConfirmed) {result.uncertain.push('routeScope');flag('caution');}
  const roadGap=(code)=>{result.uncertain.push(code);flag('caution');};
  if (!roadSnap?.data) {
    roadGap(roadSnap?.error?'roadsFetchFailed':'roadsPending');
  } else if (!roadFresh) {
    roadGap('roadsStale');
  } else if (roadSnap.error) {
    roadGap('roadsFetchFailed');
  }
  if (roadFresh) {
    const missingChecks=roadSegments.filter(s=>s.coverage?.chainControls==='notPublished');
    if (missingChecks.length) {
      roadGap('roadChainNotPublished');
      result.chainDistricts=[...new Set(missingChecks.map(s=>s.district).filter(Boolean))].sort((a,b)=>a-b);
    }
    if (roadSegments.length!==route.length||roadSegments.some(s=>s.coverage?
      s.coverage.closures!=='available'||(!liveChp&&s.coverage.incidents!=='available')||s.coverage.chainControls==='unavailable':s.status!=='ok')) {
      roadGap('roadsPartial');
    }
  }
  if (!weatherFresh || !(routeSnap.data.complete===true || routeSnap.data.coverage==='complete')) {
    result.uncertain.push('routeWeather');
    flag('caution');
  }
  const addEvents = (segments, checkedAt) => {
    for (const segment of segments) for (const e of segment.events ?? []) {
      if (!isActive(e) || e.active === false || e.roadClear || e.kind === 'advisory' || e.kind === 'construction') continue;
      if (e.kind === 'closure' || restricted(e) >= 3) flag('stop');
      else flag('caution');
      result.evidence.push({...e, highway:segment.highway, checkedAt});
    }
  };
  if (roadFresh) addEvents(roadSegments,roadSnap.savedAt);
  if (liveChp) addEvents(liveChp,chpCheckedAt);
  if (weatherFresh) {
    for (const e of routeSnap.data.alerts ?? []) {
      if ((e.start && Date.parse(e.start) > end) || (e.end && Date.parse(e.end) <= start)) continue;
      const severe = /blizzard warning|snow squall warning|ice storm warning/i.test(e.title);
      flag(severe ? 'stop' : 'caution');
      result.evidence.push({...e, kind:'storm', checkedAt:routeSnap.savedAt});
    }
    const snow = (routeSnap.data.samples ?? []).map(s => ({...s,
      total:(s.hourly ?? []).filter(h => Date.parse(h.time) > start && Date.parse(h.time) <= end && Number.isFinite(h.snow)).reduce((sum,h)=>sum+h.snow,0),
    })).sort((a,b)=>b.total-a.total)[0];
    if (snow?.total > 0) {
      flag('caution');
      result.evidence.push({kind:'snow', title:snow.name, highway:snow.highway, snowfall:snow.total, source:snow.source,
        sourceUrl:snow.sourceUrl, updatedAt:snow.updatedAt, checkedAt:routeSnap.savedAt});
    }
    if (routeSnap.data.forecastCoverage==='sampled-6h') {
      const intervals=(routeSnap.data.samples??[]).flatMap(s=>(s.accumulations??[]).map(a=>({...a,name:s.name,highway:s.highway})))
        .filter(a=>a.snow>0&&Date.parse(a.start)<end&&Date.parse(a.end)>start).sort((a,b)=>b.snow-a.snow);
      if (intervals.length) {
        flag('caution');
        const a=intervals[0];
        result.evidence.push({...a,kind:'snow',title:a.name,snowfall:a.snow,checkedAt:routeSnap.savedAt});
      }
    }
  }
  if (start>now+6*HOUR) {result.uncertain.push('later');flag('caution');}
  if (result.status === 'go') result.evidence.push({kind:'checked', title:'', source:'Caltrans / CHP / NWS / Open-Meteo',
    sourceUrl:'https://quickmap.dot.ca.gov/', checkedAt:roadSnap.savedAt, updatedAt:routeSnap.savedAt});
  result.evidence.sort((a,b)=>(a.kind === 'closure' ? -1 : 0)-(b.kind === 'closure' ? -1 : 0));
  return result;
}

export function snowNext24(snap, now) {
  const rows = snap?.hourly?.filter(x=>Date.parse(x.time)>now && Date.parse(x.time)<=now+24*HOUR) ?? [];
  return rows.length === 24 && rows.every(r=>Number.isFinite(r.snow)) ? rows.reduce((sum,r)=>sum+r.snow,0) : null;
}

export function officialSnowLowerBound(snap,now){
  const periods=(snap?.accumulations??[]).filter(x=>Date.parse(x.start)>=now&&Date.parse(x.end)<=now+24*HOUR&&Number.isFinite(x.snow)).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
  let total=0;let end=now;
  for(const period of periods){if(Date.parse(period.start)<end)continue;total+=period.snow;end=Date.parse(period.end);}
  return periods.length?total:null;
}
