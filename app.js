import {loadDashboard, refreshDashboard} from './page-data.js?v=4';
import {bestSnow, dateKey, localDays, quant, valid} from './forecast.js';
import {renderRouteTowns} from './route-towns-view.js';
import {bindRoadMap, roadMap} from './road-map.js?v=3';
import {roadDirection, roadEventText, roadLocation, roadSource} from './road-locale.js';
import {reverseSegments} from './return-route.js';

const $ = id => document.getElementById(id);
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const quickMap = 'https://quickmap.dot.ca.gov/';
const chp = 'https://cad.chp.ca.gov/';
const resortCams = 'https://dodgeridge.com/webcams/';
const stateRoute = 'https://roads.dot.ca.gov/roadscell.php?roadnumber=';
const snowRatioProduct = 'https://www.weather.gov/media/notification/pdf_2023_24/pns22-10_snow_ratio_grids_aab.pdf';
const readPref = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const writePref = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Display preferences are optional. */ } };
let language = readPref('ski-pages-language','zh') === 'en' ? 'en' : 'zh';
let imperial = readPref('ski-pages-units','metric') === 'imperial';
let state = null;
let busy = false;
let loadFailed = false;
let triedRefresh = false;
let point = 'base';
let roadView = location.hash === '#return-roads' ? 'return-roads' : 'roads';
const selectedRoad = {roads:-1,'return-roads':-1};
const tr = (zh,en) => language === 'en' ? en : zh;
const mdash = () => tr('暂无数据','No data');
const zone = () => state?.profile?.timeZone || 'America/Los_Angeles';
const localDate = () => dateKey(Date.now(), zone());
const amount = (value,type,compact=false) => h(quant(value,type,imperial,language,compact));
const empty = value => `<div class="empty">${h(value)}</div>`;
const heading = value => `<div class="section-head section-heading"><h2>${h(value)}</h2></div>`;

function link(label, url) {
  try {
    const address = new URL(url);
    if (address.protocol === 'https:' && !address.username && !address.password) return `<a href="${h(address.href)}" target="_blank" rel="noopener noreferrer">${h(label)}</a>`;
  } catch { /* Missing or unsupported link. */ }
  return h(label);
}

function timeLabel(value, options = {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  const time = new Date(value);
  const text = new Intl.DateTimeFormat(tr('zh-CN','en-US'),{timeZone:zone(),...options}).format(time);
  return `<time datetime="${time.toISOString()}">${h(text)}</time>`;
}

function stale(snapshot, maxHours) {
  const saved = Date.parse(snapshot?.savedAt ?? snapshot?.data?.fetchedAt);
  return snapshot?.stale === true || !Number.isFinite(saved) || Date.now() - saved > maxHours * 3600000;
}

function stamps(snapshot,maxHours) {
  if (!snapshot) return '';
  const fetched = timeLabel(snapshot.savedAt ?? snapshot.data?.fetchedAt);
  const updated = timeLabel(snapshot.data?.updatedAt);
  const parts = [
    snapshot.data && stale(snapshot,maxHours) ? `<span class="badge stale">${tr('旧快照','Stale snapshot')}</span>` : '',
    snapshot.data?.source ? link(snapshot.data.source,snapshot.data.sourceUrl) : '',
    updated ? `${h(snapshot.data?.timestampKind==='retrieved' ? tr('来源抓取','Source retrieved') : tr('来源更新','Source updated'))} ${updated}` : '',
    fetched && fetched !== updated ? `${tr('看板抓取','Dashboard fetched')} ${fetched}` : '',
    snapshot.error ? tr('部分更新失败','Some updates failed') : '',
  ].filter(Boolean);
  return parts.length ? `<p class="muted source-line">${parts.join(' · ')}</p>` : '';
}

const eventKinds = () => ({closure:tr('封闭','Closure'), restriction:tr('管制','Restriction'), accident:tr('事故','Incident'),
  construction:tr('施工','Roadwork'), advisory:tr('通报','Advisory'), storm:tr('风暴警告','Storm warning'), snow:tr('沿途降雪','En-route snowfall'),
  checked:tr('已核对','Sources checked')});

const eventOrder = {closure:0,restriction:1,storm:2,accident:3,snow:4,construction:5,advisory:6,checked:7};
const eventIsActive = event => {
  const starts = Date.parse(event.startsAt ?? event.start);
  const ends = Date.parse(event.endsAt ?? event.end);
  return event.active !== false && (!Number.isFinite(starts) || starts <= Date.now()) && (!Number.isFinite(ends) || ends > Date.now());
};
function eventRow(event, includeDescription=false) {
  const {title,description,direction} = roadEventText(event,language);
  const source = event.source ? link(roadSource(event.source,language),event.sourceUrl) : '';
  const lastChange = timeLabel(event.updatedAt);
  const checked = timeLabel(event.verifiedAt ?? event.checkedAt);
  const parts = [source,lastChange ? `${event.timestampKind==='feed-retrieved' ? tr('来源抓取','Source retrieved') : tr('来源更新','Source updated')} ${lastChange}` : '',
    checked && checked !== lastChange ? `${tr('核对','Checked')} ${checked}` : '',
    event.noticeUrl ? link(tr('Caltrans 官方原文','Original Caltrans notice'),event.noticeUrl) : '',
    event.checkpointUrl ? link(tr('QuickMap 检查点','QuickMap checkpoint'),event.checkpointUrl) : ''].filter(Boolean);
  const label = [eventKinds()[event.kind],event.highway,title,event.level,direction].filter(Boolean).join(' · ');
  const hasDescription = description && description !== title;
  const originalOnly = language === 'zh' && hasDescription && description === event.description && /[a-z]/i.test(description) && !/\p{Script=Han}/u.test(description);
  const original = language === 'zh' && includeDescription && (originalOnly || title !== (event.title ?? '') || description !== (event.description ?? '') || direction !== (event.direction ?? ''))
    ? `<details><summary>查看英文原文</summary><p lang="en">${h([event.title,event.direction,event.description === event.title ? '' : event.description].filter(Boolean).join(' · '))}</p></details>` : '';
  return `<li class="road-event ${event.kind==='closure'?'road-closure':''}"><strong>${h(label)}${valid(event.snowfall)?` · ${amount(event.snowfall,'snow')}`:''}</strong>${includeDescription && hasDescription && !originalOnly ? `<p>${h(description)}</p>` : ''}${original}${parts.length?`<small>${parts.join(' · ')}</small>`:''}</li>`;
}

function renderHeader() {
  document.documentElement.lang = tr('zh-Hans','en');
  document.title = tr('滑雪后勤 · Dodge Ridge','Ski logistics · Dodge Ridge');
  for (const node of document.querySelectorAll('[data-zh][data-en]')) node.textContent = tr(node.dataset.zh,node.dataset.en);
  $('sectionNav').setAttribute('aria-label',tr('导航','Navigation'));
  $('verdict').setAttribute('aria-label',tr('出发判决','Departure verdict'));
  $('roads').setAttribute('aria-label',tr('去程路况','Outbound roads'));
  $('return-roads').setAttribute('aria-label',tr('回程路况','Return roads'));
  $('weather').setAttribute('aria-label',tr('天气与降雪','Weather & snow'));
  $('closeForecast').setAttribute('aria-label',tr('关闭','Close'));
  $('language').textContent = tr('EN','中文');
  $('language').setAttribute('aria-label',tr('Switch to English','切换为中文'));
  $('units').textContent = imperial ? '°F' : '°C';
  $('units').setAttribute('aria-label',imperial ? tr('切换为公制','Use metric units') : tr('切换为英制','Use imperial units'));
  $('refresh').disabled = busy;
  $('refresh').textContent = busy ? tr('刷新中…','Refreshing…') : tr('刷新','Refresh');
  const status = state?.refreshStatus;
  const statusCode = typeof status === 'string' ? status : status?.status;
  const partial = status?.partial || statusCode === 'partial';
  $('headerStatus').textContent = busy ? tr('正在读取公开数据','Checking public sources') :
    loadFailed ? tr('更新失败，保留已有数据','Update failed. Existing data retained.') :
    statusCode === 'unavailable' ? tr('公开数据暂不可用','Public data currently unavailable') :
    partial ? tr('部分来源已刷新','Some sources refreshed') :
    statusCode === 'cached' ? tr('已读取公开快照','Public snapshot loaded') :
    statusCode === 'live' || triedRefresh ? tr('已完成刷新，时间见各数据源','Refresh complete. See source times.') : '';
  $('sourceCredit').innerHTML = `${tr('数据来源','Data sources')} · ${link('Open-Meteo','https://open-meteo.com/')} (${link('CC BY 4.0','https://creativecommons.org/licenses/by/4.0/')}, ${tr('进行了汇总与单位转换','aggregated and converted')}) · ${link('NWS','https://www.weather.gov/')} · ${link('Caltrans QuickMap',quickMap)} · ${link('CHP',chp)}`;
}

function renderVerdict() {
  const verdict = state?.verdict;
  const roadsMissing = !state?.roads?.data;
  const roadStale = !roadsMissing && stale(state.roads,.75);
  const original = verdict?.status;
  const activeSevereStorm = (verdict?.evidence ?? []).some(event=>event.kind === 'storm' && /blizzard warning|snow squall warning|ice storm warning/i.test(event.title) && eventIsActive(event));
  const adjusted = (roadsMissing || roadStale) && (original === 'go' || original === 'stop' && !activeSevereStorm);
  const status = adjusted ? 'caution' : original ?? 'setup';
  const labels = {go:tr('可以出发','Go'),caution:tr('谨慎出发','Use caution'),stop:tr('不建议出发','Do not depart'),setup:tr('出发判决暂无数据','Departure verdict unavailable')};
  const gaps = [];
  if (roadStale) gaps.push(tr('路况快照已过期，出门前请刷新并核对官方通报。','The road snapshot is stale. Refresh and check official notices before leaving.'));
  if (roadsMissing) gaps.push(tr('实时路况暂无数据。','Live road conditions are unavailable.'));
  const districts=(verdict?.chainDistricts??[]).join(', ');
  const knownGaps = {
    roads:tr('部分去程路况来源尚未核实。','Some outbound road sources remain unverified.'),
    roadsMissing:tr('实时路况暂无数据。','Live road conditions are unavailable.'),
    roadsStale:tr('路况快照已过期。','The road snapshot is stale.'),
    roadsCoverage:tr('部分路况来源暂无覆盖。','Some road sources have incomplete coverage.'),
    roadsFetch:tr('部分路况来源未能刷新。','Some road sources did not refresh.'),
    roadCoverage:tr('部分路况来源暂无覆盖。','Some road sources have incomplete coverage.'),
    roadChainNotPublished:tr(`Caltrans 第 ${districts} 区未发布链条检查点数据。`,`Caltrans district ${districts} does not publish chain-checkpoint data.`),
    roadsPartial:tr('部分路况来源未能核对，详情见路况板块。','Some road sources could not be checked. See the road conditions section.'),
    routeWeather:tr('沿途天气来自抽样点，公路其余区间的天气可能不同。','Weather is sampled at points along the route. Conditions between them may differ.'),
    routeScope:tr('去程覆盖主干公路。','Monitoring covers outbound main highways.'),
  };
  for (const issue of verdict?.uncertain ?? []) if (knownGaps[issue] && !gaps.includes(knownGaps[issue]) && !(issue === 'roads' && (roadsMissing || roadStale))) gaps.push(knownGaps[issue]);
  const evidence = (verdict?.evidence ?? []).filter(event => event?.kind !== 'checked').slice().sort((a,b) => (eventOrder[a.kind]??10)-(eventOrder[b.kind]??10));
  $('verdict').dataset.status = status;
  $('verdict').innerHTML = `<div class="verdict-content"><p class="eyebrow">${tr('去程 · 出发判决','Outbound · Departure')}</p><h1>${h(labels[status] ?? labels.setup)}</h1><p class="trip-line">Santa Clara → Dodge Ridge</p><p>${link('Caltrans QuickMap',quickMap)} · ${link(tr('CA-108 官方原文','Official CA-108 notice'),`${stateRoute}108`)}</p></div><div class="verdict-evidence">${stamps(state?.roads,.75)}${gaps.length?`<ul class="gap-list">${gaps.map(value=>`<li>${h(value)}</li>`).join('')}</ul>`:''}${evidence.length?`<ul class="evidence-list public-evidence">${evidence.map(event=>eventRow(event)).join('')}</ul>`:''}</div>`;
}

function roadNotice(highway) {
  const number = /^(?:I|CA|US|SR)[ -]?(\d{1,3})$/i.exec(String(highway ?? '').trim())?.[1];
  return number ? link(tr('公路全线官方通报','Official full-highway bulletin'),`${stateRoute}${Number(number)}`) : '';
}

const segmentName = segment => [segment.highway,[segment.start,segment.end].filter(Boolean).map(value=>roadLocation(value,language)).join(' → ')].filter(Boolean).join(' · ');
function cameraLink(camera) {
  return link(roadLocation(camera.title,language) || tr('沿途摄像头','Road camera'),camera.officialUrl || `${quickMap}?layers=cctv`);
}

function chainSummary(segments,snapshot,current,returning) {
  const heading=`<h3>${tr('链条管制','Traction controls')}</h3>`;
  const id = returning ? 'returnChainSummary' : 'roadChainSummary';
  if(!snapshot?.data) return `<div class="panel" id="${id}">${heading}${stamps(snapshot,.75)}${empty(tr('点右上角「刷新」获取链条检查点。','Tap Refresh to load chain checkpoints.'))}</div>`;
  const districts=[...new Set(segments.filter(s=>s.coverage?.chainControls==='notPublished').map(s=>s.district).filter(Boolean))].join(', ');
  const groups=new Map();
  for(const s of segments) for(const event of s.events??[]) {
    if(event.kind!=='restriction'||!eventIsActive(event))continue;
    const key=JSON.stringify([s.highway,event.level,event.direction,event.noticeUrl]);
    const group=groups.get(key)??{highway:s.highway,level:event.level,direction:event.direction,notice:event.noticeUrl,checkpoints:new Map()};
    group.checkpoints.set(event.recordId??event.id??`${event.lat},${event.lon}`,event);
    groups.set(key,group);
  }
  const checks=[...groups.values()].map(({highway,level,direction,notice,checkpoints})=>{
    const count=checkpoints.size;
    const title=[highway,level,roadDirection(direction,language),tr(`${count} 个检查点`,`${count} checkpoint${count===1?'':'s'}`)].filter(Boolean).join(' · ');
    return `<details><summary>${h(title)}</summary>${notice?`<p>${link(tr('查看这条公路的 Caltrans 通报','Read the Caltrans highway bulletin'),notice)}</p>`:''}<div class="restriction-scroll" tabindex="0" role="region" aria-label="${tr('管制检查点','Traction checkpoints')}"><ul class="road-events">${[...checkpoints.values()].map(event=>eventRow({...event,noticeUrl:null},true)).join('')}</ul></div></details>`;
  }).join('');
  const available=segments.some(s=>s.coverage?.chainControls==='available');
  const gap=segments.some(s=>s.coverage?.chainControls==='unavailable'||!s.coverage);
  const noMatches=available?tr('已抓取的检查点中，未查到路线内的管制。','No restrictions were found in the fetched checkpoints along the route.'):
    tr('本次没有可显示的链条检查点记录。','No checkpoint records are available for this refresh.');
  return `<div class="panel" id="${id}">${heading}${!current?stamps(snapshot,.75):''}${checks||`<p>${h(noMatches)}</p>`}${districts?`<p class="muted source-line">${h(tr(`Caltrans 第 ${districts} 区没有发布公开链条检查点数据。`,`Caltrans does not publish a public chain-checkpoint feed for district ${districts}.`))} ${link(tr('查看发布范围','Check feed coverage'),'https://cwwp2.dot.ca.gov/documentation/cc/cc-district-reporting-matrix.html')}</p>`:''}${gap?`<p class="muted source-line">${tr('部分区段本次未能取得检查点数据。','Some checkpoint feeds were unavailable for this refresh.')} ${link('Caltrans QuickMap',quickMap)}</p>`:''}</div>`;
}

function renderRoadCard(segment) {
  const groups = kind => (segment.events ?? []).filter(event => event.kind === kind);
  const checks = groups('restriction');
  const closures = groups('closure');
  const incidents = groups('accident');
  const work = [...groups('construction'),...groups('advisory')];
  const chainAvailable = segment.coverage?.chainControls === 'available' || (!segment.coverage && segment.status === 'ok');
  const chainText = segment.coverage?.chainControls === 'notPublished' ? tr('本区未发布检查点数据','District does not publish checkpoint data') : chainAvailable ? tr('未查到已发布管制','No posted restrictions found') : mdash();
  const incidentsKnown = segment.coverage?.incidents === 'available';
  const cameras = segment.cameras ?? [];
  const official = [roadNotice(segment.highway),link('Caltrans QuickMap',quickMap),link(tr('CHP 实时事故','CHP incidents'),chp)].filter(Boolean);
  return `<article class="panel route-card"><h3>${h(segmentName(segment))}</h3>
    ${segment.direction?`<p class="muted">${h(roadDirection(segment.direction,language))}</p>`:''}
    <p class="muted source-line">${official.join(' · ')}${segment.updatedAt?` · ${tr('抓取','Fetched')} ${timeLabel(segment.updatedAt)}`:''}</p>
    ${closures.length?`<ul class="road-events">${closures.map(event=>eventRow(event,true)).join('')}</ul>`:''}
    ${checks.length?`<details><summary>${tr('链条管制','Traction control')} · ${h([...new Set(checks.map(item=>item.level).filter(Boolean))].join(' / '))} · ${checks.length}</summary><ul class="road-events">${checks.map(event=>eventRow(event,true)).join('')}</ul></details>`:`<p>${tr('链条管制','Traction control')} · ${h(chainText)}</p>`}
    <details><summary>${tr('实时事故','Incidents')} · ${incidents.length || (incidentsKnown ? '0' : h(mdash()))}</summary>${incidents.length?`<ul class="road-events">${incidents.map(event=>eventRow(event,true)).join('')}</ul>`:`<p>${incidentsKnown ? tr('未查到区间内事故通报','No matching incident reports') : `${h(mdash())} · ${link(tr('打开 CHP 原站核对','Check the CHP site'),chp)}`}</p>`}</details>
    ${work.length?`<details><summary>${tr('施工与通报','Roadwork and advisories')} · ${work.length}</summary><ul class="road-events">${work.map(event=>eventRow(event,true)).join('')}</ul></details>`:''}
    ${cameras.length?`<details><summary>${tr('沿途摄像头','Road cameras')} · ${cameras.length}</summary><ul class="camera-list">${cameras.map(camera=>`<li>${cameraLink(camera)}${camera.updatedAt?` <small>· ${timeLabel(camera.updatedAt)}</small>`:''}</li>`).join('')}</ul></details>`:`<p class="muted">${tr('沿途摄像头','Road cameras')} · ${h(mdash())}</p>`}
  </article>`;
}

function renderRoads() {
  const id = roadView;
  const returning = id === 'return-roads';
  const root = $(id);
  $('roads').hidden = returning;
  $('return-roads').hidden = !returning;
  for (const name of Object.keys(selectedRoad)) {
    const tab = $('sectionNav').querySelector(`a[href="#${name}"]`);
    if (name === id) tab.setAttribute('aria-current','location');
    else tab.removeAttribute('aria-current');
  }
  const snapshot = returning ? state?.returnRoads : state?.roads;
  const reported = snapshot?.data?.segments ?? [];
  const outbound = state?.profile?.segments ?? [];
  const configured = returning ? reverseSegments(outbound) : outbound;
  const key = segment => JSON.stringify([segment.highway,segment.start,segment.end,segment.direction]);
  const reports = new Map(reported.map(segment=>[key(segment),segment]));
  const segments = configured.length ? configured.map(segment=>reports.get(key(segment)) ?? segment) : reported;
  const current = !stale(snapshot,.75);
  const closureEvents = segments.flatMap(segment=>(segment.events ?? []).filter(event=>event.kind==='closure' && eventIsActive(event)).map(event=>({...event,highway:segment.highway})));
  const allChecked = current && segments.length && segments.every(segment=>segment.coverage?.closures==='available' || segment.status==='ok');
  const closureLabel = allChecked ? tr('未查到监控区间内的全封闭通报','No full closures found on the monitored segments') : mdash();
  const map = roadMap(configured,segments,language);
  const title = returning ? tr('回程路况','Return road conditions') : tr('去程路况','Outbound road conditions');
  const corridor = returning ? tr('Dodge Ridge → Santa Clara · 沿同一主干公路范围反向核对。匝道与地方道路没有独立监控。','Dodge Ridge → Santa Clara · The same main highway sections are checked in reverse. Ramps and local roads have no separate coverage.') : 'Santa Clara → Dodge Ridge';
  const scope = returning ? tr('CA‑108 回程从 Pinecrest Lake Road 交汇处向西监控。Caltrans 公路通报覆盖全线。','The CA‑108 return check runs west from Pinecrest Lake Road. Caltrans highway bulletins cover the full highway.') : tr('CA‑108 监控到 Pinecrest Lake Road 转弯口为止。Caltrans 公路通报覆盖全线。','CA‑108 monitoring ends at the Pinecrest Lake Road turnoff. Caltrans highway bulletins cover the full highway.');
  root.innerHTML = `<div class="section-head section-heading"><div><h2>${h(title)}</h2><p class="muted">${h(corridor)}</p></div></div><div class="panel closure-panel"><h3>${current?tr('当前封闭','Current closures'):tr('封闭通报','Closure notices')}</h3>${stamps(snapshot,.75)}${closureEvents.length?`<ul class="road-events">${closureEvents.map(event=>eventRow(event,true)).join('')}</ul>`:empty(closureLabel)}<div class="actions">${link('Caltrans QuickMap',quickMap)} ${link(tr('CHP 实时事故','CHP live incidents'),chp)} ${link(tr('CA-108 官方通报','Official CA-108 bulletin'),`${stateRoute}108`)}</div></div>${chainSummary(segments,snapshot,current,returning)}<div class="panel">${map}</div><div id="${returning?'returnMapRoadCard':'mapRoadCard'}" class="map-road-card" role="region" aria-label="${h(tr('所选路段','Selected segment'))}" hidden></div>${segments.length?`<details class="panel public-road-list"><summary>${tr('全部监控路段','All monitored segments')} <span>${segments.length}</span></summary>${segments.map(renderRoadCard).join('')}</details>`:empty(tr('暂无监控路段','No monitored segments are available'))}<div class="panel"><p>${tr('车速与拥堵','Traffic speed and congestion')} · ${h(mdash())}</p><p class="muted source-line">${h(scope)}</p></div>`;
  const card = root.querySelector('.map-road-card');
  const select = index => {
    selectedRoad[id] = index;
    const segment = segments[index];
    card.hidden = !segment;
    card.innerHTML = segment ? renderRoadCard(segment) : '';
  };
  select(selectedRoad[id]);
  root.querySelector('[data-road-map]')?.addEventListener('roadsegmentselect',event=>select(event.detail.index));
  bindRoadMap(root);
}

function dayLabel(date) {
  return h(new Intl.DateTimeFormat(tr('zh-CN','en-US'),{timeZone:'UTC',weekday:'short',month:'numeric',day:'numeric'}).format(new Date(`${date}T12:00:00Z`)));
}

const pointName = id => id==='summit' ? tr('雪场山顶','Resort summit') : tr('雪场山脚','Resort base');
const table = (labels, rows) => `<div class="table-wrap" tabindex="0"><table class="data-table forecast"><thead><tr>${labels.map(value=>`<th scope="col">${h(value)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((value,i)=>i?`<td>${value}</td>`:`<th scope="row">${value}</th>`).join('')}</tr>`).join('')}</tbody></table></div>`;
function forecastDays(id) {
  return localDays((state?.weather?.[id]?.data?.hourly ?? []).filter(row=>Number.isFinite(Date.parse(row.time))),zone(),localDate());
}

function renderWeather() {
  const snapshot = state?.weather?.[point];
  const forecast = forecastDays(point);
  const data = snapshot?.data;
  const best = bestSnow(forecast);
  const total = forecast.every(day=>valid(day.snow)) ? forecast.reduce((sum,day)=>sum+day.snow,0) : null;
  const points = ['base','summit'].map(id=>{
    const view = state?.weather?.[id];
    const row = view?.data?.hourly?.find(item=>Date.parse(item.time)>=Date.now());
    return `<button type="button" class="panel card weather-point public-forecast-point" data-forecast-point="${id}" aria-pressed="${id===point}"><span>${pointName(id)}</span><strong>${amount(row?.temp,'temp')}</strong><small>${row ? `${tr('体感','Feels like')} ${amount(row.feels,'temp')} · ${timeLabel(row.time,{hour:'2-digit',minute:'2-digit'})}` : h(mdash())}${view?.data && stale(view,26) ? ` · ${tr('旧快照','Stale')}` : ''}</small></button>`;
  }).join('');
  const forecastTable = data ? table([tr('日期','Day'),tr('最高','High'),tr('最低','Low'),tr('最高体感','Feels high'),tr('最低体感','Feels low'),tr('降雪','Snow'),tr('最大风速','Max wind')],
    forecast.map(day=>[`<button type="button" class="text-button public-forecast-day" data-forecast-day="${day.date}">${dayLabel(day.date)}</button>${day===best?` <span class="badge">${tr('降雪最多','Most snow')}</span>`:''}`,amount(day.hi,'temp',true),amount(day.lo,'temp',true),amount(day.feelsHi,'temp',true),amount(day.feelsLo,'temp',true),amount(day.snow,'snow',true),amount(day.wind,'wind',true)])) : empty(tr('该点暂无预报。','No forecast is available for this point.'));
  const discrepancies = (data?.discrepancies ?? []).map(item=>`<li>${timeLabel(item.start)} – ${timeLabel(item.end)} · ${link('NWS',item.sourceUrl)} ${amount(item.nws,'snow')} (${timeLabel(item.updatedAt) || h(mdash())}) · ${link('Open-Meteo',item.otherSourceUrl)} ${amount(item.openMeteo,'snow')} (${timeLabel(item.otherUpdatedAt) || h(mdash())})</li>`);
  const townSnapshot = state?.routeTowns;
  const townView = townSnapshot && renderRouteTowns({...townSnapshot,stale:stale(townSnapshot,26)},{language,imperial,timeZone:zone(),now:Date.now()});
  $('weather').innerHTML = `${heading(tr('天气与降雪','Weather & snow'))}<div class="grid weather-points">${points}</div><div class="panel"><h3>${pointName(point)} · ${tr('未来 7 天','Next 7 days')}</h3>${stamps(snapshot,26)}<div class="stats"><div><span>${tr('7 天累计降雪','7-day snowfall')}</span><strong>${amount(total,'snow')}</strong></div><div><span>${tr('预计降雪最多','Snowiest day')}</span><strong>${best?dayLabel(best.date):h(mdash())}</strong></div></div>${forecastTable}${discrepancies.length?`<details><summary>${tr('来源间降雪数据有分歧','Sources disagree about snowfall')}</summary><ul>${discrepancies.join('')}</ul></details>`:''}<div class="actions">${link(tr('雪场官方摄像头','Official resort webcams'),resortCams)} ${link(tr('雪场运营状态','Official resort status'),'https://dodgeridge.com/snow-report/')} ${link(tr('NWS 雪水比说明','NWS snow ratio product'),snowRatioProduct)}</div></div>${townView || ''}`;
}

function openForecast(date) {
  const day = forecastDays(point).find(item=>item.date===date);
  if (!day) return;
  const rowWidth = {hour:'2-digit',minute:'2-digit',timeZoneName:'short'};
  $('forecastTitle').textContent = `${pointName(point)} · ${date}`;
  $('forecastBody').innerHTML = stamps(state?.weather?.[point],26)+(day.rows.length ? table([tr('时间','Time'),tr('气温','Temp'),tr('体感','Feels like'),tr('降雪','Snow'),tr('降雨','Rain'),tr('风速','Wind'),tr('阵风','Gust'),tr('雪线','Snow level'),tr('雪水比','Snow ratio')],day.rows.map(row=>[timeLabel(row.time,rowWidth),amount(row.temp,'temp',true),amount(row.feels,'temp',true),amount(row.snow,'snow',true),amount(row.rain,'rain',true),amount(row.wind,'wind',true),amount(row.gust,'wind',true),amount(row.snowLevel,'height',true),amount(row.snowRatio,'ratio',true)])) : empty(mdash()));
  $('forecastDialog').showModal();
}

function render() { renderHeader(); renderVerdict(); renderRoads(); renderWeather(); }

async function update(manual=false) {
  if (busy) return;
  busy = true;
  loadFailed = false;
  renderHeader();
  try {
    const next = await (manual ? refreshDashboard() : loadDashboard());
    if (!next || !next.profile) throw new Error('Dashboard data unavailable');
    state = next;
  } catch {
    loadFailed = true;
  } finally {
    triedRefresh ||= manual;
    busy = false;
    render();
  }
}

$('language').addEventListener('click',()=>{language = tr('en','zh');writePref('ski-pages-language',language);render();});
$('units').addEventListener('click',()=>{imperial = !imperial;writePref('ski-pages-units',imperial?'imperial':'metric');renderHeader();renderVerdict();renderWeather();});
$('refresh').addEventListener('click',()=>update(true));
function scrollToRoadView() {
  if (location.hash === `#${roadView}`) $(roadView).scrollIntoView();
}
window.addEventListener('hashchange',()=>{
  const next = location.hash.slice(1);
  if (!Object.hasOwn(selectedRoad,next) || next === roadView) return;
  roadView = next;
  renderRoads();
  requestAnimationFrame(scrollToRoadView);
});
$('weather').addEventListener('click',event=>{
  const button = event.target.closest('button');
  if (button?.dataset.forecastPoint) {
    point = button.dataset.forecastPoint;
    renderWeather();
    $('weather').querySelector(`[data-forecast-point="${point}"]`)?.focus();
  } else if (button?.dataset.forecastDay) openForecast(button.dataset.forecastDay);
});
update().then(scrollToRoadView);
