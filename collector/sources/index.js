// Liste des sources lues chaque nuit. Une source qui échoue n'empêche jamais les autres.
import { crawl, genericFallback } from '../lib/crawl.js';
import { fetchText, fetchTextWithCookies, brusselsParts, parseFrDate, parseTime, clean, pad, MONTHS } from '../lib/util.js';
import { extractJsonLdEvents } from '../lib/jsonld.js';
import * as cheerio from 'cheerio';

/** quefaire.be — l'agenda le plus complet pour les deux provinces. */
async function quefaire(log) {
  const out = [];
  for (const [prov, path] of [['lg', 'province-de-liege'], ['lx', 'province-de-luxembourg']]) {
    // date=1 aujourd'hui · 2 demain · 7 ce week-end · sans paramètre : la sélection courante
    const listUrls = ['', '?date=1', '?date=2', '?date=7', '?bp=2', '?bp=3'].map(
      (q) => `https://www.quefaire.be/${path}${q}`
    );
    listUrls.push(`https://www.quefaire.be/noel/${path}`, `https://www.quefaire.be/brocantes/${path}`);
    out.push(
      ...(await crawl({
        src: 'quefaire.be',
        listUrls,
        linkRe: /\.shtml(\?|$)/,
        max: 90,
        defaults: { prov },
        fallback: (ctx) => {
          const base = genericFallback(ctx);
          if (!base) return null;
          const { $, clean } = ctx;
          // Fil d'Ariane : « Agenda > Loisirs > Animation, fête > Liège »
          const crumbs = $('[itemtype*="BreadcrumbList"] [itemprop="name"], .breadcrumb a, .ariane a')
            .map((_, el) => clean($(el).text()))
            .get();
          base.rawCat = crumbs.join(' ');
          base.town = crumbs[crumbs.length - 1] || '';
          return base;
        },
        log,
      }))
    );
  }
  return out;
}

/** brocabrac.fr — brocantes, puces et bourses. Codes : lg = Liège, lx = Luxembourg. */
async function brocabrac(log) {
  const out = [];
  for (const [prov, code] of [['lg', 'lg'], ['lx', 'lx']]) {
    const listUrls = [`https://brocabrac.fr/${code}/`, `https://brocabrac.fr/${code}/?p=2`, `https://brocabrac.fr/${code}/semaine/`];
    // Les pages de liste regroupent les annonces sous un intitulé de date ; on les lit directement.
    for (const url of listUrls) {
      let html;
      try {
        html = await fetchText(url);
      } catch (e) {
        log(`  ! ${e.message}`);
        continue;
      }
      const $ = cheerio.load(html);
      let currentDate = null;
      $('body *').each((_, el) => {
        const $el = $(el);
        if ($el.children().length > 3) return;
        const text = clean($el.text());
        if (/^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+\d{1,2}\s+[a-zéû]+\s+\d{4}$/i.test(text)) {
          currentDate = parseFrDate(text);
          return;
        }
        if (!currentDate || el.tagName !== 'a') return;
        const href = $el.attr('href') || '';
        if (!/\/\d{4,}/.test(href) && !/brocante|puces|bourse|vide/i.test(href)) return;
        // Bloc de l'annonce : « Ville Titre … 4020 - Brocante - Lieu »
        const block = clean($el.closest('li, article, div').text());
        const m = block.match(/(\d{4})\s*-\s*([^-]+?)\s*-\s*(.+)$/);
        if (!m) return;
        const title = clean($el.text()) || block.split(m[0])[0];
        out.push({
          src: 'brocabrac',
          url: new URL(href, url).href,
          t: title.replace(/^\s*[A-ZÉÈ][\w'-]+\s+/, (w) => w).trim(),
          d1: currentDate,
          d2: currentDate,
          postal: m[1],
          rawCat: m[2],
          venue: m[3].slice(0, 80),
          town: '',
          prov,
          c: /bourse/i.test(m[2]) ? 'brocante' : 'brocante',
          free: true,
        });
      });
    }
  }
  return out;
}

/** tasoiree.be — soirées, afterworks et événements festifs. region 3 = Liège. */
async function tasoiree(log) {
  const listUrls = ['https://www.tasoiree.be/agenda-region-3?view=list'];
  // On repère la région « Luxembourg » dans le menu pour ne pas coder son numéro en dur.
  try {
    const html = await fetchText('https://www.tasoiree.be/agenda');
    const $ = cheerio.load(html);
    $('a[href*="agenda-region-"]').each((_, a) => {
      if (/luxembourg/i.test($(a).text())) listUrls.push(new URL($(a).attr('href'), 'https://www.tasoiree.be/').href);
    });
  } catch (e) {
    log(`  ! ${e.message}`);
  }
  return crawl({
    src: 'tasoiree.be',
    listUrls,
    linkRe: /\/event-[a-z0-9-]+-\d+$/,
    max: 60,
    defaults: { c: 'soiree' },
    fallback: (ctx) => {
      const base = genericFallback(ctx);
      if (!base) return null;
      // L'adresse de l'URL se termine par « -ville-1234 »
      const m = ctx.url.match(/-([a-z-]+)-\d+$/);
      if (m && !base.town) base.town = m[1].split('-').slice(-1)[0];
      return base;
    },
    log,
  });
}

/** info-lux.com — très complet pour la province de Luxembourg, marchés et marchés de Noël. */
async function infolux(log) {
  const DATE_RE =
    /\b\d{1,2}(?:er)?\s+(?:janv|févr|fevr|mars|avr|mai|juin|juil|août|aout|sept|oct|nov|déc|dec)[a-zéû]*\.?(?:\s+\d{4})?|\b\d{1,2}\/\d{1,2}\/\d{4}/gi;
  return crawl({
    src: 'info-lux',
    listUrls: [
      'https://www.info-lux.com/category/wallonie/province-de-luxembourg/',
      'https://www.info-lux.com/category/wallonie/province-de-luxembourg/page/2/',
      'https://www.info-lux.com/category/liege/',
      'https://www.info-lux.com/category/liege/page/2/',
    ],
    // Fiches du type /satanyc-for-ever-…-2026/pays/belgique/wallonie/province-de-luxembourg/…/arlon/
    linkRe: /info-lux\.com\/(?!category\/)[a-z0-9-]+\/pays\/belgique\/wallonie\//,
    max: 90,
    fallback: ({ $, clean, parseFrDate, parseTime }) => {
      const text = clean($('body').text());
      // Seules les fiches « agenda » ont un bloc Quand / Où / Combien ; les articles d'actualité n'en ont pas.
      // « Quand Du 30 octobre au 27 novembre 2026Du lundi au samedi, 14 h-17 h 30… »
      const quand = text.match(/Quand\s*:?\s*((?:Du|Le|Les|Ce|Chaque|Tous|Jusqu|À partir|Dès|\d).{0,160})/);
      if (!quand) return null;
      const seg = quand[1];
      const yearEnd = seg.search(/\d{4}/);
      const datePart = yearEnd >= 0 ? seg.slice(0, yearEnd + 4) : seg.slice(0, 60);
      const dates = (datePart.match(DATE_RE) || []).map((d) => parseFrDate(d)).filter(Boolean).sort();
      if (!dates.length) return null;
      const hour = seg.slice(datePart.length).match(/(?:^|[^\d])(\d{1,2})\s*h\s*(\d{2})?/);
      const combien = (text.match(/Combien\s*:?\s*(.{0,80})/) || [])[1] || '';
      // Titre : « Arlon > Exposition > Satanyc For Ever, … (30 octobre – 27 novembre 2026) »
      const h1 = clean($('h1').first().text());
      const parts = h1.split(/\s*>\s*/);
      const t = (parts.length >= 3 ? parts.slice(2).join(' – ') : h1).replace(/\s*\([^)]*\d{4}[^)]*\)\s*$/, '');
      return {
        t,
        town: parts.length >= 3 ? parts[0] : '',
        rawCat: parts.length >= 3 ? parts[1] : '',
        rawDesc: clean($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content')),
        d1: dates[0],
        d2: dates[dates.length - 1],
        tm: hour ? parseTime(`${hour[1]}h${hour[2] || ''}`) : null,
        free: /entr[ée]e libre|gratuit/i.test(combien) ? true : /€/.test(combien) ? false : null,
        price: /€/.test(combien) ? clean(combien.match(/[\d,.]+\s*€/)?.[0]) || null : null,
        fullText: text.slice(0, 2000),
      };
    },
    log,
  });
}

// ---------- Grandes salles de concert (toute la Belgique, pas seulement Liège/Luxembourg) ----------

/**
 * Forest National et Lotto Arena tournent sur la même plateforme (« be•at » / Live Nation) :
 * un sitemap public liste les fiches /evenement/…, qui portent un JSON-LD schema.org/Event.
 * Particularité : ces fiches arrivent directement sur /auth/callback (authentification « invité »
 * silencieuse qui dépose un cookie) d'où fetchTextWithCookies plutôt que fetchText.
 * Autre particularité : leurs dates JSON-LD sont de vraies heures UTC (suffixe « Z »), à convertir.
 */
async function beatVenue(log, { domain, venue, town, postal, lat, lng }) {
  let sitemap;
  try {
    sitemap = await fetchText(`https://${domain}/sitemap.xml`);
  } catch (e) {
    log(`  ! ${e.message}`);
    return [];
  }
  const urls = [...new Set(sitemap.match(new RegExp(`https://${domain}/evenement/[a-z0-9-]+`, 'g')) || [])];
  const out = [];
  for (const url of urls.slice(0, 80)) {
    let html;
    try {
      html = await fetchTextWithCookies(url);
    } catch (e) {
      log(`  ! ${e.message}`);
      continue;
    }
    for (const ev of extractJsonLdEvents(html)) {
      if (!ev.startDate) continue; // écarte le nœud « EventVenue » (lui aussi repéré par /Event/i)
      const start = brusselsParts(ev.startDate);
      const end = ev.endDate ? brusselsParts(ev.endDate) : start;
      out.push({
        src: domain.replace(/^www\./, ''),
        url: ev.url || url,
        t: ev.name,
        rawDesc: typeof ev.description === 'string' ? ev.description : '',
        d1: start.date,
        d2: end.date || start.date,
        tm: start.time,
        venue,
        town,
        postal,
        lat,
        lng,
        prov: 'be',
        c: 'salle',
      });
    }
  }
  return out;
}
const forestNational = (log) =>
  beatVenue(log, { domain: 'www.forest-national.be', venue: 'Forest National', town: 'Bruxelles', postal: '1190', lat: 50.8176, lng: 4.3208 });
const lottoArena = (log) =>
  beatVenue(log, { domain: 'www.lotto-arena.be', venue: 'Lotto Arena', town: 'Anvers', postal: '2100', lat: 51.2367, lng: 4.4414 });

/** cirque-royal-bruxelles.be/agenda — une seule page, date et heure codées dans l'URL de la fiche. */
async function cirqueRoyal(log) {
  let html;
  try {
    html = await fetchText('https://www.cirque-royal-bruxelles.be/agenda');
  } catch (e) {
    log(`  ! ${e.message}`);
    return [];
  }
  const $ = cheerio.load(html);
  const out = [];
  $('.list-event figure').each((_, fig) => {
    const $fig = $(fig);
    const href = $fig.find('a[href]').first().attr('href') || '';
    const m = href.match(/-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})$/);
    const t = clean($fig.find('h3').first().text());
    if (!m || !t) return;
    out.push({
      src: 'cirque-royal', url: href, t,
      d1: `${m[1]}-${m[2]}-${m[3]}`, d2: `${m[1]}-${m[2]}-${m[3]}`, tm: `${m[4]}:${m[5]}`,
      venue: 'Cirque Royal', town: 'Bruxelles', postal: '1000', lat: 50.8508, lng: 4.3651, prov: 'be', c: 'salle',
    });
  });
  return out;
}

/** leforum.be/agenda.html — vieille page HTML toute simple, la date est dans le lien de réservation. */
async function leForum(log) {
  let html;
  try {
    html = await fetchText('https://www.leforum.be/agenda.html');
  } catch (e) {
    log(`  ! ${e.message}`);
    return [];
  }
  const $ = cheerio.load(html);
  const out = [];
  $('a.Reservation').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href') || '';
    const m = href.match(/spectacle_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})\.html/);
    const t = clean($a.parent().find('[id="AGENDA_Event"]').first().text());
    if (!m || !t) return;
    out.push({
      src: 'leforum.be', url: new URL(href, 'https://www.leforum.be/').href, t,
      d1: `${m[1]}-${m[2]}-${m[3]}`, d2: `${m[1]}-${m[2]}-${m[3]}`, tm: `${m[4]}:${m[5]}`,
      venue: 'Le Forum', town: 'Liège', postal: '4020', prov: 'lg', c: 'salle',
    });
  });
  return out;
}

/** Lit une date française libre « Du 10 au 15 novembre 2026 » / « Les 9 et 10 avril 2027 » / « Le 12 février 2027 ». */
function parseFrDateRange(text) {
  const t = clean(text).toLowerCase();
  const yearM = t.match(/\d{4}/);
  if (!yearM) return null;
  const year = yearM[0];
  const withoutYear = t.replace(year, ' ');
  const monthAlt = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
  const re = new RegExp(`(\\d{1,2})(?:er)?(?:\\s+(${monthAlt}))?`, 'g');
  const tokens = [];
  let m;
  while ((m = re.exec(withoutYear))) tokens.push({ day: +m[1], month: m[2] || null });
  for (let i = tokens.length - 1; i >= 0; i--) if (!tokens[i].month && i + 1 < tokens.length) tokens[i].month = tokens[i + 1].month;
  const dates = tokens.filter((tk) => tk.month).map((tk) => `${year}-${pad(MONTHS[tk.month])}-${pad(tk.day)}`).sort();
  if (!dates.length) return null;
  return { d1: dates[0], d2: dates[dates.length - 1] };
}

/** comedieenile.be/la-saison — un seul listing, dates en toutes lettres, pas d'horaire indiqué. */
async function comedieEnIle(log) {
  let html;
  try {
    html = await fetchText('https://comedieenile.be/la-saison');
  } catch (e) {
    log(`  ! ${e.message}`);
    return [];
  }
  const $ = cheerio.load(html);
  const out = [];
  $('article').each((_, art) => {
    const $art = $(art);
    const t = clean($art.find('h3').first().text());
    const range = parseFrDateRange($art.find('.date').first().text());
    const href = $art.find('a[href^="/la-saison/"]').first().attr('href');
    if (!t || !range || !href) return;
    out.push({
      src: 'comedieenile.be', url: new URL(href, 'https://comedieenile.be/').href, t,
      d1: range.d1, d2: range.d2,
      venue: 'Comédie en île', town: 'Liège', postal: '4020', prov: 'lg', c: 'salle',
    });
  });
  return out;
}

/** ing.arena.brussels/shows/ — listing JetEngine, date et lien déjà dans la page. */
async function ingArena(log) {
  let html;
  try {
    html = await fetchText('https://ing.arena.brussels/shows/');
  } catch (e) {
    log(`  ! ${e.message}`);
    return [];
  }
  const $ = cheerio.load(html);
  const out = [];
  $('[data-post-id]').each((_, el) => {
    const $el = $(el);
    const dateText = clean($el.find('.jet-listing-dynamic-field__content').first().text());
    const m = dateText.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
    const link = $el.find('a.jet-listing-dynamic-link__link').first();
    const href = link.attr('href');
    const t = clean(link.text());
    if (!m || !href || !t) return;
    out.push({
      src: 'ing-arena', url: href, t,
      d1: `20${m[3]}-${m[2]}-${m[1]}`, d2: `20${m[3]}-${m[2]}-${m[1]}`,
      venue: 'ING Arena', town: 'Bruxelles', postal: '1020', lat: 50.8958, lng: 4.3366, prov: 'be', c: 'salle',
    });
  });
  return out;
}

export const SOURCES = [
  { name: 'quefaire.be', run: quefaire },
  { name: 'brocabrac', run: brocabrac },
  { name: 'tasoiree.be', run: tasoiree },
  { name: 'info-lux', run: infolux },
  { name: 'forest-national', run: forestNational },
  { name: 'lotto-arena', run: lottoArena },
  { name: 'cirque-royal', run: cirqueRoyal },
  { name: 'leforum.be', run: leForum },
  { name: 'comedieenile.be', run: comedieEnIle },
  { name: 'ing-arena', run: ingArena },
];
