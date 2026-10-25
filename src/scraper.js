// Recolhe o inventário do stand no Standvirtual.
//
//  1. Lê as páginas do inventário do stand (https://<stand>.standvirtual.com/inventory?page=N).
//     Cada página traz até 30 anúncios com fotos, preço e características (publishedAds).
//  2. Abre cada anúncio em www.standvirtual.com para obter o resto: descrição, todas as fotos,
//     características com nomes legíveis e equipamento agrupado.
//  3. Se a página de um anúncio falhar, a viatura aparece na mesma com os dados do inventário.
const config = require('./config');

const AD_LINK_RE = /https?:\/\/(?:www\.)?standvirtual\.com\/[a-z-]+\/anuncio\/[^"'\s<>\\]+?-ID[0-9A-Za-z]+\.html/g;

// Campos que não interessam ao cliente (internos ou encriptados)
const HIDDEN_KEYS = new Set([
  'vin', 'catalog_urn', 'version_label', 'autorenew', 'cant_see_my_version', 'is_imported_car', 'classic',
  'registration', 'date_registration', 'video', 'financial_option', 'leasing_concession',
]);

async function fetchHtml(url, attempt = 1) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': config.standvirtual.userAgent,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-PT,pt;q=0.9',
      },
    });
    if (res.status === 404 || res.status === 410) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
    return await res.text();
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      return fetchHtml(url, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- utilitários ----------

function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

// Converte o HTML da descrição numa lista simples de blocos {type: 'p'|'li', text, bold}
// para ser desenhada de forma segura nos templates.
function descriptionBlocks(html) {
  if (!html) return [];
  const blocks = [];
  // Blocos <p>/<li>/<h*>, texto solto, e outras etiquetas (<ul>, <br>…) que são ignoradas
  const re = /<(p|li|h\d)[^>]*>([\s\S]*?)<\/\1>|([^<]+)|<[^>]*>/gi;
  const clean = (s) => decodeEntities(String(s).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').trim();
  let m;
  while ((m = re.exec(html))) {
    if (!m[1] && !m[3]) continue;
    if (m[3]) {
      const t = clean(m[3]);
      if (t) blocks.push({ type: 'p', text: t, bold: false });
      continue;
    }
    const text = clean(m[2]);
    if (!text) continue;
    const bold = /^\s*<(b|strong)>[\s\S]*<\/(b|strong)>\s*$/i.test(m[2]);
    blocks.push({ type: m[1].toLowerCase() === 'li' ? 'li' : 'p', text, bold });
  }
  return blocks;
}

function extractNextData(html) {
  const m = html && html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

// O estado urql do Next.js vem como strings JSON; devolve todos os blocos já descodificados.
function urqlData(next) {
  const state = next && next.props && next.props.pageProps && next.props.pageProps.urqlState;
  if (!state) return [];
  return Object.values(state)
    .map((v) => {
      try {
        return typeof v.data === 'string' ? JSON.parse(v.data) : v.data;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function toNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  // Aceita "120 000 km", "120.000", "1 598 cm3", "12 500,50 €"
  const m = String(v).replace(/ /g, ' ').match(/\d{1,3}(?:[ .]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const grouped = /[ .]\d{3}/.test(m[0]) && !/^\d+\.\d{1,2}$/.test(m[0]);
  const n = parseFloat(grouped ? m[0].replace(/[ .]/g, '').replace(',', '.') : m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function slugify(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

const adCode = (url) => (url.match(/-ID([0-9A-Za-z]+)\.html/) || [])[1] || null;

// ---------- inventário do stand ----------

function parseStand(next) {
  for (const d of urqlData(next)) {
    const s = d.professionalSellerBySubdomain;
    if (!s) continue;
    const a = s.address || {};
    const loc = a.location || {};
    return {
      name: s.businessName || s.name,
      address: [a.address, [a.postalCode, loc.city && loc.city.name].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      latitude: loc.latitude,
      longitude: loc.longitude,
      logo: s.logo && s.logo.url,
    };
  }
  return null;
}

async function listInventory() {
  const base = config.standvirtual.inventoryUrl;
  const ads = new Map();
  let stand = null;
  for (let page = 1; page <= config.standvirtual.maxPages; page++) {
    const html = await fetchHtml(page === 1 ? base : `${base}${base.includes('?') ? '&' : '?'}page=${page}`);
    if (!html) break;
    const next = extractNextData(html);
    if (page === 1) stand = parseStand(next);
    const published = urqlData(next).map((d) => d.publishedAds).find(Boolean);
    const before = ads.size;
    if (published) {
      for (const ad of published.ads || []) if (ad.url) ads.set(adCode(ad.url) || ad.id, ad);
    } else {
      // Plano B se a estrutura mudar: apanha só os links dos anúncios.
      for (const m of html.matchAll(AD_LINK_RE)) ads.set(adCode(m[0]), ads.get(adCode(m[0])) || { url: m[0] });
    }
    if (ads.size === before || (published && ads.size >= published.total)) break;
  }
  return { stand, ads: [...ads.values()] };
}

// ---------- normalização de uma viatura ----------

function attrsToSpecs(attributes) {
  return (attributes || [])
    .filter((a) => !HIDDEN_KEYS.has(a.key))
    .map((a) => ({ key: a.key, label: null, value: `${a.valueLabel}${a.valueSuffix ? ' ' + a.valueSuffix : ''}`.trim() }));
}

function detailsToSpecs(details) {
  return (details || [])
    .filter((d) => d.key && !HIDDEN_KEYS.has(d.key) && d.label && d.label !== d.key && d.value != null && d.value !== '')
    .map((d) => ({ key: d.key, label: d.label, value: String(d.value), group: d.group || null }));
}

function buildCar(listAd, advert) {
  advert = advert || {};
  const url = advert.url || listAd.url;
  const code = adCode(url) || String(listAd.id || advert.id);

  const detailSpecs = detailsToSpecs(advert.details);
  const specs = detailSpecs.length ? detailSpecs : attrsToSpecs(listAd.attributes);
  // Valores "em bruto" para os campos principais (atributos do inventário + detalhes)
  const raw = {};
  for (const a of listAd.attributes || []) raw[a.key] = `${a.valueLabel}${a.valueSuffix ? ' ' + a.valueSuffix : ''}`.trim();
  for (const s of specs) raw[s.key] = s.value;
  for (const [k, p] of Object.entries(advert.parametersDict || {})) {
    if (raw[k] == null && p && p.values && p.values[0]) raw[k] = p.values[0].label || p.values[0].value;
  }

  const listPrice = listAd.price && listAd.price.grossMinorAmount != null ? listAd.price.grossMinorAmount / 100 : null;
  const price = toNumber(advert.price && advert.price.value) ?? listPrice;
  const priceLabels = (advert.price && advert.price.labels) || [];
  const drop = advert.priceDrop || null;
  const oldPrice =
    drop && typeof drop === 'object'
      ? toNumber(drop.previousPrice?.value ?? drop.oldPrice?.value ?? drop.previousPrice ?? drop.oldPrice ?? null)
      : null;

  const photos = (advert.images && advert.images.photos ? advert.images.photos.map((p) => p.url || p.id) : listAd.photos || []).filter(Boolean);

  const equipment = (advert.equipment || [])
    .map((g) => ({ group: g.label, items: (g.values || []).map((v) => v.label).filter(Boolean) }))
    .filter((g) => g.items.length);

  const car = {
    id: code,
    adId: String(advert.id || listAd.id || ''),
    sourceUrl: url,
    title: decodeEntities(advert.title || listAd.title || '').trim(),
    price,
    oldPrice: oldPrice && price && oldPrice > price ? oldPrice : null,
    currency: (advert.price && advert.price.currency) || (listAd.price && listAd.price.currencyCode) || 'EUR',
    negotiable: priceLabels.some((l) => /negoti/i.test(l)),
    vatDeductible: priceLabels.some((l) => /vat|iva/i.test(l)) || (listAd.price && listAd.price.isNet === true),
    make: raw.make || null,
    model: raw.model || null,
    version: raw.version || null,
    year: toNumber(raw.first_registration_year),
    month: raw.first_registration_month || null,
    km: toNumber(raw.mileage),
    fuel: raw.fuel_type || null,
    gearbox: raw.gearbox || null,
    power: toNumber(raw.engine_power),
    engineCc: toNumber(raw.engine_capacity),
    doors: toNumber(raw.door_count),
    seats: toNumber(raw.nr_seats),
    color: raw.color || null,
    body: raw.body_type || null,
    traction: raw.transmission || null,
    condition: raw.new_used || null,
    warranty: raw.vendors_warranty_valid_until_date || null,
    funding: raw.accept_funding === 'Sim',
    tradeIn: raw.accept_returns === 'Sim',
    description: descriptionBlocks(advert.description),
    images: [...new Set(photos)],
    specs,
    equipment,
    createdAt: advert.originalCreatedAt || advert.createdAt || null,
    updatedAt: advert.updatedAt || null,
  };
  const name = [car.make, car.model, car.version].filter(Boolean).join(' ') || car.title;
  car.slug = `${slugify(`${name} ${car.year || ''}`)}-${code}`.toLowerCase();
  return car;
}

function parseAdvertPage(html) {
  const next = extractNextData(html);
  return (next && next.props && next.props.pageProps && next.props.pageProps.advert) || null;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function scrapeInventory() {
  const started = Date.now();
  const { stand, ads } = await listInventory();
  if (!ads.length) throw new Error('Nenhum anúncio encontrado no inventário do Standvirtual');
  let enriched = 0;
  const cars = await mapLimit(ads, config.standvirtual.concurrency, async (ad) => {
    let advert = null;
    try {
      const html = await fetchHtml(ad.url);
      if (html === null) return null; // anúncio removido entretanto
      advert = parseAdvertPage(html);
      if (advert) enriched++;
    } catch (err) {
      console.error(`[sync] detalhe falhou ${ad.url}: ${err.message}`);
    }
    if (!advert && !ad.title) return null;
    return buildCar(ad, advert);
  });
  const valid = cars.filter((c) => c && c.title);
  console.log(`[sync] ${valid.length} viaturas (${enriched} com detalhe completo) em ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return { stand, cars: valid };
}

module.exports = { scrapeInventory, listInventory, buildCar, parseAdvertPage, descriptionBlocks, fetchHtml, slugify, toNumber };
