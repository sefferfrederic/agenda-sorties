// Parcours « page de liste → pages d'événements » commun à toutes les sources.
import * as cheerio from 'cheerio';
import { fetchText, clean, parseFrDate, parseTime } from './util.js';
import { extractJsonLdEvents, fromSchemaEvent } from './jsonld.js';

/**
 * @param {object} o
 * @param {string} o.src         nom de la source
 * @param {string[]} o.listUrls  pages de liste à parcourir
 * @param {RegExp} o.linkRe      motif des liens vers une fiche événement
 * @param {number} o.max         nombre maximum de fiches à lire
 * @param {(ctx)=>object|null} o.fallback  lecture HTML si la fiche n'a pas de JSON-LD
 * @param {object} o.defaults    valeurs ajoutées à chaque événement (prov, c…)
 */
export async function crawl({ src, listUrls, linkRe, max = 80, fallback, defaults = {}, log }) {
  const links = new Set();
  const listEvents = [];
  for (const listUrl of listUrls) {
    let html;
    try {
      html = await fetchText(listUrl);
    } catch (e) {
      log(`  ! ${e.message}`);
      continue;
    }
    // Certaines pages de liste contiennent déjà les événements en JSON-LD.
    for (const ev of extractJsonLdEvents(html)) {
      listEvents.push({ ...fromSchemaEvent(ev, src, listUrl), ...defaults });
    }
    const $ = cheerio.load(html);
    $('a[href]').each((_, a) => {
      const href = $(a).attr('href');
      if (!href || !linkRe.test(href)) return;
      try {
        links.add(new URL(href, listUrl).href.split('#')[0]);
      } catch {}
    });
  }

  const events = [...listEvents];
  const seen = new Set(listEvents.map((e) => e.url));
  for (const url of [...links].slice(0, max)) {
    if (seen.has(url)) continue;
    let html;
    try {
      html = await fetchText(url);
    } catch (e) {
      log(`  ! ${e.message}`);
      continue;
    }
    const ld = extractJsonLdEvents(html);
    if (ld.length) {
      for (const ev of ld) events.push({ ...fromSchemaEvent(ev, src, url), url, ...defaults });
      continue;
    }
    if (fallback) {
      const $ = cheerio.load(html);
      const ev = fallback({ $, url, html, clean, parseFrDate, parseTime });
      if (ev) events.push({ src, url, ...ev, ...defaults });
    }
  }
  return events;
}

/** Lecture HTML générique d'une fiche : titre, meta description, dates trouvées dans le texte. */
export function genericFallback({ $, clean, parseFrDate, parseTime }) {
  const t = clean($('h1').first().text()) || clean($('meta[property="og:title"]').attr('content'));
  if (!t) return null;
  const body = clean($('main').text() || $('article').text() || $('body').text());
  const dateRe =
    /\b(\d{1,2}(?:er)?\s+(?:janv|févr|fevr|mars|avr|mai|juin|juil|août|aout|sept|oct|nov|déc|dec)[a-zéû]*\.?(?:\s+\d{4})?|\d{1,2}\/\d{1,2}\/\d{4})/gi;
  const dates = (body.match(dateRe) || []).map((d) => parseFrDate(d)).filter(Boolean).sort();
  if (!dates.length) return null;
  const desc = clean($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content'));
  const hourMatch = body.match(/(?:de|dès|à partir de|ouverture)\s*(\d{1,2}\s*h\s*\d{0,2})/i);
  return {
    t,
    rawDesc: desc,
    d1: dates[0],
    d2: dates[dates.length - 1] > dates[0] && dates.length <= 3 ? dates[dates.length - 1] : dates[0],
    tm: hourMatch ? parseTime(hourMatch[1]) : null,
    free: /\bgratuit/i.test(body) ? true : null,
    town: '',
    fullText: body.slice(0, 3000),
  };
}
