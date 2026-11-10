// Collecteur quotidien de l'Agenda des sorties.
// 1. lit les sources web   2. normalise   3. géocode   4. fusionne les doublons
// 5. écrit public/data/events.json, lu par l'appli.
//
// Usage : node index.js            (collecte complète)
//         node index.js --offline  (reconstruit le fichier à partir des relevés locaux)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES } from './sources/index.js';
import { clean, shortDesc, guessCategory, guessTags, parseTime, todayBrussels, addDays, slug } from './lib/util.js';
import { geocode, saveGeoCache, distanceKm, provFromPostal } from './lib/geo.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, '..', 'public', 'data', 'events.json');
const OFFLINE = process.argv.includes('--offline');
const TODAY = todayBrussels();
const HORIZON = addDays(TODAY, 120);
const CATS = ['brocante', 'marche', 'noel', 'soiree', 'concert', 'spectacle', 'fete', 'expo', 'balade', 'famille'];
const log = (...a) => console.log(...a);

function readSeed(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, 'seed', file), 'utf8')).events || [];
  } catch (e) {
    log(`! seed ${file} : ${e.message}`);
    return [];
  }
}

// ---------- 1. Relevés fixes ----------
const seeds = [
  ...readSeed('noel-2026.json').map((e) => ({ ...e, c: 'noel', seed: true })),
  ...readSeed('recurrents.json').map((e) => ({ ...e, seed: true })),
  ...fs
    .readdirSync(path.join(DIR, 'seed'))
    .filter((f) => /^releve-.*\.json$/.test(f))
    .flatMap((f) => readSeed(f).map((e) => ({ ...e, seed: true }))),
];

// ---------- 2. Sources web ----------
const report = [];
const raw = [];
if (!OFFLINE) {
  for (const s of SOURCES) {
    const t0 = Date.now();
    log(`→ ${s.name}`);
    try {
      const evs = await s.run(log);
      raw.push(...evs);
      report.push({ name: s.name, ok: true, count: evs.length, ms: Date.now() - t0 });
      log(`  ${evs.length} événements`);
    } catch (e) {
      report.push({ name: s.name, ok: false, error: String(e.message).slice(0, 200) });
      log(`  ✗ ${e.message}`);
    }
  }
}

// ---------- 3. Normalisation ----------
async function normalize(e) {
  const t = clean(e.t).replace(/\s*[-–|]\s*(quefaire|info-lux|brocabrac).*$/i, '');
  if (!t || !e.d1 || !/^\d{4}-\d{2}-\d{2}$/.test(e.d1)) return null;
  const d2 = e.d2 && e.d2 >= e.d1 ? e.d2 : e.d1;
  if (d2 < TODAY || e.d1 > HORIZON) return null;
  if (!e.seed && d2 > addDays(e.d1, 200)) return null; // « activités permanentes » : trop vagues

  let { lat, lng, prov, town } = e;
  if (lat == null || lng == null || !prov) {
    const g = await geocode(e.town, e.postal, OFFLINE);
    if (g && !g.miss) {
      lat ??= g.lat;
      lng ??= g.lng;
      prov ||= g.prov;
      town ||= g.town;
    }
  }
  if (!prov && e.postal) prov = provFromPostal(e.postal);
  if (lat == null) return null; // impossible de situer l'événement
  // Hors des deux provinces : on ne garde que les marchés de Noël.
  const c = CATS.includes(e.c) ? e.c : guessCategory(e.rawCat, t, e.rawDesc);
  if (!['lg', 'lx'].includes(prov) && c !== 'noel') return null;

  const desc = e.desc || shortDesc(e.rawDesc || '', 150);
  const tm = e.tm || parseTime(e.h) || null;
  let h = e.h || null;
  if (!h && tm) h = e.tmEnd ? `${tm.replace(':', 'h')} – ${e.tmEnd.replace(':', 'h')}` : `Dès ${tm.replace(':', 'h').replace('h00', 'h')}`;

  return {
    t,
    c,
    d1: e.d1,
    d2,
    ...(e.wd ? { wd: e.wd } : {}),
    ...(e.wdFrom ? { wdFrom: e.wdFrom } : {}),
    ...(e.wdNth ? { wdNth: e.wdNth } : {}),
    ...(tm ? { tm } : {}),
    ...(h ? { h } : {}),
    town: clean(town || e.town),
    prov,
    lat: +(+lat).toFixed(4),
    lng: +(+lng).toFixed(4),
    free: e.free ?? null,
    ...(e.price ? { price: e.price } : {}),
    desc,
    tags: e.tags || guessTags(t, e.rawDesc, e.fullText, e.rawCat),
    ...(e.x ? { x: e.x } : {}),
    ...(e.unconfirmed ? { unconfirmed: true } : {}),
    src: [e.src],
    url: e.url || null,
  };
}

const normalized = [];
for (const e of [...raw, ...seeds]) {
  const n = await normalize(e);
  if (n) normalized.push(n);
}
saveGeoCache();

// ---------- 4. Fusion des doublons ----------
// Même titre (début), dates qui se chevauchent, et lieux à moins de 3 km : un seul événement.
function sameEvent(a, b) {
  const ka = slug(a.t).slice(0, 28);
  const kb = slug(b.t).slice(0, 28);
  const titleMatch = ka === kb || (ka.length > 12 && (ka.includes(kb) || kb.includes(ka)));
  return titleMatch && a.d1 <= b.d2 && b.d1 <= a.d2 && distanceKm(a, b) < 3;
}
const merged = [];
for (const e of normalized) {
  const twin = merged.find((m) => sameEvent(m, e));
  if (!twin) {
    merged.push(e);
    continue;
  }
  for (const k of ['tm', 'h', 'price', 'x', 'url']) if (!twin[k] && e[k]) twin[k] = e[k];
  if (twin.free == null) twin.free = e.free;
  if ((e.desc || '').length > (twin.desc || '').length) twin.desc = e.desc;
  twin.tags = [...new Set([...twin.tags, ...e.tags])];
  twin.src = [...new Set([...twin.src, ...e.src])];
}

merged.sort((a, b) => a.d1.localeCompare(b.d1) || (a.tm || '99').localeCompare(b.tm || '99'));
// Identifiant stable d'un jour à l'autre (les favoris en dépendent).
const usedIds = new Set();
for (const e of merged) {
  let id = `${slug(e.t).slice(0, 32)}-${slug(e.town).slice(0, 12)}-${e.d1}`;
  for (let n = 2; usedIds.has(id); n++) id = id.replace(/~\d+$/, '') + '~' + n;
  usedIds.add(id);
  e.id = id;
}

// ---------- 5. Écriture ----------
const payload = {
  generated: new Date().toISOString(),
  today: TODAY,
  home: { name: 'Fléron', lat: 50.615, lng: 5.684 },
  sources: report,
  count: merged.length,
  events: merged,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload));
log(`✓ ${merged.length} événements écrits dans public/data/events.json`);

// Si toutes les sources web ont échoué, on le signale (l'appli garde les données de la veille).
if (!OFFLINE && report.length && report.every((r) => !r.ok)) {
  console.error('Toutes les sources ont échoué');
  process.exitCode = 1;
}
