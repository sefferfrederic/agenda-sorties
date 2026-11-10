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

export const SOURCES = [
  { name: 'quefaire.be', run: quefaire },
  { name: 'brocabrac', run: brocabrac },
  { name: 'tasoiree.be', run: tasoiree },
  { name: 'info-lux', run: infolux },
];
