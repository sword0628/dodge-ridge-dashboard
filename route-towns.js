import {sierraRouteTowns} from './route-landmarks.js';

// Public city and town forecast points along the imported California itinerary.
// Fremont uses the Warm Springs area, close to I-880 and Mission Boulevard.
const towns = [
  {id:'santa-clara',name:'Santa Clara',lat:37.3541,lon:-121.9552,range:9},
  {id:'fremont',name:'Fremont',lat:37.5022,lon:-121.9393,range:4},
  {id:'livermore',name:'Livermore',lat:37.6819,lon:-121.7680,range:5},
  {id:'tracy',name:'Tracy',lat:37.7397,lon:-121.4252,range:4},
  {id:'manteca',name:'Manteca',lat:37.7974,lon:-121.2161,range:4},
  {id:'oakdale',name:'Oakdale',lat:37.7666,lon:-120.8470,range:4},
  {id:'sonora',name:'Sonora',lat:37.9841,lon:-120.3821,range:4},
  ...sierraRouteTowns.map(town=>({...town,range:2})),
  {id:'pinecrest',name:'Pinecrest',lat:38.1894,lon:-120.0007,range:4},
];

function closeToLine({lat,lon,range},line){
  const xScale=111.2*Math.cos(lat*Math.PI/180);
  return line.slice(1).some(([endLon,endLat],i)=>{
    const [lon0,lat0]=line[i];
    const x=(lon0-lon)*xScale,y=(lat0-lat)*111.2;
    const dx=(endLon-lon0)*xScale,dy=(endLat-lat0)*111.2;
    const span=dx*dx+dy*dy;
    const f=span?Math.max(0,Math.min(1,-(x*dx+y*dy)/span)):0;
    return Math.hypot(x+f*dx,y+f*dy)<=range;
  });
}

export function routeTowns(segments,dodgeRidgeBase){
  const lines=segments.filter(s=>s.state==='CA'&&s.geometry?.length>=2).map(s=>s.geometry);
  const places=towns.filter(town=>lines.some(line=>closeToLine(town,line))).map(({range,...place})=>place);
  if(places.some(p=>p.id==='pinecrest')&&Number.isFinite(dodgeRidgeBase?.lat)&&Number.isFinite(dodgeRidgeBase?.lon)) {
    const {lat,lon,elevation}=dodgeRidgeBase;
    places.push({id:'dodge-ridge-base',name:'Dodge Ridge',lat,lon,elevation});
  }
  return places;
}
