import {mkdir, rename, rm, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {profile} from '../itinerary.js';
import {reverseSegments} from '../return-route.js';
import {scopeChpSegments} from '../sources.js';

const sourceUrl = 'https://quickmap.dot.ca.gov/data/chp-only.kml';
const maximumAge = 15 * 60_000;
const maximumBytes = 8 * 1024 * 1024;

function validateKml(text) {
  const structuralText = text.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const expectedDocument = /^\s*(?:<\?xml[^>]*\?>\s*)?<kml\b[^>]*>\s*<Document\b[^>]*>\s*<name>CHP Incidents<\/name>\s*[\s\S]*?<\/Document>\s*<\/kml>\s*$/i;
  const standardStyle = /<Style\s+id=["']chp["']/i;
  const fullClosureStyle = /<Style\s+id=["']full-closure["']/i;
  if (!expectedDocument.test(structuralText) || !standardStyle.test(structuralText) || !fullClosureStyle.test(structuralText)) {
    throw new Error('Expected a complete CHP incident KML document.');
  }

  const openings = [...structuralText.matchAll(/<Placemark\b/gi)].length;
  const closings = [...structuralText.matchAll(/<\/Placemark>/gi)].length;
  const placemarks = [...structuralText.matchAll(/<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi)];
  const point = /<Point\b[^>]*>\s*<coordinates>\s*-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?(?:,\s*-?\d+(?:\.\d+)?)?\s*<\/coordinates>\s*<\/Point>/i;
  const records = [...text.matchAll(/<description\b[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/description>/gi)];
  const hasIncidentFields = ([, body]) => /CHP Incident\s+[0-9A-Z]{8,22}\b/i.test(body) && /<h2\b[^>]*>[\s\S]+?<\/h2>/i.test(body)
    && /<p class="iw-text">[\s\S]+?<\/p>/i.test(body);
  if (openings !== placemarks.length || closings !== placemarks.length || records.length !== placemarks.length
    || placemarks.some(([, body]) => !point.test(body)) || !records.every(hasIncidentFields)) {
    throw new Error('CHP KML contains an incomplete incident placemark.');
  }
  const withoutStyles = structuralText.replace(/<Style\b[^>]*>[\s\S]*?<\/Style>/gi, '');
  const emptyDocument = /^\s*(?:<\?xml[^>]*\?>\s*)?<kml\b[^>]*>\s*<Document\b[^>]*>\s*<name>CHP Incidents<\/name>\s*<\/Document>\s*<\/kml>\s*$/i;
  if (!openings && !emptyDocument.test(withoutStyles)) throw new Error('CHP KML empty document did not match the official feed shape.');
}

export async function collectChpSnapshot() {
  const response = await fetch(sourceUrl, {signal:AbortSignal.timeout(12_000),redirect:'error',
    headers:{Accept:'application/vnd.google-earth.kml+xml, application/xml, text/xml','Cache-Control':'no-cache'}});
  if (!response.ok || !/^(?:application\/(?:vnd\.google-earth\.kml\+xml|xml)|text\/xml)\b/i.test(response.headers.get('content-type') ?? '')) {
    throw new Error(`CHP source returned an unexpected response (HTTP ${response.status}).`);
  }
  if (Number(response.headers.get('content-length')) > maximumBytes) throw new Error('CHP KML exceeded the expected size.');
  const text = await response.text();
  if (Buffer.byteLength(text) > maximumBytes) throw new Error('CHP KML exceeded the expected size.');
  validateKml(text);

  const fetched = Date.now();
  const sourceUpdated = Date.parse(response.headers.get('last-modified'));
  if (!Number.isFinite(sourceUpdated) || fetched - sourceUpdated > maximumAge || sourceUpdated - fetched > 60_000) {
    throw new Error('CHP KML has a missing, stale, or future source timestamp.');
  }
  const fetchedAt = new Date(fetched).toISOString();
  const sourceUpdatedAt = new Date(sourceUpdated).toISOString();
  const feed = {text,fetchedAt,sourceUpdatedAt};
  return {schema:1,fetchedAt,sourceUpdatedAt,outbound:scopeChpSegments(profile.segments,feed),
    return:scopeChpSegments(reverseSegments(profile.segments),feed)};
}

async function writeSnapshot(filename) {
  const snapshot = await collectChpSnapshot();
  const target = resolve(filename);
  const temp = `${target}.${randomUUID()}.tmp`;
  await mkdir(dirname(target),{recursive:true});
  try {
    await writeFile(temp, `${JSON.stringify(snapshot)}\n`, {flag:'wx'});
    await rename(temp,target);
  } finally {
    await rm(temp,{force:true});
  }
  const count = segments => segments.reduce((total,segment) => total + segment.events.length,0);
  console.log(`CHP source ${snapshot.sourceUpdatedAt}: ${count(snapshot.outbound)} outbound reports, ${count(snapshot.return)} return reports.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) {
    console.error('Usage: node scripts/refresh-chp.mjs <output.json>');
    process.exitCode = 1;
  } else {
    try {
      await writeSnapshot(process.argv[2]);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
