// Recolhe o inventário do stand no Standvirtual.
//
// Estratégia (pensada para resistir a mudanças no layout do Standvirtual):
//  1. Percorre as páginas do inventário do stand e recolhe todos os links de anúncios.
//  2. Abre cada anúncio e extrai os dados de três fontes, por ordem de riqueza:
//     __NEXT_DATA__ (JSON da aplicação Next.js), JSON-LD (schema.org) e meta tags.
//  3. Normaliza tudo para um objeto "viatura" simples, usado pelo site.
const config = require('./config');

const AD_LINK_RE = /https?:\/\/(?:www\.)?standvirtual\.com\/[a-z-]+\/anuncio\/[^"'\s<>\\]+?-ID[0-9A-Za-z]+\.html/g;
const AD_PATH_RE = /["'](\/[a-z-]+\/anuncio\/[^"'\s<>\\]+?-ID[0-9A-Za-z]+\.html)/g;

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

// ---------- utilitários de parsing ----------

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

function htmlToText(html) {
  if (!html) return '';
  return decodeEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h\d)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

function extractNextData(html) {
  const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      const data = JSON.parse(m[1]);
      const items = Array.isArray(data) ? data : data['@graph'] || [data];
      out.push(...items);
    } catch {
      /* ignora blocos inválidos */
    }
  }
  return out;
}

function meta(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, 'i');
  const m = html.match(re);
  return m ? decodeEntities(m[1]) : '';
}

// Percorre um objeto JSON em profundidade e devolve o primeiro nó que satisfaz `test`.
function findDeep(obj, test, depth = 0, seen = new Set()) {
  if (!obj || typeof obj !== 'object' || depth > 14 || seen.has(obj)) return null;
  seen.add(obj);
  if (test(obj)) return obj;
  for (const v of Object.values(obj)) {
    const found = findDeep(v, test, depth + 1, seen);
    if (found) return found;
  }
  return null;
}

// Alguns dados do Next.js vêm como strings JSON embebidas (ex.: estado urql/apollo).
function expandJsonStrings(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 10) return obj;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v.length > 50 && (v[0] === '{' || v[0] === '[')) {
      try {
        obj[k] = expandJsonStrings(JSON.parse(v), depth + 1);
      } catch {
        /* não era JSON */
      }
    } else if (v && typeof v === 'object') {
      expandJsonStrings(v, depth + 1);
    }
  }
  return obj;
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

// ---------- listagem ----------

async function listAdvertUrls() {
  const base = config.standvirtual.inventoryUrl;
  const urls = new Set();
  for (let page = 1; page <= config.standvirtual.maxPages; page++) {
    const pageUrl = page === 1 ? base : `${base}${base.includes('?') ? '&' : '?'}page=${page}`;
    const html = await fetchHtml(pageUrl);
    if (!html) break;
    const before = urls.size;
    for (const m of html.matchAll(AD_LINK_RE)) urls.add(m[0].replace('http://', 'https://'));
    for (const m of html.matchAll(AD_PATH_RE)) urls.add(`https://www.standvirtual.com${m[1]}`);
    if (urls.size === before) break; // página sem anúncios novos → fim
  }
  return [...urls].map((u) => u.replace('https://standvirtual.com', 'https://www.standvirtual.com'));
}

// ---------- detalhe ----------

// Mapeia chaves/etiquetas do Standvirtual para os campos normalizados.
const FIELD_MATCHERS = {
  make: [/^make$/, /^marca$/i],
  model: [/^model$/, /^modelo$/i],
  version: [/^version$/, /^vers[aã]o$/i],
  year: [/first_registration_year|^year$/, /^ano/i],
  month: [/first_registration_month/, /^m[eê]s/i],
  km: [/^mileage$/, /quil[oó]metros|^km$/i],
  fuel: [/fuel_type/, /combust[ií]vel/i],
  gearbox: [/^gearbox$/, /caixa/i],
  power: [/engine_power/, /pot[eê]ncia/i],
  engineCc: [/engine_capacity/, /cilindrada/i],
  doors: [/door_count/, /portas/i],
  seats: [/nr_seats/, /lota[cç][aã]o|lugares/i],
  color: [/^color$/, /^cor$/i],
  body: [/body_type|segment/, /segmento|carro[cç]aria|tipo de ve[ií]culo/i],
  traction: [/transmission/, /tra[cç][aã]o/i],
  condition: [/^new_used$|^condition$/, /condi[cç][aã]o|estado/i],
};

function pickSpec(specs, field) {
  const [keyRe, labelRe] = FIELD_MATCHERS[field];
  const hit = specs.find((s) => (s.key && keyRe.test(s.key)) || (s.label && labelRe.test(s.label)));
  return hit ? hit.value : null;
}

function specsFromAdvert(advert) {
  const specs = [];
  const push = (key, label, value) => {
    if (value == null || value === '') return;
    if (typeof value === 'object') value = value.label ?? value.value ?? value.name ?? '';
    value = String(value).trim();
    if (value && !specs.some((s) => (key && s.key === key) || s.label === label)) specs.push({ key, label, value });
  };
  for (const d of advert.details || advert.parameters || []) {
    push(d.key, d.label || d.name, d.value ?? d.displayValue ?? (d.values && d.values.map((v) => v.label).join(', ')));
  }
  for (const [key, d] of Object.entries(advert.parametersDict || {})) {
    const vals = d && d.values ? d.values.map((v) => v.label || v.value).join(', ') : d && d.value;
    push(key, d && d.label, vals);
  }
  return specs;
}

function equipmentFromAdvert(advert) {
  const groups = [];
  for (const g of advert.equipment || []) {
    const items = (g.values || g.items || []).map((v) => (typeof v === 'string' ? v : v.label || v.name)).filter(Boolean);
    if (items.length) groups.push({ group: g.label || g.name || 'Equipamento', items });
  }
  return groups;
}

function imagesFromAdvert(advert) {
  const list = (advert.images && (advert.images.photos || advert.images)) || advert.photos || [];
  return (Array.isArray(list) ? list : [])
    .map((p) => (typeof p === 'string' ? p : p.url || p.src || (p.urls && Object.values(p.urls).pop())))
    .filter(Boolean);
}

function parseAdvertPage(html, url) {
  const idMatch = url.match(/-ID([0-9A-Za-z]+)\.html/);
  const id = idMatch ? idMatch[1] : slugify(url);

  // 1) __NEXT_DATA__
  const next = extractNextData(html);
  let advert = null;
  if (next) {
    expandJsonStrings(next);
    advert =
      findDeep(next, (o) => o.advert && typeof o.advert === 'object' && (o.advert.title || o.advert.id))?.advert ||
      findDeep(next, (o) => o.title && o.price && (o.details || o.parametersDict || o.images));
  }
  advert = advert || {};

  // 2) JSON-LD
  const ld = extractJsonLd(html);
  const car =
    ld.find((x) => /car|vehicle/i.test([].concat(x['@type']).join(','))) ||
    ld.find((x) => /product/i.test([].concat(x['@type']).join(','))) ||
    {};
  const offer = [].concat(car.offers || [])[0] || {};

  // 3) especificações combinadas
  const specs = specsFromAdvert(advert);
  const ldSpecs = [
    ['make', 'Marca', car.brand && (car.brand.name || car.brand)],
    ['model', 'Modelo', car.model],
    ['first_registration_year', 'Ano', car.vehicleModelDate || car.productionDate],
    ['mileage', 'Quilómetros', car.mileageFromOdometer && (car.mileageFromOdometer.value ?? car.mileageFromOdometer)],
    ['fuel_type', 'Combustível', car.fuelType],
    ['gearbox', 'Tipo de Caixa', car.vehicleTransmission],
    ['color', 'Cor', car.color],
    ['door_count', 'Nº de Portas', car.numberOfDoors],
    ['body_type', 'Segmento', car.bodyType],
  ];
  for (const [key, label, value] of ldSpecs) {
    if (value && !specs.some((s) => s.key === key || s.label === label)) specs.push({ key, label, value: String(value) });
  }

  const priceObj = advert.price || {};
  const price =
    toNumber(priceObj.value ?? priceObj.amount?.value ?? priceObj.amount ?? (typeof priceObj !== 'object' ? priceObj : null)) ??
    toNumber(offer.price) ??
    toNumber(meta(html, 'product:price:amount'));

  const title = advert.title || car.name || meta(html, 'og:title').replace(/\s*[-|]\s*Standvirtual.*$/i, '');
  let images = imagesFromAdvert(advert);
  if (!images.length) images = [].concat(car.image || []).map((i) => (typeof i === 'string' ? i : i.url)).filter(Boolean);
  if (!images.length && meta(html, 'og:image')) images = [meta(html, 'og:image')];

  const v = {
    id,
    sourceUrl: url,
    title: decodeEntities(title || '').trim(),
    price,
    currency: priceObj.currency || offer.priceCurrency || 'EUR',
    negotiable: /negoci/i.test(JSON.stringify(priceObj.labels || priceObj.badges || '')),
    vatDeductible: /iva/i.test(JSON.stringify(priceObj.labels || priceObj.badges || '')),
    make: pickSpec(specs, 'make'),
    model: pickSpec(specs, 'model'),
    version: pickSpec(specs, 'version'),
    year: toNumber(pickSpec(specs, 'year')),
    month: pickSpec(specs, 'month'),
    km: toNumber(pickSpec(specs, 'km')),
    fuel: pickSpec(specs, 'fuel'),
    gearbox: pickSpec(specs, 'gearbox'),
    power: toNumber(pickSpec(specs, 'power')),
    engineCc: toNumber(pickSpec(specs, 'engineCc')),
    doors: toNumber(pickSpec(specs, 'doors')),
    seats: toNumber(pickSpec(specs, 'seats')),
    color: pickSpec(specs, 'color'),
    body: pickSpec(specs, 'body'),
    traction: pickSpec(specs, 'traction'),
    description: htmlToText(advert.description || car.description || meta(html, 'og:description')),
    images: [...new Set(images)],
    specs,
    equipment: equipmentFromAdvert(advert),
    createdAt: advert.createdAt || advert.created_at || null,
  };
  v.slug = `${slugify([v.make, v.model, v.version].filter(Boolean).join(' ') || v.title)}-${v.id}`.toLowerCase();
  return v;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await fn(items[idx]);
      } catch (err) {
        console.error(`[sync] falhou ${items[idx]}: ${err.message}`);
        results[idx] = null;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function scrapeInventory() {
  const started = Date.now();
  const urls = await listAdvertUrls();
  if (!urls.length) throw new Error('Nenhum anúncio encontrado no inventário do Standvirtual');
  const cars = (
    await mapLimit(urls, config.standvirtual.concurrency, async (url) => {
      const html = await fetchHtml(url);
      return html ? parseAdvertPage(html, url) : null;
    })
  ).filter((c) => c && c.title);
  console.log(`[sync] ${cars.length}/${urls.length} viaturas em ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return cars;
}

module.exports = { scrapeInventory, listAdvertUrls, parseAdvertPage, fetchHtml, slugify };
