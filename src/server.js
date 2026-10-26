const path = require('path');
const express = require('express');
const compression = require('compression');
const config = require('./config');
const store = require('./store');
const photos = require('./photos');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(compression());
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '7d' }));
app.get('/foto/:id/:size.jpg', photos.handler);

// ---------- helpers disponíveis nas views ----------
const nf = new Intl.NumberFormat('pt-PT', { useGrouping: 'always' }); // "9 990" e não "9990"
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const monthNum = (m) => {
  const i = MONTHS.indexOf(String(m || '').toLowerCase());
  return i >= 0 ? String(i + 1).padStart(2, '0') : null;
};

Object.assign(app.locals, {
  stand: config.stand,
  gtmId: config.gtmId,
  siteUrl: config.siteUrl,
  fmtNum: (v) => (v != null ? nf.format(v) : '—'),
  fmtPrice: (v) => (v ? `${nf.format(Math.round(v))} €` : 'Sob consulta'),
  fmtKm: (v) => (v != null ? `${nf.format(v)} km` : '—'),
  // "07/2009" quando há mês de registo
  fmtDate: (c) => (c.year ? (monthNum(c.month) ? `${monthNum(c.month)}/${c.year}` : String(c.year)) : '—'),
  // Fotos do Standvirtual servidas pelo nosso domínio, no tamanho pedido
  img: (url, size = '640x480') => (url ? photos.localPath(url, size) || url : '/static/img/sem-foto.svg'),
  carName: (c) => [c.make, c.model].filter(Boolean).join(' ') || c.title,
  // Versão do anúncio, ou segmento e potência quando o anúncio não tem versão
  carSub: (c) => c.version || [c.body, c.engineCc && (c.engineCc / 1000).toFixed(1), c.power && `${c.power} cv`].filter(Boolean).join(' · ') || c.title,
  telHref: (p) => `tel:${String(p).replace(/[^\d+]/g, '')}`,
  waLink: (text) => `https://wa.me/${config.stand.whatsapp}${text ? `?text=${encodeURIComponent(text)}` : ''}`,
  mapsLink: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${config.stand.street}, ${config.stand.city}`)}`,
  mapsEmbed: `https://www.google.com/maps?q=${encodeURIComponent(`${config.stand.street}, ${config.stand.city}`)}&output=embed`,
  carUrl: (c) => `/stock/${c.slug}/`,
});

// ---------- filtros da listagem ----------
const SORTS = {
  recentes: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''),
  'preco-asc': (a, b) => (a.price || Infinity) - (b.price || Infinity),
  'preco-desc': (a, b) => (b.price || 0) - (a.price || 0),
  'km-asc': (a, b) => (a.km ?? Infinity) - (b.km ?? Infinity),
  'ano-desc': (a, b) => (b.year || 0) - (a.year || 0),
};
const SORT_LABELS = [
  ['recentes', 'Mais recentes'],
  ['preco-asc', 'Preço mais baixo'],
  ['preco-desc', 'Preço mais alto'],
  ['km-asc', 'Menos quilómetros'],
  ['ano-desc', 'Mais novos'],
];

function uniqueSorted(cars, field) {
  return [...new Set(cars.map((c) => c[field]).filter(Boolean))].sort((a, b) =>
    typeof a === 'number' ? a - b : String(a).localeCompare(String(b), 'pt')
  );
}

function applyFilters(cars, q) {
  const num = (v) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  const f = {
    marca: q.marca || '',
    modelo: q.modelo || '',
    combustivel: q.combustivel || '',
    caixa: q.caixa || '',
    segmento: q.segmento || '',
    precoMax: num(q.precoMax),
    anoMin: num(q.anoMin),
    kmMax: num(q.kmMax),
    q: (q.q || '').trim(),
    ordem: SORTS[q.ordem] ? q.ordem : 'recentes',
  };
  const needle = f.q.toLowerCase();
  const results = cars
    .filter(
      (c) =>
        (!f.marca || c.make === f.marca) &&
        (!f.modelo || c.model === f.modelo) &&
        (!f.combustivel || c.fuel === f.combustivel) &&
        (!f.caixa || c.gearbox === f.caixa) &&
        (!f.segmento || c.body === f.segmento) &&
        (f.precoMax == null || (c.price && c.price <= f.precoMax)) &&
        (f.anoMin == null || (c.year && c.year >= f.anoMin)) &&
        (f.kmMax == null || (c.km != null && c.km <= f.kmMax)) &&
        (!needle || `${c.title} ${c.make} ${c.model} ${c.version}`.toLowerCase().includes(needle))
    )
    .sort(SORTS[f.ordem]);
  const active = ['marca', 'modelo', 'combustivel', 'caixa', 'segmento', 'precoMax', 'anoMin', 'kmMax', 'q'].filter(
    (k) => f[k] !== '' && f[k] != null
  ).length;
  return { filters: f, results, active };
}

// Escalões de preço que fazem sentido para o stock atual
function priceSteps(cars) {
  const max = Math.max(0, ...cars.map((c) => c.price || 0));
  const steps = [5000, 7500, 10000, 12500, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000];
  const out = steps.filter((s) => s < max);
  return max ? [...out, steps.find((s) => s >= max) || max] : steps.slice(0, 6);
}

// ---------- rotas ----------
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

app.get('/', wrap(async (req, res) => {
  const cars = await store.getCars();
  res.render('home', {
    page: 'home',
    cars,
    featured: [...cars].sort(SORTS.recentes).slice(0, 8),
    makes: uniqueSorted(cars, 'make'),
    fuels: uniqueSorted(cars, 'fuel'),
    prices: priceSteps(cars),
  });
}));

app.get('/stock', wrap(async (req, res) => {
  const cars = await store.getCars();
  const { filters, results, active } = applyFilters(cars, req.query);
  res.render('stock', {
    page: 'stock',
    total: cars.length,
    results,
    filters,
    active,
    sorts: SORT_LABELS,
    makes: uniqueSorted(cars, 'make'),
    models: uniqueSorted(filters.marca ? cars.filter((c) => c.make === filters.marca) : cars, 'model'),
    fuels: uniqueSorted(cars, 'fuel'),
    gearboxes: uniqueSorted(cars, 'gearbox'),
    bodies: uniqueSorted(cars, 'body'),
    years: uniqueSorted(cars, 'year').reverse(),
    prices: priceSteps(cars),
  });
}));

app.get('/stock/:slug', wrap(async (req, res) => {
  const cars = await store.getCars();
  const id = req.params.slug.split('-').pop();
  const car = cars.find((c) => c.slug === req.params.slug) || cars.find((c) => String(c.id).toLowerCase() === id);
  if (!car) return res.status(404).render('404', { page: '', sold: true });
  if (car.slug !== req.params.slug) return res.redirect(301, `/stock/${car.slug}/`);
  const related = cars
    .filter((c) => c.id !== car.id)
    .sort(
      (a, b) =>
        (b.body === car.body) - (a.body === car.body) ||
        Math.abs((a.price || 0) - (car.price || 0)) - Math.abs((b.price || 0) - (car.price || 0))
    )
    .slice(0, 3);
  res.render('car', { page: 'stock', car, related });
}));

// Endereços antigos do WordPress
app.get(['/viaturas', '/listings', '/inventory'], (req, res) => res.redirect(301, '/stock/'));
app.get(['/listings/:slug', '/viaturas/:slug'], wrap(async (req, res) => {
  const cars = await store.getCars();
  const words = req.params.slug.split('-');
  const match = cars.find((c) => c.make && c.model && words.includes(c.make.toLowerCase()) && words.includes(c.model.toLowerCase()));
  res.redirect(301, match ? `/stock/${match.slug}/` : '/stock/');
}));
app.get(['/contact-us', '/contact'], (req, res) => res.redirect(301, '/contactos/'));

app.get('/importacao', (req, res) => res.render('importacao', { page: 'importacao', missing: false, form: {} }));
app.get('/contactos', (req, res) => res.render('contactos', { page: 'contactos', missing: false, form: {} }));
app.get('/politica-de-privacidade', (req, res) => res.render('privacidade', { page: '' }));
app.get('/termos-e-condicoes-de-utilizacao', (req, res) => res.render('termos', { page: '' }));

// Formulários: o pedido segue pelo WhatsApp do stand, com a mensagem já escrita.
const FORMS = {
  contactos: {
    title: 'Contacto pelo site',
    fields: [['nome', 'Nome'], ['telemovel', 'Telemóvel'], ['email', 'Email'], ['mensagem', 'Mensagem']],
    required: ['nome', 'mensagem'],
  },
  importacao: {
    title: 'Pedido de importação',
    fields: [['nome', 'Nome'], ['telemovel', 'Telemóvel'], ['email', 'Email'], ['anuncio', 'Anúncio em vista'], ['prazo', 'Quando quer avançar'], ['detalhes', 'Detalhes']],
    required: ['nome', 'telemovel'],
  },
};

for (const [name, def] of Object.entries(FORMS)) {
  app.post(`/${name}`, (req, res) => {
    const form = {};
    for (const [k] of def.fields) form[k] = String(req.body[k] || '').trim().slice(0, 2000);
    if (def.required.some((k) => !form[k])) return res.status(400).render(name, { page: name, missing: true, form });
    const lines = def.fields.filter(([k]) => form[k]).map(([k, label]) => `${label}: ${form[k]}`);
    res.redirect(303, app.locals.waLink(`*${def.title}*\n${lines.join('\n')}`));
  });
}

app.get('/api/viaturas', wrap(async (req, res) => {
  res.json({ updatedAt: store.state.updatedAt, cars: await store.getCars() });
}));

app.get('/sitemap.xml', wrap(async (req, res) => {
  const cars = await store.getCars();
  const urls = ['/', '/stock/', '/importacao/', '/contactos/', ...cars.map((c) => `/stock/${c.slug}/`)];
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${config.siteUrl}${u}</loc></url>`)
      .join('\n')}\n</urlset>`
  );
}));

app.get('/robots.txt', (req, res) =>
  res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${config.siteUrl}/sitemap.xml\n`)
);

app.get('/healthz', (req, res) =>
  res.json({ ok: true, cars: store.state.cars.length, updatedAt: store.state.updatedAt, lastError: store.state.lastError })
);

// Chamado pelo Cloud Scheduler para forçar a sincronização.
app.all('/tarefas/sincronizar', wrap(async (req, res) => {
  const token = req.get('x-sync-token') || req.query.token;
  if (!config.syncToken || token !== config.syncToken) return res.status(403).json({ ok: false });
  await store.sync();
  res.json({ ok: !store.state.lastError, cars: store.state.cars.length, error: store.state.lastError });
}));

app.use((req, res) => res.status(404).render('404', { page: '', sold: false }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Erro interno');
});

if (require.main === module) {
  store.init().then(() => {
    app.listen(config.port, () => console.log(`Zona Auto a correr em http://localhost:${config.port}`));
  });
}

module.exports = app;
