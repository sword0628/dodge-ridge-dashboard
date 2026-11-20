export const forecastLength = 16;
export const valid = Number.isFinite;
export const dateKey = (value,zone) => new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export const shift = (date,days) => new Date(Date.parse(`${date}T12:00:00Z`)+days*86400000).toISOString().slice(0,10);
export const weekDay = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
const scores = (rows,key,fn) => {
  const values=rows.map(r=>r[key]).filter(valid);
  return values.length ? fn(...values) : null;
};

export function daySummary(rows) {
  return {rows,hi:scores(rows,'temp',Math.max),lo:scores(rows,'temp',Math.min),
    feelsHi:scores(rows,'feels',Math.max),feelsLo:scores(rows,'feels',Math.min),wind:scores(rows,'wind',Math.max),gust:scores(rows,'gust',Math.max),
    snow:rows.length>=23&&rows.every(r=>valid(r.snow)) ? rows.reduce((sum,r)=>sum+r.snow,0) : null,
    rain:rows.some(r=>valid(r.rain)&&r.rain>0),snowing:rows.some(r=>valid(r.snow)&&r.snow>0),
    snowMin:scores(rows,'snowLevel',Math.min),snowMax:scores(rows,'snowLevel',Math.max),
    ratioMin:scores(rows,'snowRatio',Math.min),ratioMax:scores(rows,'snowRatio',Math.max)};
}

export function localDays(rows, zone, today) {
  const dates=new Map();
  for (const h of rows) {
    const date=dateKey(h.time,zone);
    if (!dates.has(date)) dates.set(date,[]);
    dates.get(date).push(h);
  }
  return Array.from({length:forecastLength},(_,i)=>{
    const date=shift(today,i);
    return {date,...daySummary(dates.get(date)??[])};
  });
}

export function quant(value, type, imperial, lang, compact=false) {
  if (!valid(value)) return compact?'—':lang==='en'?'No data':'暂无数据';
  const transforms={temp:[x=>x*1.8+32,'°F','°C',1],snow:[x=>x/2.54,'in','cm',2],
    rain:[x=>x/25.4,'in','mm',2],wind:[x=>x/1.609344,'mph','km/h',0],
    height:[x=>x/0.3048,'ft','m',0],ratio:[x=>x,':1',':1',1]};
  const [convert,us,si,precision]=transforms[type];
  const displayed=imperial?convert(value):value;
  const suffix=imperial?us:si;
  if (['snow','rain'].includes(type)&&displayed>0&&displayed<0.01) return `<0.01 ${suffix}`;
  const number=new Intl.NumberFormat(lang==='en'?'en-US':'zh-CN',{maximumFractionDigits:precision}).format(displayed);
  return type==='ratio'?`${number}${suffix}`:`${number} ${suffix}`;
}

export function bestSnow(days) {
  return [...days].filter(d=>valid(d.snow)&&d.snow>0).sort((a,b)=>b.snow-a.snow || (a.gust??Infinity)-(b.gust??Infinity))[0]??null;
}
