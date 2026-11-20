import {profile,points} from './itinerary.js';
import {reverseSegments} from './return-route.js';
import {routeTowns} from './route-towns.js';
import {weather,roads,routeWeather,townsWeather} from './sources.js?v=10';
import {MIN,HOUR,fresh,tripVerdict} from './logic.js?v=6';
import {chpSegments,chpSnapshot,refreshChpSnapshot,segmentKey} from './chp-snapshot.js';
import {driveForecastMaxAge,upcomingDriveDates} from './drive-weather.js?v=10';
import {forecastLength} from './forecast.js?v=10';

const localKey='dodge-ridge-public-snapshots-v2';
const route={segments:profile.segments,timeZone:profile.timeZone};
const returnRoute={segments:reverseSegments(route.segments),timeZone:route.timeZone};
const places=routeTowns(route.segments,points.base);
const kinds={base:'weather',summit:'weather',roads:'roads',returnRoads:'roads',routeWeather:'routeWeather',towns:'towns'};
let snapshots={};
try {
  const cached=JSON.parse(localStorage.getItem(localKey)??'{}');
  for(const key of Object.keys(kinds)) if(cached?.[key]?.data) snapshots[key]=cached[key];
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

async function forecastTowns(){
  const result=await townsWeather(places,profile.timeZone);
  if(!result.towns.some(t=>t.source))throw new Error('沿途城镇预报暂无数据。');
  return result;
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
  towns:forecastTowns,
};

async function updateSnapshot(key,now,feedCache){
  const previous=snapshots[key];
  if(now<Date.parse(previous?.retryAt))return false;
  try {
    const data=await loaders[key](feedCache);
    snapshots[key]={savedAt:new Date().toISOString(),data};
    return true;
  } catch(error){
    const attempts=Math.min((previous?.attempts??0)+1,7);
    const delay=Math.max(Number(error.retryAfterMs)||0,Math.min(6*HOUR,5*MIN*2**(attempts-1)));
    snapshots[key]={...previous,error:'本次抓取失败。',attempts,retryAt:new Date(Date.now()+delay).toISOString()};
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
  const forecasts=view('towns');
  const base=view('base');
  const summit=view('summit');
  const now=Date.now();
  const chp=chpSnapshot(now);
  const chpByRoute=new Map(chpSegments(chp,false).map(segment=>[segmentKey(segment),segment]));
  const outboundChp=!chp.stale&&profile.segments.every(segment=>chpByRoute.has(segmentKey(segment))) ? [...chpByRoute.values()] : null;
  const updatedAt=[road,returnRoad,routeForecast,forecasts,base,summit].map(v=>v?.savedAt).filter(Boolean).sort().at(-1);
  const roadsReady=[road,returnRoad].every(snapshot=>snapshot?.data&&!snapshot.stale&&snapshot.data.segments.every(segment=>segment.status==='ok'));
  const partial=Boolean(updatedAt)&&(!roadsReady||![base,summit,forecasts].every(v=>v?.data&&!v.stale));
  return {profile,roads:road,returnRoads:returnRoad,chp,routeWeather:routeForecast,routeTowns:{...forecasts,places},weather:{base,summit},
    verdict:tripVerdict(profile,road,routeForecast,now,outboundChp,chp.data?.fetchedAt),
    refreshStatus:{status:updatedAt?partial?'partial':'live':'unavailable',partial,updatedAt}};
}

export function refreshDashboard(){
  if(activeRefresh)return activeRefresh;
  activeRefresh=(async()=>{
    const now=Date.now();
    const feedCache=new Map();
    const [done]=await Promise.all([Promise.all(Object.keys(loaders).map(key=>update(key,now,feedCache))),refreshChpSnapshot()]);
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
  const driveReady = now - Date.parse(forecast?.savedAt) <= driveForecastMaxAge
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
