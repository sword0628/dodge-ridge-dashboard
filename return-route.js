const opposite = {N: 'S', S: 'N', E: 'W', W: 'E'};

const junctions = new Map([
  ['CA-237 E merge', 'CA-237 / Great America Parkway'],
  ['Exit 12 / Mission Blvd', 'I-880 / Mission Blvd'],
  ['Exit 21B / CA-84', 'I-680 / CA-84'],
  ['I-680 Exit 21B / Sunol', 'I-680 / CA-84 (Sunol)'],
  ['I-580 Stockton ramp', 'I-580 / CA-84 interchange'],
  ['I-205 E fork', 'I-580 / I-205 junction'],
  ['I-580 fork', 'I-205 / I-580 junction'],
  ['I-5 N merge', 'I-205 / I-5 junction'],
  ['I-205 E merge', 'I-5 / I-205 junction'],
  ['Exit 461 / CA-120 E', 'I-5 / CA-120 interchange'],
  ['I-5 Exit 461', 'CA-120 / I-5 interchange'],
  ['CA-120 E merge ramp', 'CA-99 / CA-120 interchange'],
  ['Exit 242 / Yosemite Ave', 'CA-99 / Yosemite Ave'],
  ['CA-99 Exit 242 / Yosemite Ave', 'CA-99 / Yosemite Ave'],
]);

function junction(label) {
  return junctions.get(label) ?? label?.replace(/\b((?:I|CA|US|SR)[ -]?\d+) [NSEW]\b/g, '$1');
}

function reverseGeometry(geometry) {
  if (Array.isArray(geometry)) return geometry.slice().reverse();
  if (Array.isArray(geometry?.coordinates)) return {...geometry, coordinates: geometry.coordinates.slice().reverse()};
  return geometry;
}

export function reverseSegments(segments) {
  return [...segments].reverse().map(segment => ({
    ...segment,
    start: junction(segment.end),
    end: junction(segment.start),
    startLat: segment.endLat,
    startLon: segment.endLon,
    endLat: segment.startLat,
    endLon: segment.startLon,
    postmileStart: segment.postmileEnd,
    postmileEnd: segment.postmileStart,
    direction: opposite[segment.direction] ?? segment.direction,
    geometry: reverseGeometry(segment.geometry),
    ...(segment.aliases && {aliases: segment.aliases.map(alias => ({...alias, direction: opposite[alias.direction] ?? alias.direction}))}),
  }));
}
