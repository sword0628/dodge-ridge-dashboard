import {dateKey, forecastLength, quant, shift, valid} from './forecast.js?v=10';

const h = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
}[character]));

const weatherSymbols = {clear:'☀️', cloudy:'☁️', rain:'🌧️', snow:'❄️', mix:'🌨️', fog:'🌫️', thunder:'⛈️'};

function sourceLink(name, url) {
  try {
    const source = new URL(url);
    if (source.protocol === 'https:' && !source.username && !source.password) {
      return `<a href="${h(source.href)}" target="_blank" rel="noopener noreferrer">${h(name)}</a>`;
    }
  } catch { /* An unverified URL is displayed only as a source name. */ }
  return h(name);
}

const style = `<style>
.route-towns-panel {min-width:0}
.route-towns-panel .table-wrap {max-width:100%;overflow-x:auto}
.route-towns-panel .table-wrap table {min-width:43rem}
.route-towns-panel .table-wrap th:first-child {position:sticky;left:0;z-index:1;border-right:1px solid var(--line)}
.route-towns-panel th[data-horizon=extended] {background:#e7eeeb}
.route-towns-panel [data-range-start] {border-inline-start:2px solid #a4b8ad}
.route-towns-panel th[scope=row] {min-width:7.5rem;max-width:14rem;white-space:normal;overflow-wrap:anywhere}
.route-towns-panel td {white-space:nowrap}
.route-towns-panel td small {display:block;color:var(--muted)}
.route-towns-panel .town-weather-symbol {display:inline-block;margin-inline-end:.23em;font-size:.94em;line-height:1}
.route-towns-panel details li {font-size:.88rem;overflow-wrap:anywhere}
</style>`;

export function renderRouteTowns(snapshot, {language='zh', imperial=false, timeZone='America/Los_Angeles', now=Date.now()}={}) {
  const english = language === 'en';
  const tr = (zh,en) => english ? en : zh;
  const locale = english ? 'en-US' : 'zh-CN';
  const noData = tr('暂无数据','No data');
  const heading = tr(`沿途城镇 ${forecastLength} 天天气`,`${forecastLength}-day weather in towns along the route`);
  const conditions = {
    clear:tr('晴','Clear'), cloudy:tr('多云','Cloudy'), rain:tr('雨','Rain'), snow:tr('雪','Snow'),
    mix:tr('雨夹雪','Wintry mix'), fog:tr('雾','Fog'), thunder:tr('雷雨','Thunderstorms'), unknown:noData,
  };

  let dateFormatter;
  try {
    dateFormatter = new Intl.DateTimeFormat(locale,{timeZone,month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
  } catch {
    timeZone = 'UTC';
    dateFormatter = new Intl.DateTimeFormat(locale,{timeZone,month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
  }
  const current = new Date(now);
  const today = dateKey(Number.isFinite(current.valueOf()) ? current : Date.now(),timeZone);
  const dates = Array.from({length:forecastLength},(_,index) => shift(today,index));
  const dayFormatter = new Intl.DateTimeFormat(locale,{timeZone:'UTC',weekday:'short',month:'numeric',day:'numeric'});
  const sourceTime = value => {
    if (!value || !Number.isFinite(Date.parse(value))) return '';
    const stamp = new Date(value);
    return `<time datetime="${stamp.toISOString()}">${h(dateFormatter.format(stamp))}</time>`;
  };

  const isTown = value => value && typeof value === 'object' && typeof value.name === 'string' && value.name.trim() !== '';
  const data = Array.isArray(snapshot?.data?.towns) ? snapshot.data.towns.filter(isTown) : [];
  const towns = new Map(data.map(item => [item.id,item]));
  const configured = Array.isArray(snapshot?.places) ? snapshot.places.filter(isTown) : data;
  const places = configured.map(place => ({name:place.id==='dodge-ridge-base'?tr('Dodge Ridge 山脚','Dodge Ridge base'):place.name, forecast:towns.get(place.id)}));
  const introduction = `${style}<section class="panel route-towns-panel" aria-labelledby="route-towns-heading"><h3 id="route-towns-heading">${heading}</h3>`;
  if (!places.length) return `${introduction}<div class="empty">${tr('暂无沿途城镇预报。','No forecasts for towns along the route.')}</div></section>`;

  const saved = sourceTime(snapshot?.savedAt);
  const retry = sourceTime(snapshot?.retryAt);
  const status = [snapshot?.stale && data.length ? `<span class="badge stale">${tr('旧快照','Stale snapshot')}</span>` : '',
    saved ? `${tr('看板抓取','Fetched')} ${saved}` : '',
    snapshot?.error ? retry ? `${tr('抓取失败，预计可重试','Fetch failed. Retry after')} ${retry}` : tr('抓取失败','Fetch failed') : ''].filter(Boolean);
  const period=snapshot?.data?.period;
  const hours=data.length&&!(period?.startHour===7&&period?.endHour===19)
    ?tr('整天的天气和最高／最低气温','All-day weather and high / low temperature')
    :tr('当地时间 07:00–19:00 的天气和最高／最低气温','Weather and high / low temperature from 07:00–19:00 local time');

  const headers = dates.map((date,index) => `<th scope="col"${index>=7?' data-horizon="extended" aria-describedby="route-towns-horizon"':''}${index===7?' data-range-start':''}><time datetime="${date}">${h(dayFormatter.format(new Date(`${date}T12:00:00Z`)))}</time></th>`).join('');
  const rows = places.map(({name,forecast}) => {
    const rows = Array.isArray(forecast?.days) ? forecast.days : [];
    const days = new Map(rows.filter(day => day?.date).map(day => [day.date,day]));
    const cells = dates.map((date,index) => {
      const day = days.get(date);
      const boundary = index===7?' data-range-start':'';
      if (!day) return `<td class="muted"${boundary}>${noData}</td>`;
      const hasTemperature = valid(day.high) || valid(day.low);
      const condition = Object.hasOwn(conditions,day.condition) ? conditions[day.condition] : noData;
      const symbol = Object.hasOwn(weatherSymbols,day.condition) ? `<span class="town-weather-symbol" aria-hidden="true">${weatherSymbols[day.condition]}</span>` : '';
      const title = day.sourceText ? ` title="${h(day.sourceText)}"` : '';
      const high = quant(day.high,'temp',imperial,language,true);
      const low = quant(day.low,'temp',imperial,language,true);
      return `<td${title}${boundary}>${symbol}${h(condition)}${hasTemperature?`<small>${h(high)} / ${h(low)}</small>`:''}</td>`;
    }).join('');
    return `<tr><th scope="row">${h(name)}</th>${cells}</tr>`;
  }).join('');

  const provenance = places.map(({name,forecast}) => {
    const updated = sourceTime(forecast?.updatedAt);
    const fetched = sourceTime(forecast?.fetchedAt);
    const times = [updated ? `${tr('来源更新','Source updated')} ${updated}` : '',
      fetched ? `${tr('抓取','Fetched')} ${fetched}` : ''].filter(Boolean);
    const source = forecast?.source || forecast?.sourceUrl ? sourceLink(forecast.source || tr('预报来源','Forecast source'),forecast.sourceUrl) : '';
    return `<li><strong>${h(name)}</strong> · ${[source,...times].filter(Boolean).join(' · ') || noData}</li>`;
  }).join('');

  return `${introduction}
    ${status.length ? `<p class="muted source-line">${status.join(' · ')}</p>` : ''}
    <p class="muted source-line" id="route-towns-units">${hours} · ${imperial?'°F':'°C'}</p>
    <p class="muted source-line" id="route-towns-horizon">${tr(`左右滑动查看全部日期。第 8–${forecastLength} 天预报变数较大。`,`Scroll sideways to see every date. Forecasts for days 8–${forecastLength} are more uncertain.`)}</p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="route-towns-heading" aria-describedby="route-towns-units route-towns-horizon">
      <table class="data-table forecast" aria-labelledby="route-towns-heading"><thead><tr><th scope="col">${tr('城镇','Town')}</th>${headers}</tr></thead><tbody>${rows}</tbody></table>
    </div>
    <details><summary>${tr('各城镇预报来源与时间','Sources and timestamps by town')}</summary><ul>${provenance}</ul></details>
  </section>`;
}
