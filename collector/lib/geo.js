// Géocodage des communes avec OpenStreetMap (Nominatim), mis en cache dans geocache.json.
// Règle Nominatim : au plus une requête par seconde, avec un User-Agent identifiable.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(DIR, '..', 'geocache.json');
let cache = {};
try {
  cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
} catch {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;

const PROV_BY_STATE = { 'Liège': 'lg', 'Lüttich': 'lg', 'Luik': 'lg', 'Luxembourg': 'lx', 'Luxemburg': 'lx' };

/** Province déduite du code postal belge : 4000–4999 Liège, 6600–6999 Luxembourg. */
export function provFromPostal(postal) {
  const n = parseInt(postal, 10);
  if (n >= 4000 && n <= 4999) return 'lg';
  if (n >= 6600 && n <= 6999) return 'lx';
  if (n >= 1000 && n <= 9999) return 'autre';
  return null;
}

export async function geocode(town, postal, offline = false) {
  const key = `${postal || ''}|${(town || '').toLowerCase()}`.trim();
  if (!town && !postal) return null;
  if (cache[key]) return cache[key];
  if (offline) return null;
  const wait = 1100 - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const q = new URLSearchParams({
    format: 'jsonv2',
    addressdetails: '1',
    limit: '1',
    countrycodes: 'be',
    q: [postal, town, 'Belgique'].filter(Boolean).join(' '),
  });
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${q}`, {
      headers: { 'User-Agent': 'AgendaSorties/1.0 (agenda personnel)' },
      signal: AbortSignal.timeout(15000),
    });
    const [hit] = await res.json();
    if (!hit) return (cache[key] = { miss: true });
    const a = hit.address || {};
    const state = a.province || a.state || '';
    const result = {
      lat: +(+hit.lat).toFixed(4),
      lng: +(+hit.lon).toFixed(4),
      town: a.village || a.town || a.city || a.municipality || town,
      prov: PROV_BY_STATE[state.replace(/^Province (de |du )?/i, '')] || provFromPostal(a.postcode) || 'autre',
    };
    cache[key] = result;
    return result;
  } catch {
    return null;
  }
}

export function saveGeoCache() {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));
}

export function distanceKm(a, b) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
