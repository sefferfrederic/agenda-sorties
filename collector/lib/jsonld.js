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
  // Dates au format « 2026-06-27T13:00 » ou compact « 20260627T130000 »
  const parse = (s) => {
    const m = String(s || '').match(/^(\d{4})-?(\d{2})-?(\d{2})(?:[T ](\d{2}):?(\d{2}))?/);
    if (!m) return { d: '', t: null };
    return { d: `${m[1]}-${m[2]}-${m[3]}`, t: m[4] && `${m[4]}:${m[5]}` !== '00:00' ? `${m[4]}:${m[5]}` : null };
  };
  const start = parse(ev.startDate);
  const end = ev.endDate ? parse(ev.endDate) : start;
  const price = offers.price != null ? Number(offers.price) : null;
  return {
    t: ev.name,
    rawDesc: typeof ev.description === 'string' ? ev.description : '',
    d1: start.d,
    d2: end.d || start.d,
    tm: start.t,
    tmEnd: end.t,
    venue: loc.name || '',
    town: (typeof addr === 'string' ? addr : addr.addressLocality) || '',
    postal: typeof addr === 'object' ? addr.postalCode || '' : '',
    lat: geo.latitude != null ? Number(geo.latitude) : null,
    lng: geo.longitude != null ? Number(geo.longitude) : null,
    free: price === 0 ? true : price > 0 ? false : null,
    price: price > 0 ? `${price} €` : null,
    rawCat: [].concat(ev['@type'] || [], ev.eventType || [], ev.keywords || []).join(' '),
    src,
    url: ev.url || fallbackUrl,
  };
}
