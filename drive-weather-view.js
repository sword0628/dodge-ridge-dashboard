import {quant} from './forecast.js?v=10';
import {upcomingDriveDates} from './drive-weather.js?v=10';
import {roadEventText} from './road-locale.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
}[c]));

function officialLink(label, value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) {
      return `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
    }
  } catch { /* Display the source label even when a link is unavailable. */ }
  return escapeHtml(label);
}

function guidance(tr) {
  const levels = [
    ['R1',tr('通常须装链。总重低于 6,000 磅的乘用车和轻型卡车，至少两个驱动轮装有雪地胎时可免装，但须携带链条。牵引拖车另有要求。','Passenger cars and light trucks below 6,000 lb may qualify for an exemption if at least two drive wheels have snow tires. They must carry chains. Towing has separate requirements.')],
    ['R2',tr('四驱或全驱车辆的四个车轮均装雪地胎时可免装，但须携带防滑装置。其他车辆须安装。','Four-wheel and all-wheel drive vehicles with snow-tread tires on all four wheels may proceed without installing devices but must carry them. Other vehicles must install devices.')],
    ['R3',tr('所有车辆均须安装防滑装置。','Every vehicle must install traction devices.')],
  ];
  return `<details class="drive-weather-guidance"><summary>${tr('冬季行车与官方管制等级','Winter driving and official chain levels')}</summary>
    <p>${tr('链条等级和封路以 Caltrans、CHP 与现场人员指示为准。出发前核对最新公告。','Caltrans, CHP, and posted instructions determine chain levels and closures. Check current notices before leaving.')}</p>
    <dl class="drive-chain-levels">${levels.map(([level,text])=>`<div><dt>${level}</dt><dd>${text}</dd></div>`).join('')}</dl>
    <p>${tr('Caltrans 的封路指南看积雪是否黏在路面、现场是否还能安全通行。官方指南没有一条以预报降雪英寸数自动装链或封路的统一门槛。','Caltrans considers whether snow sticks and whether road conditions allow safe travel. Its guidance gives no universal forecast snowfall amount that automatically triggers chains or closures.')}</p>
    <p>${tr('看板把冻雨、清晨降雪达到 1 英寸、夜间降雪达到 2 英寸且清晨达冰点、强阵风、低能见度、雷暴或适用的 NWS 警报标为天气高风险。','This dashboard flags freezing precipitation, at least 1 in of morning snow, at least 2 in overnight with freezing morning temperatures, strong gusts, poor visibility, thunderstorms, or an applicable NWS warning as high weather risk.')}</p>
    <div class="actions">${officialLink(tr('Caltrans 链条规则','Caltrans chain rules'),'https://dot.ca.gov/travel/winter-driving-tips/chain-controls')} ${officialLink(tr('Caltrans 降雪与封路指南','Caltrans snow and closure guidance'),'https://dot.ca.gov/-/media/dot-media/programs/traffic-operations/documents/trafficops/202506-tom-ch-130-traffic-incident-management-a11y.pdf#page=39')} ${officialLink(tr('CHP 冬季驾驶','CHP winter driving'),'https://www.chp.ca.gov/programs-services/services-information/winter-driving-tips')} ${officialLink(tr('NWS 天气简报','NWS weather briefing'),'https://www.weather.gov/sto/briefing')} ${officialLink('Caltrans QuickMap','https://quickmap.dot.ca.gov/')}</div>
  </details>`;
}

export function renderDriveWeather(outlook, {language='zh', imperial=false, selectedDate, now=Date.now(), timeZone='America/Los_Angeles'}={}) {
  const en = language === 'en';
  const tr = (zh,english) => en ? english : zh;
  const locale = tr('zh-CN','en-US');
  const risk = {
    low:tr('天气影响较低','Lower weather impact'), caution:tr('谨慎驾驶','Use caution'), high:tr('天气风险高','High weather risk'), unknown:tr('资料不足','Insufficient data'),
  };
  const wind45 = imperial?'45 mph':'≈72.4 km/h';
  const wind30 = imperial?'30 mph':'≈48.3 km/h';
  const visibility = imperial?tr('¼ 英里','¼ mile'):tr('约 402 米','about 402 m');
  const rain = imperial?tr('¼ 英寸','¼ in'):tr('6.35 毫米','6.35 mm');
  const reasonLabels = {
    freezingPrecip:tr('预计有冻性降水','Freezing precipitation expected'),
    heavySnow:tr('清晨降雪至少 1 英寸','At least 1 in of morning snow'),
    heavyOvernightSnow:tr('前一夜降雪至少 2 英寸，清晨达冰点','At least 2 in overnight and a freezing morning'),
    strongGusts:tr(`阵风达 ${wind45}`,`Gusts reach ${wind45}`),
    poorVisibility:tr(`能见度低于或等于${visibility}`,`Visibility is ${visibility} or less`),
    snow:tr('清晨有新雪','Morning snowfall'), overnightSnow:tr('前一夜有降雪','Overnight snowfall'),
    ice:tr('有路面结冰可能','Possible road ice'), freezing:tr('清晨在冰点或以下','At or below freezing in the morning'),
    gusts:tr(`阵风达 ${wind30}`,`Gusts reach ${wind30}`), fog:tr('有雾或能见度低','Fog or low visibility'),
    rain:tr(`降雨至少 ${rain}`,`At least ${rain} of rain`), thunder:tr('预计有雷暴','Thunderstorms expected'),
    missing:tr('部分逐小时预报缺失','Hourly forecasts are incomplete'), stale:tr('预报快照已过期','Forecast snapshot is stale'),
    weatherWarning:tr('沿途有 NWS 天气警报','NWS weather warning along the route'),
    weatherAdvisory:tr('沿途有 NWS 天气提醒','NWS weather advisory along the route'),
  };
  const riskKey = key => Object.hasOwn(risk,key) ? key : 'unknown';
  const tag = key => `<span class="drive-risk" data-risk="${riskKey(key)}">${risk[riskKey(key)]}</span>`;
  const reports = new Map((outlook?.days ?? []).map(day=>[day.date,day]));
  const instant = new Date(now).valueOf();
  const days = upcomingDriveDates(Number.isFinite(instant)?instant:Date.now(),timeZone).map(date=>
    reports.get(date) ?? {date,risk:'unknown',complete:false,towns:[],alerts:[],reasons:[]});
  const selected = days.find(day=>day.date===selectedDate) ?? days[0];
  const extended = days.indexOf(selected) >= 7;
  const weekday = new Intl.DateTimeFormat(locale,{weekday:'short',timeZone:'UTC'});
  const shortDate = new Intl.DateTimeFormat(locale,{month:'numeric',day:'numeric',timeZone:'UTC'});
  const fullDate = new Intl.DateTimeFormat(locale,{weekday:'long',month:'long',day:'numeric',timeZone:'UTC'});
  const fromDate = key => new Date(`${key}T12:00:00Z`);
  const stamp = new Intl.DateTimeFormat(locale,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short',timeZone});
  const periodStamp = new Intl.DateTimeFormat(locale,{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone});
  const time = (value, formatter=stamp) => {
    if (!value || !Number.isFinite(Date.parse(value))) return '';
    const parsed = new Date(value);
    return `<time datetime="${parsed.toISOString()}">${escapeHtml(formatter.format(parsed))}</time>`;
  };
  const reasonText = values => [...new Set((values ?? []).map(value=>Object.hasOwn(reasonLabels,value)?reasonLabels[value]:value).filter(Boolean))].map(escapeHtml).join(' · ');
  const snow = value => escapeHtml(quant(value,'snow',true,language,true));
  const temp = value => escapeHtml(quant(value,'temp',imperial,language,true));
  const dates = days.map((day,index)=>{
    const stamp = fromDate(day.date);
    const active = day.date===selected.date;
    return `<button type="button" data-drive-day="${day.date}"${index>=7?' data-horizon="extended" aria-describedby="drive-weather-horizon"':''} aria-pressed="${active}" aria-controls="drive-weather-status drive-weather-details"><span>${escapeHtml(weekday.format(stamp))}</span><time datetime="${day.date}">${escapeHtml(shortDate.format(stamp))}</time>${tag(day.risk)}</button>`;
  }).join('');

  const towns = (selected.towns ?? []).map(town=>{
    const key = riskKey(town.risk);
    const morning = town.morning;
    const reasons = reasonText(town.reasons);
    const updated = time(town.updatedAt);
    const fetched = time(town.fetchedAt);
    const originalPeriods = (morning?.nwsSnowPeriods ?? []).filter(period=>Number.isFinite(period.snowCm)&&Number.isFinite(Date.parse(period.startAt))&&Number.isFinite(Date.parse(period.endAt)));
    const periods = originalPeriods.map(period=>`<li>${time(period.startAt,periodStamp)} – ${time(period.endAt,periodStamp)} · ${snow(period.snowCm)}</li>`).join('');
    const source = [town.source || town.sourceUrl ? officialLink(town.source || tr('原始预报','Original forecast'),town.sourceUrl) : '',
      updated ? `${tr('来源更新','Source updated')} ${updated}` : '', fetched && fetched!==updated ? `${tr('采集','Collected')} ${fetched}` : ''].filter(Boolean).join(' · ');
    return `<li class="drive-weather-town" data-risk="${key}">
      <div class="drive-weather-town-head"><strong>${escapeHtml(town.name)}</strong>${tag(key)}</div>
      ${morning?`<dl class="drive-weather-metrics"><div><dt>${tr('清晨降雪','Early snow')}</dt><dd>${snow(morning.snowCm)}</dd></div><div><dt>${tr('前一夜降雪','Overnight snow')}</dt><dd>${snow(morning.overnightSnowCm)}</dd></div><div><dt>${tr('清晨最低气温','Morning low')}</dt><dd>${temp(morning.minTempC)}</dd></div></dl>`:`<p class="muted">${tr('暂无这两个时段的逐小时预报。','Hourly forecasts for these periods are unavailable.')}</p>`}
      ${morning&&town.complete===false&&!town.reasons?.includes('missing')?`<p class="muted">${tr('部分时段资料不完整。','Some hours have incomplete data.')}</p>`:''}
      ${periods?`<details class="drive-weather-nws-periods"><summary>${tr('NWS 原始 6 小时时段降雪','NWS original 6-hour snowfall periods')}</summary><ul>${periods}</ul></details>`:''}
      ${reasons?`<p class="drive-weather-reasons">${reasons}</p>`:''}${source?`<p class="muted drive-weather-source">${source}</p>`:''}
    </li>`;
  }).join('');
  const alerts = (selected.alerts ?? []).map(alert=>{
    const starts = time(alert.start);
    const ends = time(alert.end);
    const updated = time(alert.updatedAt);
    const span = [starts,ends].filter(Boolean).join(' – ');
    const title = roadEventText({...alert,kind:'storm'},language).title;
    return `<li>${officialLink(title || tr('NWS 官方警报','Official NWS alert'),alert.sourceUrl)}${span?` <small>${span}</small>`:''}${updated?` <small>· ${tr('更新','Updated')} ${updated}</small>`:''}</li>`;
  }).join('');
  const chosen = fromDate(selected.date);
  const basis = time(outlook?.basedOn);
  const dayReason = reasonText(selected.reasons);
  const concernedTowns = (selected.towns ?? []).filter(town=>town.risk==='high'||town.risk==='caution')
    .sort((a,b)=>Number(b.risk==='high')-Number(a.risk==='high') || (b.morning?.snowCm ?? 0)-(a.morning?.snowCm ?? 0));
  const focusTowns = concernedTowns.slice(0,3).map(town=>escapeHtml(town.name)).join(tr('、',', '));
  const otherTowns = concernedTowns.length>3 ? tr(`等 ${concernedTowns.length} 个点位`,` and ${concernedTowns.length-3} more`) : '';
  return `<section class="panel drive-weather" aria-labelledby="drive-weather-heading">
    <header class="drive-weather-head"><div><h3 id="drive-weather-heading">${tr(`早晨驾驶展望 · ${days.length} 天`,`Morning driving outlook · ${days.length} days`)}</h3><p class="muted">${tr('各点统一看加州当地 05:00–09:00，前一夜为 19:00–05:00。','All points use the same California time windows. Morning is 05:00–09:00 and the previous night is 19:00–05:00.')}</p></div>${outlook?.stale?`<span class="badge stale">${tr('旧快照','Stale snapshot')}</span>`:''}</header>
    <div id="drive-weather-status" class="drive-weather-selected" data-risk="${riskKey(selected.risk)}" aria-live="polite"><h4>${tr('05:00 出发','05:00 departure')} · ${risk[riskKey(selected.risk)]}</h4><p><time datetime="${selected.date}">${escapeHtml(fullDate.format(chosen))}</time>${extended?` <span class="drive-weather-long-range">${tr('远期展望','Long-range outlook')}</span>`:''}</p></div>
    <div class="drive-weather-dates" role="group" aria-label="${tr('选择出发日期','Choose a departure date')}">${dates}</div>
    ${days.length>7?`<p id="drive-weather-horizon" class="muted drive-weather-source">${tr(`虚线日期为第 8–${days.length} 天，预报变数较大。`,`Dashed dates are days 8–${days.length}. These forecasts are more uncertain.`)}</p>`:''}
    <div id="drive-weather-details" class="drive-weather-details">
      ${focusTowns?`<p class="drive-weather-focus"><strong>${tr('重点留意','Points to watch')}</strong> · ${focusTowns}${otherTowns}</p>`:''}
      ${dayReason?`<p class="drive-weather-reasons">${dayReason}</p>`:''}
      ${!selected.complete&&towns?`<p class="muted">${tr('部分点位或时段资料不完整。','Some locations or hours have incomplete data.')}</p>`:''}
      ${alerts?`<div class="drive-official-alerts"><h5>${tr('NWS 路线警报','NWS alerts along the route')}</h5><ul>${alerts}</ul></div>`:''}
      ${towns?`<details class="drive-weather-town-list"><summary>${tr(`沿途 ${selected.towns.length} 个点位详情`,`Details for ${selected.towns.length} route points`)}</summary><ul class="drive-weather-towns" aria-label="${tr('沿途各城镇清晨预报','Morning forecasts by town')}">${towns}</ul></details>`:`<p class="muted">${tr('这天暂无沿途逐小时预报。','No hourly forecast along the route for this day.')}</p>`}
    </div>
    <p class="muted drive-weather-source">${tr('05:00 出发风险是根据沿途点位预报作出的估计。雪量为预计新雪。实际路面和管制以官方通报及现场指示为准。','The 05:00 driving outlook is an estimate based on point forecasts along the route. Snow amounts show expected new snow. Check official reports and posted instructions for road conditions and controls.')}${basis?` · ${tr('预报采集于','Forecast collected')} ${basis}`:''}</p>
    ${guidance(tr)}
  </section>`;
}
