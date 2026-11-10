// Lecture des données structurées schema.org/Event que beaucoup d'agendas publient
// dans leurs pages (<script type="application/ld+json">). C'est la méthode la plus fiable :
// elle ne dépend pas de la mise en page du site.
import * as cheerio from 'cheerio';

export function extractJsonLdEvents(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    let data;
    try {
      data = JSON.parse($(el).contents().text().trim());
    } catch {
      return;
    }
    walk(data, out);
  });
  return out;
}

function walk(node, out) {
  if (!node) return;
  if (Array.isArray(node)) return node.forEach((n) => walk(n, out));
  if (typeof node !== 'object') return;
  const type = [].concat(node['@type'] || []).join(' ');
  if (/Event/i.test(type)) out.push(node);
  if (node['@graph']) walk(node['@graph'], out);
  if (node.itemListElement) walk(node.itemListElement, out);
  if (node.item) walk(node.item, out);
}

/** Convertit un objet schema.org/Event en événement brut pour le pipeline. */
export function fromSchemaEvent(ev, src, fallbackUrl) {
  const loc = [].concat(ev.location || [])[0] || {};
  const addr = loc.address || {};
  const geo = loc.geo || {};
  const offers = [].concat(ev.offers || [])[0] || {};
  const start = ev.startDate || '';
  const end = ev.endDate || start;
  const price = offers.price != null ? Number(offers.price) : null;
  return {
    t: ev.name,
    rawDesc: typeof ev.description === 'string' ? ev.description : '',
    d1: start.slice(0, 10),
    d2: end.slice(0, 10),
    tm: /T\d{2}:\d{2}/.test(start) && !/T00:00/.test(start) ? start.slice(11, 16) : null,
    tmEnd: /T\d{2}:\d{2}/.test(end) && !/T00:00/.test(end) ? end.slice(11, 16) : null,
    venue: loc.name || '',
    town: (typeof addr === 'string' ? addr : addr.addressLocality) || '',
    postal: typeof addr === 'object' ? addr.postalCode || '' : '',
    lat: geo.latitude != null ? Number(geo.latitude) : null,
    lng: geo.longitude != null ? Number(geo.longitude) : null,
    free: price === 0 ? true : price > 0 ? false : null,
    price: price > 0 ? `${price} €` : null,
    rawCat: [].concat(ev.eventType || ev.keywords || []).join(' '),
    src,
    url: ev.url || fallbackUrl,
  };
}
