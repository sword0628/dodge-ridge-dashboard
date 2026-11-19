const directions = {
  n: '北向', nb: '北向', north: '北向', northbound: '北向',
  s: '南向', sb: '南向', south: '南向', southbound: '南向',
  e: '东向', eb: '东向', east: '东向', eastbound: '东向',
  w: '西向', wb: '西向', west: '西向', westbound: '西向',
  both: '双向', 'both directions': '双向', 'all directions': '所有方向',
};

const locations = {
  'e long barn': 'Long Barn 东侧',
  'east long barn': 'Long Barn 东侧',
  'little sweden': 'Little Sweden 检查点',
  'lyons dam scale': 'Lyons Dam 称重站',
  'sonora junction': 'Sonora 交汇处',
  'pinecrest lake rd turnoff': 'Pinecrest Lake Road 转弯口',
  'pinecrest lake road turnoff': 'Pinecrest Lake Road 转弯口',
  'dodge ridge mountain resort': 'Dodge Ridge 雪场',
};

const closureTypes = {
  full: '全封闭', lane: '车道封闭', moving: '移动施工管制',
  'one-way traffic': '单向交替通行', 'alternating lanes': '交替封闭车道',
  shoulder: '路肩封闭',
};

const facilities = {
  mainline: '主线', freeway: '高速公路', 'conventional hwy': '普通公路',
  expressway: '快速路', 'surface street': '地面道路', 'rest area': '休息区',
  'on ramp': '入口匝道', 'off ramp': '出口匝道', connector: '连接道', 'both ramps': '出入口匝道',
};

const workTypes = {
  'highway construction': '公路施工', 'striping operation': '道路标线施工',
  'guardrail work': '护栏施工', 'drainage work': '排水设施施工', 'rest area work': '休息区施工',
  'utility work': '公用设施施工', 'shoulder work': '路肩施工', 'concrete pour': '混凝土浇筑',
  'its/various electrical works': '智能交通系统及电气施工', 'pavement repair': '路面修补',
  'roadway excavation': '道路开挖', 'pavement work': '路面施工', 'utility potholing': '地下设施探挖',
  'k-rail removal/repair': '混凝土隔离设施拆除或维修', 'sweeping operation': '道路清扫',
  'tree work': '树木养护', 'drainage cleaning/inspection': '排水设施清理或检查',
  'river overflow/flood area': '河水漫溢或淹水区', 'sign/banner work': '标牌或横幅施工',
  'bridge work': '桥梁施工', 'emergency work': '紧急抢修', 'emergency repair': '紧急抢修',
};

const weatherAlerts = {
  'winter storm warning': '冬季风暴警报', 'winter storm watch': '冬季风暴监视',
  'blizzard warning': '暴风雪警报', 'blizzard watch': '暴风雪监视',
  'ice storm warning': '冰暴警报', 'snow squall warning': '突发强阵雪警报',
  'winter weather advisory': '冬季天气提醒', 'freezing rain advisory': '冻雨提醒',
  'high wind warning': '强风警报', 'high wind watch': '强风监视', 'wind advisory': '大风提醒',
  'freeze warning': '冰冻警报', 'frost advisory': '霜冻提醒', 'lake effect snow warning': '湖效应降雪警报',
};

const incidentTypes = {
  'trfc collision-no inj': '交通碰撞（通报无人员受伤）',
  'trfc collision-unk inj': '交通碰撞（伤情未明）',
  'trfc collision-major inj': '交通碰撞（有人重伤）',
  'trfc collision-minor inj': '交通碰撞（有人轻伤）',
  'trfc collision w/inj': '交通碰撞（有人员受伤）',
  'traffic hazard': '道路危险',
  'traffic break': '临时拦停车流',
  'roadway flooding': '路面积水',
  'road closed': '道路封闭',
};

const sources = {
  'caltrans quickmap · cc': 'Caltrans QuickMap · 链条检查点',
  'caltrans quickmap · lcs': 'Caltrans QuickMap · 道路施工与封闭',
  'caltrans cctv': 'Caltrans 道路摄像头',
  'chp · caltrans quickmap': '加州公路巡警（CHP）· Caltrans QuickMap',
};

// Match the feed wording, including exceptions. A level alone cannot identify local variations.
const notices = {
  'no chain controls are in effect at this time.': '目前没有链条管制。',
  'closed to traffic.': '道路禁止通行。',
  'chains are required on all vehicles except passenger vehicles and light-duty trucks under 6,000 pounds gross weight and equipped with snow tires on at least two drive wheels. chains must be carried by vehicles using snow tires. all vehicles towing trailers must have chains on one drive axle. trailers with brakes must have chains on at least one axle.':
    '车辆须安装防滑链。总重低于 6,000 磅且至少两个驱动轮装有雪地胎的乘用车和轻型卡车可免装，但仍须随车携带防滑链。牵引拖车的车辆须在一根驱动轴上装链，有制动器的拖车也须至少在一根车轴上装链。',
  'chains or traction devices are required on all vehicles except four wheel / all wheel drive vehicles with snow-tread tires on all four wheels. four wheel / all wheel drive vehicles must carry traction devices in chain control areas.':
    '除四驱或全轮驱动车辆且四个车轮均装有符合要求的雪地胎外，所有车辆须安装防滑链或防滑装置。四驱或全轮驱动车辆在管制区内仍须随车携带防滑装置。',
  'chains or traction devices are required on all vehicles, no exceptions.':
    '所有车辆均须安装防滑链或防滑装置，无例外。',
};

const key = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const term = (dict, value) => {
  const normalized = key(value);
  return Object.hasOwn(dict, normalized) ? dict[normalized] : value ?? '';
};

export function roadDirection(value, language) {
  if (language === 'en' || !value) return value ?? '';
  return value.split(/(\s*[/&,]\s*|\s+and\s+)/i).map((part, index) => index % 2 ? ' / ' : term(directions, part)).join('');
}

export function roadLocation(value, language) {
  if (language === 'en' || !value) return value ?? '';
  const label = term(locations, value);
  if (label !== value) return label;
  return value.replace(/^((?:\d+\s*-\s*)?)([NSEW]B)\b\s*/i, (_, prefix, direction) => `${prefix}${roadDirection(direction, language)} `)
    .replace(/\b([NSEW])\/O\s+(.+)$/i, (_, direction, place) => `${place} ${{N: '以北', S: '以南', E: '以东', W: '以西'}[direction.toUpperCase()]}`)
    .replace(/^Little Sweden\s+(R\d+(?:\.\d+)?)$/i, (_, postmile) => `Little Sweden 检查点 ${postmile}`)
    .replace(/\b((?:I|CA|US|SR)[ -]?\d{1,4}) ([NSEW])\b/g, (_, route, direction) => `${route} ${roadDirection(direction, language)}`)
    .replace(/\bExit (\d+[A-Z]?)\b/gi, (_, exit) => `${exit} 号出口`)
    .replace(/\bmerge ramp\b/gi, '汇入匝道')
    .replace(/\bmerge\b/gi, '汇入点')
    .replace(/\bfork\b/gi, '分岔口')
    .replace(/\bboundary\b/gi, '分界线')
    .replace(/\bramp\b/gi, '匝道')
    .replace(/\bUnder-Crossing\b/gi, '下穿道')
    .replace(/\bOver-Crossing\b/gi, '上跨桥')
    .replace(/\bturnoff\b/gi, '转弯口')
    .replace(/\binterchange\b/gi, '互通立交')
    .replace(/\bjunction\b/gi, '交汇处');
}

export function roadSource(value, language) {
  return language === 'en' ? value ?? '' : term(sources, value);
}

export function roadEventText(event, language) {
  const original = {title: event.title ?? '', description: event.description ?? '', direction: event.direction ?? ''};
  if (language === 'en') return original;
  let {title, description} = original;
  if (/^lcs-/.test(event.id ?? '') || /\blcs\b/i.test(event.source ?? '')) {
    const [type, facility] = title.split(' · ');
    title = [term(closureTypes, type), term(facilities, facility)].filter(Boolean).join(' · ');
    const [work, ...places] = description.split(' · ');
    description = [term(workTypes, work), ...places.map(place => roadLocation(place, language))].filter(Boolean).join(' · ');
  } else if (event.kind === 'storm') {
    title = term(weatherAlerts, title);
  } else if (/^chp/i.test(event.source ?? '')) {
    const [, code, label] = /^(?:(\d+[A-Z]?)\s*-\s*)?(.+)$/i.exec(title) ?? [];
    const translated = term(incidentTypes, label);
    if (label && translated !== label) title = [code, translated].filter(Boolean).join(' · ');
    description = roadLocation(description, language);
  } else {
    title = roadLocation(title, language);
    description = term(notices, description);
  }
  return {title, description, direction: roadDirection(original.direction, language)};
}
