import {profile,points} from './itinerary.js';
import {routeTowns} from './route-towns.js';
import {weather,roads,routeWeather,townsWeather} from './sources.js';
import {MIN,HOUR,fresh,tripVerdict} from './logic.js';

const localKey='dodge-ridge-public-snapshots-v2';
const route={segments:profile.segments,timeZone:profile.timeZone};
const places=routeTowns(route.segments,points.base);
const kinds={base:'weather',summit:'weather',roads:'roads',routeWeather:'routeWeather',towns:'towns'};
let snapshots={};
try {
  const cached=JSON.parse(localStorage.getItem(localKey)??'{}');
  for(const key of Object.keys(kinds)) if(cached?.[key]?.data) snapshots[key]=cached[key];
} catch { /* Private browsing and missing storage still support live fetches. */ }
let activeRefresh;

function view(key){
  const value=snapshots[key];
  return value?{...value,stale:!fresh(value,kinds[key])}:null;
}

function cameraPage(c){
  if(!Number.isFinite(c.lat)||!Number.isFinite(c.lon))return 'https://quickmap.dot.ca.gov/';
  const query=new URLSearchParams({layers:'cameras',view:`${c.lat.toFixed(5)},${c.lon.toFixed(5)},14`});
  return `https://quickmap.dot.ca.gov/?${query}`;
}

async function publicRoads(){
  const result=await roads(route);
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

const loaders={base:()=>weather(points.base),summit:()=>weather(points.summit),roads:publicRoads,routeWeather:forecastRoute,towns:forecastTowns};

async function update(key,now){
  const previous=snapshots[key];
  if(now<Date.parse(previous?.retryAt))return false;
  try {
    const data=await loaders[key]();
    snapshots[key]={savedAt:new Date().toISOString(),data};
    return true;
  } catch(error){
    const attempts=Math.min((previous?.attempts??0)+1,7);
    const delay=Math.max(Number(error.retryAfterMs)||0,Math.min(6*HOUR,5*MIN*2**(attempts-1)));
    snapshots[key]={...previous,error:'本次抓取失败。',attempts,retryAt:new Date(Date.now()+delay).toISOString()};
    return false;
  }
}

export function loadDashboard(){
  const road=view('roads');
  const routeForecast=view('routeWeather');
  const forecasts=view('towns');
  const base=view('base');
  const summit=view('summit');
  const updatedAt=[road,routeForecast,forecasts,base,summit].map(v=>v?.savedAt).filter(Boolean).sort().at(-1);
  const partial=Boolean(updatedAt)&&(!road?.data||road.stale||road.data.segments.some(s=>s.status!=='ok')||![base,summit,forecasts].every(v=>v?.data&&!v.stale));
  return {profile,roads:road,routeWeather:routeForecast,routeTowns:{...forecasts,places},weather:{base,summit},
    verdict:tripVerdict(profile,road,routeForecast),
    refreshStatus:{status:updatedAt?partial?'partial':'live':'unavailable',partial,updatedAt}};
}

export function refreshDashboard(){
  if(activeRefresh)return activeRefresh;
  activeRefresh=(async()=>{
    const now=Date.now();
    const done=await Promise.all(Object.keys(loaders).map(key=>update(key,now)));
    try{localStorage.setItem(localKey,JSON.stringify(snapshots));}catch{}
    const dashboard=loadDashboard();
    if(!done.some(Boolean)&&dashboard.refreshStatus.updatedAt)dashboard.refreshStatus.status='cached';
    return dashboard;
  })().finally(()=>{activeRefresh=undefined;});
  return activeRefresh;
}
