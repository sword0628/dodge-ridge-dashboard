import {profile,points} from './itinerary.js';
import {reverseSegments} from './return-route.js';
import {routeTowns} from './route-towns.js';
import {weather,roads,routeWeather,townsWeather,townsFallbackWeather} from './sources.js?v=14';
import {MIN,HOUR,fresh,tripVerdict} from './logic.js?v=6';
import {chpSegments,chpSnapshot,refreshChpSnapshot,segmentKey} from './chp-snapshot.js';
import {driveDisplayDates,driveForecastMaxAge,hasCompleteDriveDate,upcomingDriveDates} from './drive-weather.js?v=14';
import {forecastLength} from './forecast.js?v=10';
import {townSnapshotView} from './town-snapshot.js?v=14';

const localKey='dodge-ridge-public-snapshots-v2';
const route={segments:profile.segments,timeZone:profile.timeZone};
const returnRoute={segments:reverseSegments(route.segments),timeZone:route.timeZone};
const places=routeTowns(route.segments,points.base);
const kinds={base:'weather',summit:'weather',roads:'roads',returnRoads:'roads',routeWeather:'routeWeather',towns:'towns'};
let snapshots={};
try {
  const cached=JSON.parse(localStorage.getItem(localKey)??'{}');
  for(const key of Object.keys(kinds)) if(cached?.[key]?.data || cached?.[key]?.retryAt) snapshots[key]=cached[key];
} catch { /* Private browsing and missing storage still support live fetches. */ }
let activeRefresh;
let activeDriveRefresh;
const pendingLoads = new Map();

function view(key){
  const value=snapshots[key];
  return value?{...value,stale:!fresh(value,kinds[key])}:null;
}

function persist(){
  try{localStorage.setItem(localKey,JSON.stringify(snapshots));}catch{}
}

function cameraPage(c){
  if(!Number.isFinite(c.lat)||!Number.isFinite(c.lon))return 'https://quickmap.dot.ca.gov/';
  const query=new URLSearchParams({layers:'cameras',view:`${c.lat.toFixed(5)},${c.lon.toFixed(5)},14`});
  return `https://quickmap.dot.ca.gov/?${query}`;
}

async function publicRoads(roadRoute, feedCache){
  const result=await roads(roadRoute,feedCache);
  if(result.segments.every(p=>p.status==='unavailable'))throw new Error('Caltrans 暂不可用。');
  return {...result,segments:result.segments.map(p=>({...p,cameras:p.cameras.map(({url,...c})=>({...c,officialUrl:cameraPage(c)}))}))};
}

function hasPrimaryTownForecast(data){
  return data?.primaryAvailable ?? (data?.towns?.length>0 && data.towns.every(town=>town.source==='Open-Meteo'));
}

async function forecastRoute(){
  const result=await routeWeather(route);
  if(result.coverage==='unavailable')throw new Error('沿途天气暂无数据。');
  return result;
}

const loaders={
  base:()=>weather(points.base),
  summit:()=>weather(points.summit),
  roads:feedCache=>publicRoads(route,feedCache),
  returnRoads:feedCache=>publicRoads(returnRoute,feedCache),
  routeWeather:forecastRoute,
};

function fetchFailure(previous,error){
  const attempts=Math.min((previous?.attempts??0)+1,7);
  const delay=Math.max(Number(error?.retryAfterMs)||0,Math.min(6*HOUR,5*MIN*2**(attempts-1)));
  return {error:'本次抓取失败。',attempts,retryAt:new Date(Date.now()+delay).toISOString()};
}

async function updateTowns(now){
  const previous=snapshots.towns;
  if (!(now<Date.parse(previous?.retryAt))) {
    const dates=driveDisplayDates(now,profile.timeZone);
    const retained=hasCompleteDriveDate(previous?.data,places,dates);
    try {
      const data=await townsWeather(places,profile.timeZone);
      if (!hasPrimaryTownForecast(data) || retained&&!hasCompleteDriveDate(data,places,dates)) {
        throw new Error('Open-Meteo route forecast is incomplete.');
      }
      snapshots.towns={savedAt:data.fetchedAt,data};
      return true;
    } catch(error) {
      snapshots.towns={...previous,...fetchFailure(previous,error),retained};
    }
  }
  const current=snapshots.towns;
  if (now<Date.parse(current?.fallbackRetryAt)) return false;
  const allowVisual=!(now<Date.parse(current?.visualRetryAt));
  const {visualTowns,nwsTowns,visualRetryAt,period}=await townsFallbackWeather(places,profile.timeZone,{allowVisual});
  const anyBackup=visualTowns.length>0 || nwsTowns.length>0;
  const old=current?.fallback;
  snapshots.towns={...current,
    fallbackRetryAt:new Date(Date.now()+(visualTowns.length || !allowVisual?HOUR:15*MIN)).toISOString(),
    visualRetryAt:visualRetryAt>Date.now()?new Date(visualRetryAt).toISOString():allowVisual?undefined:current?.visualRetryAt,
    fallback:anyBackup?{period,savedAt:new Date().toISOString(),
      visualTowns:visualTowns.length?visualTowns:old?.visualTowns ?? [],
      nwsTowns:nwsTowns.length?nwsTowns:old?.nwsTowns ?? []}:old,
  };
  return false;
}

async function updateSnapshot(key,now,feedCache){
  if(key==='towns')return updateTowns(now);
  const previous=snapshots[key];
  if(now<Date.parse(previous?.retryAt))return false;
  try {
    const data=await loaders[key](feedCache);
    snapshots[key]={savedAt:new Date().toISOString(),data};
    return true;
  } catch(error){
    snapshots[key]={...previous,...fetchFailure(previous,error)};
    return false;
  }
}

function update(key,now,feedCache){
  if (pendingLoads.has(key)) return pendingLoads.get(key);
  const pending = updateSnapshot(key,now,feedCache).finally(()=>pendingLoads.delete(key));
  pendingLoads.set(key,pending);
  return pending;
}

export function loadDashboard(){
  const road=view('roads');
  const returnRoad=view('returnRoads');
  const routeForecast=view('routeWeather');
  const now=Date.now();
  const forecasts=townSnapshotView(view('towns'),places,now);
  const base=view('base');
  const summit=view('summit');
  const chp=chpSnapshot(now);
  const chpByRoute=new Map(chpSegments(chp,false).map(segment=>[segmentKey(segment),segment]));
  const outboundChp=!chp.stale&&profile.segments.every(segment=>chpByRoute.has(segmentKey(segment))) ? [...chpByRoute.values()] : null;
  const updatedAt=[road,returnRoad,routeForecast,forecasts,base,summit].map(v=>v?.savedAt).filter(Boolean).sort().at(-1);
  const roadsReady=[road,returnRoad].every(snapshot=>snapshot?.data&&!snapshot.stale&&snapshot.data.segments.every(segment=>segment.status==='ok'));
  const partial=Boolean(updatedAt)&&(!roadsReady||![base,summit,forecasts].every(v=>v?.data&&!v.stale)||!!forecasts?.error||!hasPrimaryTownForecast(forecasts?.data));
  return {profile,roads:road,returnRoads:returnRoad,chp,routeWeather:routeForecast,routeTowns:{...forecasts,places},weather:{base,summit},
    verdict:tripVerdict(profile,road,routeForecast,now,outboundChp,chp.data?.fetchedAt),
    refreshStatus:{status:updatedAt?partial?'partial':'live':'unavailable',partial,updatedAt}};
}

export function refreshDashboard(){
  if(activeRefresh)return activeRefresh;
  activeRefresh=(async()=>{
    const now=Date.now();
    const feedCache=new Map();
    const [done]=await Promise.all([Promise.all(Object.keys(kinds).map(key=>update(key,now,feedCache))),refreshChpSnapshot()]);
    persist();
    const dashboard=loadDashboard();
    if(!done.some(Boolean)&&dashboard.refreshStatus.updatedAt)dashboard.refreshStatus.status='cached';
    return dashboard;
  })().finally(()=>{activeRefresh=undefined;});
  return activeRefresh;
}

export async function refreshRoadLayers(){
  if(activeRefresh)return activeRefresh;
  const now=Date.now();
  const feedCache=new Map();
  await Promise.all([
    ...['roads','returnRoads'].map(key=>fresh(snapshots[key],'roads',now)&&now-Date.parse(snapshots[key].savedAt)<3*MIN ? null : update(key,now,feedCache)),
    refreshChpSnapshot(),
  ]);
  persist();
  return loadDashboard();
}

export function refreshDriveForecast(){
  if (activeRefresh) return activeRefresh;
  if (activeDriveRefresh) return activeDriveRefresh;
  const now = Date.now();
  const forecast = snapshots.towns;
  const lastDate = upcomingDriveDates(now,profile.timeZone).at(-1);
  const driveReady = !forecast?.error && hasPrimaryTownForecast(forecast?.data)
    && now - Date.parse(forecast?.savedAt) <= driveForecastMaxAge
    && forecast?.data?.towns?.some(town=>town.mornings?.some(morning=>morning.date===lastDate));
  const resortRefreshes = ['base','summit'].filter(key=>
    !fresh(snapshots[key],'weather',now) || snapshots[key]?.data?.forecastDaysRequested!==forecastLength);
  activeDriveRefresh = (async()=>{
    await Promise.all([
      driveReady ? null : update('towns',now),
      fresh(snapshots.routeWeather,'routeWeather',now) ? null : update('routeWeather',now),
      ...resortRefreshes.map(key=>update(key,now)),
    ]);
    persist();
    return loadDashboard();
  })().finally(()=>{activeDriveRefresh=undefined;});
  return activeDriveRefresh;
}
