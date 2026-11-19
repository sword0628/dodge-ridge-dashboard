import {routeLandmarks} from './route-landmarks.js';
import {roadLocation} from './road-locale.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tileService = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile';
const worldSize = 256;
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const wrap = (value,period) => ((value%period)+period)%period;
const minZoom=2, maxZoom=17;
const overviewLandmarks=new Set(['santa-clara','sonora','pinecrest','dodge-ridge']);
const severity=['closure','accident','restriction'];

function coordinate(lat, lon) {
  if (lat == null || lon == null || lat === '' || lon === '') return null;
  lat = Number(lat);
  lon = Number(lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? {lat, lon} : null;
}

function segmentGeometry(segment) {
  const source = segment.geometry?.coordinates ?? segment.geometry;
  if (!Array.isArray(source)) return {lines:[], first:null, last:null};
  const points = source.map(value => Array.isArray(value) ? coordinate(value[1], value[0]) : null);
  const lines = [];
  let line = [];
  for (const point of [...points, null]) {
    if (point) line.push(point);
    else {
      if (line.length > 1) lines.push(line);
      line = [];
    }
  }
  return {lines, first:points[0], last:points.at(-1)};
}

const longitudeDelta=(longitude,relativeTo)=>((longitude-relativeTo+540)%360)-180;

function pathMidpoint(lines) {
  const spans=[];
  let total=0;
  for (const line of lines) for (let i=1;i<line.length;i++) {
    const start=line[i-1];
    const end=line[i];
    const deltaLon=longitudeDelta(end.lon,start.lon);
    const latitudeScale=Math.cos((start.lat+end.lat)*Math.PI/360);
    const distance=Math.hypot(end.lat-start.lat,deltaLon*latitudeScale);
    if (distance>0) {
      spans.push({start,end,deltaLon,distance});
      total+=distance;
    }
  }
  let remaining=total/2;
  for (const {start,end,deltaLon,distance} of spans) {
    if (remaining<=distance) {
      const ratio=remaining/distance;
      return {lat:start.lat+(end.lat-start.lat)*ratio,lon:longitudeDelta(start.lon+deltaLon*ratio,0)};
    }
    remaining-=distance;
  }
  return lines[0]?.[0]??null;
}

function project(point, around=point.lon) {
  const latitude=clamp(point.lat,-85.05112878,85.05112878)*Math.PI/180;
  const longitude=around+longitudeDelta(point.lon,around);
  return {
    x:worldSize*(longitude+180)/360,
    y:worldSize*(1-Math.asinh(Math.tan(latitude))/Math.PI)/2,
  };
}

const styles = `<style>
.road-map {display:grid;gap:.65rem;min-width:0}
.road-map .road-map-toolbar,.road-map .road-map-legend,.road-map .road-map-closures {display:flex;flex-wrap:wrap;gap:.4rem .65rem;align-items:center}
.road-map .road-map-toolbar {justify-content:space-between}
.road-map .road-map-tools {display:flex;gap:.3rem;align-items:center}
.road-map .road-map-tools button {min-width:38px;min-height:38px;padding:.25rem .55rem}
.road-map .road-map-stage {position:relative;min-height:280px;aspect-ratio:2/1;max-height:510px;overflow:hidden;isolation:isolate;border:1px solid var(--line,#ceddd4);border-radius:11px;background-color:var(--soft,#eef5f0);background-image:linear-gradient(to right,#436e5716 1px,transparent 1px),linear-gradient(to bottom,#436e5716 1px,transparent 1px);background-size:32px 32px;cursor:grab;touch-action:pan-y}
.road-map .road-map-stage[data-zoomed] {touch-action:none}
.road-map .road-map-stage[data-dragging] {cursor:grabbing}
.road-map .road-map-tiles,.road-map .road-map-landmarks,.road-map .road-map-stage svg {position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.road-map .road-map-tiles {z-index:-2}
.road-map .road-map-stage svg {z-index:-1;overflow:visible}
.road-map .road-map-tile {position:absolute;max-width:none;user-select:none}
.road-map .road-map-landmark {position:absolute;transform:translate(-50%,-50%);white-space:nowrap;color:#214337;font-size:11px;font-weight:700;line-height:14px;padding:0 3px;border-radius:4px;background:#ffffffdf}
.road-map .road-map-halo {fill:none;stroke:#f4f9f4;stroke-width:8;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
.road-map .road-map-track {fill:none;stroke:var(--accent,#23634e);stroke-width:4;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
.road-map .road-map-pin {position:absolute;display:grid;place-items:center;width:42px;height:42px;min-height:0;padding:0;transform:translate(-50%,-50%);border:0;background:none;box-shadow:none;z-index:1}
.road-map .road-map-pin[data-kind=closure] {z-index:4}
.road-map .road-map-pin[data-kind=accident] {z-index:3}
.road-map .road-map-pin[data-kind=restriction] {z-index:2}
.road-map .road-map-pin[data-kind=segment] {width:28px;height:28px;z-index:0}
.road-map .road-map-pin:hover {background:none}
.road-map .road-map-pin:is(:focus-visible,[aria-pressed=true]) {background:none;z-index:8}
.road-map .road-map-pin[aria-pressed=true] .road-map-chip {outline:3px solid var(--ink,#123731);outline-offset:2px}
.road-map .road-map-chip {display:inline-grid;place-items:center;min-width:1.45em;height:1.45em;border-radius:50%;background:#2e5549;color:#fff;font-size:.87rem;font-weight:760;line-height:1}
.road-map .road-map-pin .road-map-chip {width:28px;height:28px;border:2px solid #fff;box-shadow:0 1px 5px #182f3170}
.road-map .road-map-pin[data-kind=segment] .road-map-chip {min-width:0;width:18px;height:18px;font-size:.67rem;box-shadow:0 1px 3px #182f3150}
.road-map [data-kind=closure] .road-map-chip {background:#a32224}
.road-map [data-kind=accident] .road-map-chip {background:#a14818}
.road-map [data-kind=restriction] .road-map-chip {background:#e6b547;color:#302000}
.road-map .road-map-legend > span {display:inline-flex;gap:.3rem;align-items:center}
.road-map .road-map-track-symbol {width:1.45rem;border-top:3px solid var(--accent,#23634e);border-radius:3px}
.road-map .road-map-closures p {width:100%}
.road-map .road-map-closures button {display:inline-flex;gap:.4rem;align-items:center;text-align:start;border-color:#d69491;background:#fff5f3;color:#841d21}
.road-map .road-map-detail {padding:.65rem .75rem;border:1px solid var(--line,#ceddd4);border-radius:9px;min-width:0;overflow-wrap:anywhere}
.road-map .road-map-detail h4 {display:flex;gap:.4rem;align-items:center;margin:0 0 .35rem}
.road-map .road-map-detail small {display:block;margin-top:.3rem}
.road-map .road-map-credit {font-size:.73rem;overflow-wrap:anywhere}
</style>`;

export function roadMap(profileSegments = [], reportSegments = [], language = 'zh') {
  const tr = (zh, en) => language === 'en' ? en : zh;
  const categories = {
    closure:[tr('封闭','Closure'),tr('封','X')], restriction:[tr('管制','Restriction'),tr('管','R')],
    accident:[tr('事故','Incident'),tr('事','I')], segment:[tr('路段','Segment'),tr('路','S')],
  };
  const routes = profileSegments.length ? profileSegments : reportSegments;
  const tracks = [];
  const markers = [];
  for (const [segmentIndex,segment] of routes.entries()) {
    const {lines:paths, first, last} = segmentGeometry(segment);
    for (const path of paths) tracks.push({path,segmentIndex});
    const start = coordinate(segment.startLat, segment.startLon) ?? first;
    const end = coordinate(segment.endLat, segment.endLon) ?? last;
    const critical = reportSegments[segmentIndex]?.critical ?? [];
    const counts = Object.fromEntries(severity.map(kind=>[kind,critical.filter(event=>event.kind===kind).length]));
    const kind = severity.find(value=>counts[value]>0) ?? 'segment';
    const knownIssue = critical.find(event=>event.kind===kind && coordinate(event.lat,event.lon));
    const point = pathMidpoint(paths) ?? start ?? end ?? coordinate(knownIssue?.lat,knownIssue?.lon);
    const title = [segment.start,segment.end].filter(Boolean).map(value=>roadLocation(value,language)).join(' → ');
    if (point) markers.push({point,kind,counts,title,highway:segment.highway,segmentIndex,key:`road-marker-${segmentIndex}`});
  }
  const points = [...tracks.flatMap(track=>track.path), ...markers.map(marker => marker.point)];
  if (!points.length) return `<div class="empty">${tr('地图暂无数据。确认路段坐标或公路几何后可显示。','No map data yet. Confirm segment coordinates or highway geometry to display the route.')}</div>`;

  const around=points[0].lon;
  const bounds=[Infinity,Infinity,-Infinity,-Infinity];
  for (const point of points) {
    const {x,y}=project(point,around);
    bounds[0]=Math.min(bounds[0],x);
    bounds[1]=Math.min(bounds[1],y);
    bounds[2]=Math.max(bounds[2],x);
    bounds[3]=Math.max(bounds[3],y);
  }
  const paths = tracks.map(({path,segmentIndex})=>({segmentIndex,coordinates:path.map(point=>{
    const {x,y}=project(point,around);
    return `${x.toFixed(9)},${y.toFixed(9)}`;
  }).join(' ')}));
  const routeDrawing=['halo','track'].flatMap(kind=>paths.map(({coordinates,segmentIndex})=>
    `<polyline class="road-map-${kind}" points="${coordinates}"${kind==='track'?` data-segment-index="${segmentIndex}"`:''}></polyline>`
  )).join('');
  const chip = kind => `<span class="road-map-chip" aria-hidden="true">${categories[kind][1]}</span>`;
  const segmentLabel = marker => [marker.highway,marker.title].filter(Boolean).join(' · ') || categories.segment[0];
  const issues = marker => severity.filter(kind=>marker.counts[kind]>0).map(kind=>`${categories[kind][0]} ${marker.counts[kind]}`).join(' · ');
  const mapPins = markers.map(marker => {
    const {x,y} = project(marker.point,around);
    const label = escapeHtml([segmentLabel(marker),issues(marker)].filter(Boolean).join(' · '));
    return `<button type="button" class="road-map-pin" data-map-pin="${marker.key}" data-kind="${marker.kind}" data-segment-index="${marker.segmentIndex}" data-x="${x}" data-y="${y}" aria-label="${label}" title="${label}" aria-pressed="false" hidden>${chip(marker.kind)}</button>`;
  }).join('');
  const closureButtons = markers.filter(marker => marker.kind === 'closure').map(marker => `<button type="button" data-map-focus="${marker.key}" data-kind="closure">${chip('closure')}${escapeHtml(segmentLabel(marker))}</button>`).join('');
  const legend = [...severity,'segment'].filter(kind=>markers.some(marker=>marker.kind===kind)).map(kind => `<span data-kind="${kind}">${chip(kind)}${categories[kind][0]}</span>`).join('');
  const descriptions = markers.map(marker=>{
    const summary = issues(marker);
    return `<template data-map-template="${marker.key}"><h4 data-kind="${marker.kind}">${chip(marker.kind)}${escapeHtml(segmentLabel(marker))}</h4>${summary?`<p>${escapeHtml(summary)}</p>`:''}</template>`;
  }).join('');

  return `${styles}<div class="road-map" data-road-map data-bounds="${bounds.join(',')}" data-reference-longitude="${around}">
    ${closureButtons?`<div class="road-map-closures"><p><strong>${tr('封闭路段','Segments with closures')}</strong></p>${closureButtons}</div>`:''}
    <div class="road-map-toolbar"><p><strong>${tr('监控路段地图','Monitored road map')}</strong></p><div class="road-map-tools">
      <button type="button" data-map-command="zoom-out" aria-label="${tr('缩小地图','Zoom out')}" disabled>−</button>
      <button type="button" data-map-command="zoom-in" aria-label="${tr('放大地图','Zoom in')}">+</button>
      <button type="button" data-map-command="reset" disabled>${tr('重置地图','Reset map')}</button>
    </div></div>
    ${!tracks.length?`<p class="muted">${tr('暂无完整公路几何，仅显示已核实的点位。','Highway geometry is unavailable. The map shows confirmed points.')}</p>`:''}
    <div class="road-map-stage" data-map-stage tabindex="0" role="group" aria-label="${tr('监控路段。可拖动或按方向键移动。','Monitored corridor. Drag or use the arrow keys to pan.')}">
      <div class="road-map-tiles" data-map-tiles aria-hidden="true"></div>
      <div class="road-map-landmarks" data-map-landmarks aria-hidden="true"></div>
      <svg preserveAspectRatio="none" aria-hidden="true">${routeDrawing}</svg>${mapPins}
    </div>
    <p class="road-map-credit muted"><a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener noreferrer">${tr('底图：美国地质调查局国家地理空间计划','Basemap: U.S. Geological Survey, National Geospatial Program')}</a><span data-map-offline hidden> · ${tr('底图暂未完整加载','Basemap is not fully loaded')}</span></p>
    <div class="road-map-legend muted">${tracks.length?`<span><i class="road-map-track-symbol" aria-hidden="true"></i>${tr('监控路段','Monitored highway')}</span>`:''}${legend}</div>
    ${markers.length?`<div class="road-map-detail" data-map-detail aria-live="polite"><p class="muted">${tr('点按路线或地图标记查看详情。','Select a route line or map marker for details.')}</p></div>`:''}${descriptions}
  </div>`;
}

export function bindRoadMap(root) {
  const map = root?.querySelector('[data-road-map]');
  if (!map || map.dataset.bound) return;
  map.dataset.bound = 'true';
  const stage = map.querySelector('[data-map-stage]');
  const svg = stage.querySelector('svg');
  const detail = map.querySelector('[data-map-detail]');
  const pins = [...stage.querySelectorAll('[data-map-pin]')];
  const tracks=[...svg.querySelectorAll('[data-segment-index]')].map(line=>({
    index:Number(line.dataset.segmentIndex),
    points:Array.from(line.points,p=>[p.x,p.y]),
  }));
  const routePins=new Map(pins.map(pin=>[Number(pin.dataset.segmentIndex),pin]));
  const commands = Object.fromEntries([...map.querySelectorAll('[data-map-command]')].map(node => [node.dataset.mapCommand,node]));
  const tileLayer=stage.querySelector('[data-map-tiles]');
  const landmarkLayer=stage.querySelector('[data-map-landmarks]');
  const offline=map.querySelector('[data-map-offline]');
  const bounds=map.dataset.bounds.split(',').map(Number);
  const longitude=Number(map.dataset.referenceLongitude);
  const landmarks=routeLandmarks.map(p=>({...p,...project(p,longitude)})).sort((a,b)=>a.priority-b.priority);
  const tiles=new Map();
  let visibleTiles=new Set();
  let occupied=[];
  let frame, fit, view;
  let basemapOnline;
  let moved=false;
  let pointer;
  let suppressLineClick=false;
  let dragFrame=0;
  let nextDrag;

  function fitViewport() {
    const width=stage.clientWidth,height=stage.clientHeight;
    if (!width||!height) return;
    const padding=Math.min(38,width*.11,height*.11);
    const [west,north,east,south]=bounds;
    const scale=Math.min((width-2*padding)/Math.max(east-west,.001),(height-2*padding)/Math.max(south-north,.001));
    fit={x:(west+east)/2,y:(north+south)/2,zoom:clamp(Math.log2(scale),minZoom,15)};
    paint(moved&&view?view:fit);
  }

  function position(worldX,worldY) {
    return {x:(worldX-frame.left)*frame.scale,y:(worldY-frame.top)*frame.scale};
  }

  function paintLandmarks(online) {
    const boxes=[...occupied];
    const labels=document.createDocumentFragment();
    for (const landmark of landmarks) {
      if (online&&!overviewLandmarks.has(landmark.id)) continue;
      const {x,y}=position(landmark.x,landmark.y);
      if (x<0||y<0||x>frame.width||y>frame.height) continue;
      const halfWidth=landmark.name.length*3.2+4;
      const labelX=clamp(x,halfWidth+4,frame.width-halfWidth-4);
      const right=x+halfWidth+9,left=x-halfWidth-9;
      const choices=[[labelX,y+18],[labelX,y-18],[right,y],[left,y],[labelX,y+28],[labelX,y-28],
        [right,y+17],[right,y-17],[left,y+17],[left,y-17],[labelX,y+40],[labelX,y-40]];
      for (const [cx,cy] of choices) {
        const box=[cx-halfWidth,cy-7,cx+halfWidth,cy+7];
        if (box[0]<3||box[1]<3||box[2]>frame.width-3||box[3]>frame.height-3) continue;
        if (boxes.some(([l,t,r,b])=>box[0]<r&&box[1]<b&&box[2]>l&&box[3]>t)) continue;
        const label=document.createElement('span');
        label.className='road-map-landmark';
        label.textContent=landmark.name;
        label.style.left=`${cx}px`;
        label.style.top=`${cy}px`;
        labels.append(label);
        boxes.push(box);
        break;
      }
    }
    landmarkLayer.replaceChildren(labels);
  }

  function updateBasemapStatus(moved=false) {
    const loaded=[...visibleTiles].filter(key=>tiles.get(key)?.loaded).length;
    const online=visibleTiles.size>0&&loaded/visibleTiles.size>=.75;
    offline.hidden=online;
    if ((moved||online!==basemapOnline)&&frame) paintLandmarks(online);
    basemapOnline=online;
  }

  function paintTiles() {
    const level=clamp(Math.round(view.zoom),minZoom,maxZoom);
    const count=2**level;
    const span=worldSize/count;
    const size=span*frame.scale;
    const firstX=Math.floor(frame.left/span);
    const lastX=Math.ceil((frame.left+frame.width/frame.scale)/span)-1;
    const firstY=Math.max(0,Math.floor(frame.top/span));
    const lastY=Math.min(count-1,Math.ceil((frame.top+frame.height/frame.scale)/span)-1);
    const active=new Set();
    for (let y=firstY;y<=lastY;y++) for (let x=firstX;x<=lastX;x++) {
      const key=`${level}/${y}/${x}`;
      active.add(key);
      let tile=tiles.get(key);
      if (!tile) {
        const img=document.createElement('img');
        img.className='road-map-tile';
        img.alt='';
        img.draggable=false;
        img.decoding='async';
        img.referrerPolicy='no-referrer';
        img.hidden=true;
        tile={img,loaded:false};
        tiles.set(key,tile);
        img.addEventListener('load',()=>{
          tile.loaded=img.naturalWidth>0;
          img.hidden=!tile.loaded||!visibleTiles.has(key);
          updateBasemapStatus();
        },{once:true});
        img.addEventListener('error',()=>{img.hidden=true;updateBasemapStatus();},{once:true});
        img.src=`${tileService}/${level}/${y}/${wrap(x,count)}`;
        tileLayer.append(img);
      }
      const location=position(x*span,y*span);
      tile.img.style.left=`${location.x}px`;
      tile.img.style.top=`${location.y}px`;
      tile.img.style.width=`${size+.2}px`;
      tile.img.style.height=`${size+.2}px`;
      tile.img.hidden=!tile.loaded;
    }
    visibleTiles=active;
    for (const [key,tile] of tiles) {
      if (active.has(key)) continue;
      tile.img.hidden=true;
      if (tiles.size>64) {
        tile.img.remove();
        tiles.delete(key);
      }
    }
    updateBasemapStatus(true);
  }

  function paint(next) {
    const width=stage.clientWidth,height=stage.clientHeight;
    if (!width||!height) return;
    const zoom=clamp(next.zoom,minZoom,maxZoom);
    const scale=2**zoom;
    const halfWidth=width/(2*scale),halfHeight=height/(2*scale);
    const yMargin=Math.min(worldSize/2,halfHeight);
    view={zoom,x:next.x,y:clamp(next.y,yMargin,worldSize-yMargin)};
    frame={width,height,scale,left:view.x-halfWidth,top:view.y-halfHeight};
    svg.setAttribute('viewBox',`${frame.left} ${frame.top} ${2*halfWidth} ${2*halfHeight}`);
    occupied=[];
    for (const pin of pins) {
      const {x,y}=position(Number(pin.dataset.x),Number(pin.dataset.y));
      pin.style.left=`${x}px`;
      pin.style.top=`${y}px`;
      const outside=x<0||x>width||y<0||y>height;
      if (outside && pin === document.activeElement) stage.focus({preventScroll:true});
      pin.hidden = outside;
      const radius=pin.dataset.kind==='segment'?10:15;
      if (!outside) occupied.push([x-radius,y-radius,x+radius,y+radius]);
    }
    paintTiles();
    stage.toggleAttribute('data-zoomed',zoom>fit.zoom+.05);
    commands['zoom-in'].disabled=zoom>=maxZoom;
    commands['zoom-out'].disabled=zoom<=minZoom;
    commands.reset.disabled=!moved;
  }

  function changeZoom(amount) {
    if (!view) return;
    moved=true;
    paint({...view,zoom:view.zoom+amount});
  }

  function reset() {
    moved=false;
    if (fit) paint(fit);
  }

  function emitSegment(index) {
    if (Number.isInteger(index)&&index>=0) map.dispatchEvent(new CustomEvent('roadsegmentselect',{bubbles:true,detail:{index}}));
  }

  function selectPin(pin, center) {
    if (!pin || !detail) return;
    for (const marker of pins) marker.setAttribute('aria-pressed',String(marker === pin));
    const template = map.querySelector(`[data-map-template="${pin.dataset.mapPin}"]`);
    if (template) detail.replaceChildren(template.content.cloneNode(true));
    if (center&&view) {
      moved=true;
      paint({zoom:Math.max(fit.zoom+2,view.zoom),x:Number(pin.dataset.x),y:Number(pin.dataset.y)});
      pin.focus({preventScroll:true});
    }
    emitSegment(Number(pin.dataset.segmentIndex));
  }

  function selectTrack(event) {
    if (!frame||suppressLineClick||pointer?.dragged) return;
    const rect=stage.getBoundingClientRect();
    const x=frame.left+(event.clientX-rect.left-stage.clientLeft)/frame.scale;
    const y=frame.top+(event.clientY-rect.top-stage.clientTop)/frame.scale;
    const radius=(event.pointerType==='touch'?16:10)/frame.scale;
    let nearest=radius*radius;
    let selected;
    for (const track of tracks) for (let i=1;i<track.points.length;i++) {
      const [ax,ay]=track.points[i-1],[bx,by]=track.points[i];
      const dx=bx-ax,dy=by-ay;
      const length=dx*dx+dy*dy;
      const at=length?clamp(((x-ax)*dx+(y-ay)*dy)/length,0,1):0;
      const distance=(x-ax-at*dx)**2+(y-ay-at*dy)**2;
      if (distance<nearest) {
        selected=track.index;
        nearest=distance;
      }
    }
    if (selected===undefined) return;
    const pin=routePins.get(selected);
    if (pin) selectPin(pin,false);
    else emitSegment(selected);
  }

  map.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !map.contains(button)) {
      if (stage.contains(event.target)) selectTrack(event);
      return;
    }
    if (button.dataset.mapPin) selectPin(button, false);
    else if (button.dataset.mapFocus) selectPin(pins.find(pin => pin.dataset.mapPin === button.dataset.mapFocus), true);
    else if (button.dataset.mapCommand === 'zoom-in') changeZoom(1);
    else if (button.dataset.mapCommand === 'zoom-out') changeZoom(-1);
    else if (button.dataset.mapCommand === 'reset') reset();
  });

  stage.addEventListener('keydown', event => {
    if (event.target !== stage||!view) return;
    if (event.key === '+' || event.key === '=') changeZoom(1);
    else if (event.key === '-') changeZoom(-1);
    else if (event.key === 'Home') reset();
    else {
      const vector={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
      if (!vector) return;
      moved=true;
      paint({...view,x:view.x+vector[0]*frame.width*.15/frame.scale,y:view.y+vector[1]*frame.height*.15/frame.scale});
    }
    event.preventDefault();
  });

  stage.addEventListener('pointerdown', event => {
    if (!view||event.button!==0||event.target.closest('button')) return;
    suppressLineClick=false;
    pointer={id:event.pointerId,clientX:event.clientX,clientY:event.clientY,...view,scale:frame.scale,dragged:false};
    stage.setPointerCapture(event.pointerId);
    stage.setAttribute('data-dragging','');
  });
  stage.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer?.id) return;
    const dx=event.clientX-pointer.clientX,dy=event.clientY-pointer.clientY;
    if (!pointer.dragged&&Math.hypot(dx,dy)<5) return;
    pointer.dragged=true;
    moved=true;
    nextDrag={zoom:pointer.zoom,x:pointer.x-dx/pointer.scale,y:pointer.y-dy/pointer.scale};
    if (!dragFrame) dragFrame=requestAnimationFrame(()=>{
      dragFrame=0;
      paint(nextDrag);
    });
  });
  stage.addEventListener('lostpointercapture', () => {
    suppressLineClick=Boolean(pointer?.dragged);
    pointer=undefined;
    stage.removeAttribute('data-dragging');
  });
  fitViewport();
  const observer=new ResizeObserver(()=>{
    if (map.isConnected) fitViewport();
    else observer.disconnect();
  });
  observer.observe(stage);
}
