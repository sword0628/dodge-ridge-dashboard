// Public place labels for the California route. Incorporated places and CDPs
// use the Census TIGERweb interior points, rounded to four decimal places.
// https://tigerweb.geo.census.gov/tigerwebmain/Files/acs26/tigerweb_acs26_incplace_ca.html
// https://tigerweb.geo.census.gov/tigerwebmain/Files/acs26/tigerweb_acs26_cdp_ca.html
// Pinecrest is a USGS GNIS populated place (feature 1659782).
// https://edits.nationalmap.gov/apps/gaz-domestic/public/search/names/1659782
// Dodge Ridge uses its public base-area reference point.
// https://dodgeridge.com/trail-maps/
// Sugar Pine uses the Caltrans point on CA-108 in Tuolumne County.
// https://cwwp2.dot.ca.gov/data/d10/cc/ccStatusD10.json
export const sierraRouteTowns = [
  {id:'mono-vista',name:'Mono Vista',lat:38.0134,lon:-120.2700},
  {id:'twain-harte',name:'Twain Harte',lat:38.0369,lon:-120.2339},
  {id:'sugar-pine',name:'Sugar Pine',lat:38.0616,lon:-120.1993},
  {id:'mi-wuk-village',name:'Mi-Wuk Village',lat:38.0577,lon:-120.1767},
  {id:'sierra-village',name:'Sierra Village',lat:38.0756,lon:-120.1593},
  {id:'long-barn',name:'Long Barn',lat:38.0933,lon:-120.1347},
  {id:'cold-springs',name:'Cold Springs',lat:38.1613,lon:-120.0535},
];

export const routeLandmarks = [
  {id:'santa-clara',name:'Santa Clara',lat:37.3646,lon:-121.9680,priority:1},
  {id:'milpitas',name:'Milpitas',lat:37.4331,lon:-121.8909,priority:2},
  {id:'fremont',name:'Fremont',lat:37.4947,lon:-121.9411,priority:1},
  {id:'sunol',name:'Sunol',lat:37.5859,lon:-121.8805,priority:2},
  {id:'livermore',name:'Livermore',lat:37.6870,lon:-121.7598,priority:1},
  {id:'tracy',name:'Tracy',lat:37.7274,lon:-121.4522,priority:1},
  {id:'manteca',name:'Manteca',lat:37.7928,lon:-121.2261,priority:1},
  {id:'escalon',name:'Escalon',lat:37.7914,lon:-120.9997,priority:2},
  {id:'oakdale',name:'Oakdale',lat:37.7617,lon:-120.8464,priority:1},
  {id:'jamestown',name:'Jamestown',lat:37.9555,lon:-120.4091,priority:2},
  {id:'sonora',name:'Sonora',lat:37.9817,lon:-120.3828,priority:1},
  ...sierraRouteTowns.map(town=>({...town,priority:2})),
  {id:'pinecrest',name:'Pinecrest',lat:38.1885,lon:-119.9908,priority:1},
  {id:'dodge-ridge',name:'Dodge Ridge',lat:38.1901,lon:-119.9570,priority:1},
];
