// Liste des sources lues chaque nuit. Une source qui échoue n'empêche jamais les autres.
import { crawl, genericFallback } from '../lib/crawl.js';
import { fetchText, parseFrDate, parseTime, clean } from '../lib/util.js';
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
  return crawl({
    src: 'info-lux',
    listUrls: [
      'https://www.info-lux.com/category/wallonie/province-de-luxembourg/',
      'https://www.info-lux.com/category/liege/',
      'https://www.info-lux.com/category/themes/marche/',
    ],
    linkRe: /info-lux\.com\/[^/]+-\d{4}\/?$|info-lux\.com\/\?p=\d+/,
    max: 80,
    fallback: (ctx) => {
      const base = genericFallback(ctx);
      if (!base) return null;
      // Titres du type « Herbeumont > Balade > Petites Vadrouilles 2026 »
      const parts = base.t.split(/\s*[>»]\s*/);
      if (parts.length >= 3) {
        base.town = parts[0];
        base.rawCat = parts[1];
        base.t = parts.slice(2).join(' – ').replace(/\s+20\d{2}$/, '');
      }
      return base;
    },
    log,
  });
}

/** visitwallonia.com — grands événements officiels. */
async function visitwallonia(log) {
  return crawl({
    src: 'VisitWallonia',
    listUrls: ['https://visitwallonia.com/fr-be/3/que-faire/agenda'],
    linkRe: /\/fr-be\/content\/.+|\/fr-be\/\d+\/.+agenda.+\/.+/,
    max: 40,
    fallback: genericFallback,
    log,
  });
}

export const SOURCES = [
  { name: 'quefaire.be', run: quefaire },
  { name: 'brocabrac', run: brocabrac },
  { name: 'tasoiree.be', run: tasoiree },
  { name: 'info-lux', run: infolux },
  { name: 'VisitWallonia', run: visitwallonia },
];
