// Outils communs : téléchargement poli, dates, catégories, texte.

const UA = 'AgendaSorties/1.0 (agenda personnel, 1 passage par jour)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastFetch = 0;

/** Télécharge une page en respectant ~1,5 s entre deux requêtes. */
export async function fetchText(url, { retries = 2 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const wait = 1500 - (Date.now() - lastFetch);
    if (wait > 0) await sleep(wait);
    lastFetch = Date.now();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'fr-BE,fr;q=0.9' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === retries) throw new Error(`${url} : ${err.message}`);
      await sleep(3000 * (attempt + 1));
    }
  }
}

// ---------- Dates ----------
export const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function todayBrussels() {
  const s = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' });
  return s; // AAAA-MM-JJ
}
export function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return iso(d);
}

const MONTHS = {
  janvier: 1, janv: 1, jan: 1, février: 2, fevrier: 2, févr: 2, fev: 2, fév: 2, mars: 3, mar: 3,
  avril: 4, avr: 4, mai: 5, juin: 6, juillet: 7, juil: 7, août: 8, aout: 8, aoû: 8,
  septembre: 9, sept: 9, sep: 9, octobre: 10, oct: 10, novembre: 11, nov: 11, décembre: 12,
  decembre: 12, déc: 12, dec: 12,
};

/**
 * Lit une date française libre (« Dimanche 15 novembre », « 15 nov. 2026 », « 15/11/2026 »)
 * et renvoie AAAA-MM-JJ. Sans année : l'année qui place la date dans les 10 prochains mois.
 */
export function parseFrDate(text, refIso = todayBrussels()) {
  if (!text) return null;
  const t = text.toLowerCase().replace(/\s+/g, ' ');
  let m = t.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${y}-${pad(+m[2])}-${pad(+m[1])}`;
  }
  m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/(\d{1,2})(?:er)?\s+([a-zéèûô]+)\.?(?:\s+(\d{4}))?/);
  if (m && MONTHS[m[2]]) {
    const month = MONTHS[m[2]];
    const ref = new Date(refIso + 'T12:00:00');
    let y = m[3] ? +m[3] : ref.getFullYear();
    if (!m[3]) {
      const cand = new Date(`${y}-${pad(month)}-${pad(+m[1])}T12:00:00`);
      if (cand - ref < -60 * 86400000) y += 1; // plus de 2 mois dans le passé → année suivante
    }
    return `${y}-${pad(month)}-${pad(+m[1])}`;
  }
  return null;
}

/** Extrait une heure de début « 20h30 », « 20:30 », « dès 21h » → « 20:30 ». */
export function parseTime(text) {
  if (!text) return null;
  const m = String(text).match(/(\d{1,2})\s*[h:]\s*(\d{2})?/i);
  if (!m) return null;
  const h = +m[1];
  if (h > 23) return null;
  return `${pad(h)}:${m[2] || '00'}`;
}

// ---------- Catégories ----------
// Clés internes : brocante, marche, noel, soiree, concert, spectacle, fete, expo, balade, famille
const CAT_RULES = [
  ['noel', /no[eë]l|christmas|weihnacht|kerst|kr[eë]schtmoart|saint[- ]nicolas|nikolaus/i],
  ['brocante', /brocante|puces|vide[- ]grenier|bourse (aux|de|toutes)|collection|antiquit|braderie/i],
  ['marche', /march[ée]s? (de|du|des|aux|nocturnes?|fermiers?|artisanal|villageois|hebdomadaire)|\bmarch[ée]\b(?! adeps)(?=.*(producteur|terroir|artisan))|march[é]|terroir|salon|foire|artisan/i],
  ['soiree', /afterwork|after[- ]work|ap[ée]ro|soir[ée]e|party|night|dj|karaok|th[ée] dansant|bal\b|blind ?test|quiz/i],
  ['concert', /concert|rock|pop|jazz|blues|showcase|chorale|musique|festival|electro|rap/i],
  ['spectacle', /th[ée][aâ]tre|spectacle|com[ée]die|humour|stand[- ]up|impro|cirque|danse|op[ée]ra|cin[ée]ma|conte/i],
  ['expo', /expo|mus[ée]e|art|patrimoine|photo|conf[ée]rence|histoire|science|visite/i],
  ['fete', /f[êe]te|kermesse|carnaval|folklore|cort[èe]ge|ducasse|animation|halloween|souper|barbecue/i],
  ['balade', /marche|balade|randonn|adeps|v[ée]lo|jogging|course|trail|sport|nature|promenade/i],
  ['famille', /enfant|jouet|famil|kids|pu[ée]riculture|atelier/i],
];

export function guessCategory(...texts) {
  const s = texts.filter(Boolean).join(' ');
  for (const [cat, re] of CAT_RULES) if (re.test(s)) return cat;
  return 'fete';
}

export function guessTags(...texts) {
  const s = texts.filter(Boolean).join(' ').toLowerCase();
  const tags = new Set();
  if (/enfant|famil|kids|jeune public|\b\d+ ?ans\b|\+ ?\d/.test(s)) tags.add('enfants');
  if (/plein air|ext[ée]rieur|en rue|parc|march[ée] |balade|marche adeps/.test(s)) tags.add('exterieur');
  if (/salle|int[ée]rieur|th[ée][aâ]tre|mus[ée]e|centre culturel|chapiteau/.test(s)) tags.add('interieur');
  if (/r[ée]servation|r[ée]server|sur inscription|inscription obligatoire|billet/.test(s)) tags.add('reservation');
  if (/pmr|accessible|chaise roulante/.test(s)) tags.add('accessible');
  return [...tags];
}

export const clean = (s) => (s || '').replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();

/** Résumé d'une ligne, en coupant proprement sur un mot. */
export function shortDesc(s, max = 140) {
  s = clean(s);
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:.\-–]+$/, '') + '…';
}

export function slug(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
