const path = require('path');
const express = require('express');
const compression = require('compression');
const config = require('./config');
const store = require('./store');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(compression());
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '7d' }));

// ---------- helpers disponíveis nas views ----------
const nf = new Intl.NumberFormat('pt-PT', { useGrouping: 'always' }); // "9 990" e não "9990"
app.locals.stand = config.stand;
app.locals.siteUrl = config.siteUrl;
app.locals.fmtPrice = (v) => (v ? `${nf.format(Math.round(v))} €` : 'Sob consulta');
app.locals.fmtKm = (v) => (v != null ? `${nf.format(v)} km` : '—');
app.locals.fmtNum = (v) => (v != null ? nf.format(v) : '—');
// As imagens do Standvirtual (CDN olxcdn) aceitam o tamanho no URL: ";s=LARGURAxALTURA"
app.locals.img = (url, size = '640x480') => {
  if (!url) return '/static/img/sem-foto.svg';
  return /;s=\d+x\d+/.test(url) ? url.replace(/;s=\d+x\d+/, `;s=${size}`) : url;
};
app.locals.carName = (c) => [c.make, c.model].filter(Boolean).join(' ') || c.title;
app.locals.whatsappLink = (text) =>
  config.stand.whatsapp ? `https://wa.me/${config.stand.whatsapp}?text=${encodeURIComponent(text)}` : null;

// ---------- filtros da listagem ----------
const SORTS = {
  recentes: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''),
  'preco-asc': (a, b) => (a.price || Infinity) - (b.price || Infinity),
  'preco-desc': (a, b) => (b.price || 0) - (a.price || 0),
  'km-asc': (a, b) => (a.km ?? Infinity) - (b.km ?? Infinity),
  'ano-desc': (a, b) => (b.year || 0) - (a.year || 0),
};

function uniqueSorted(cars, field) {
  return [...new Set(cars.map((c) => c[field]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'pt'));
}

function applyFilters(cars, q) {
  const num = (v) => (v === undefined || v === '' ? null : Number(v));
  const f = {
    marca: q.marca || '',
    modelo: q.modelo || '',
    combustivel: q.combustivel || '',
    caixa: q.caixa || '',
    precoMin: num(q.precoMin),
    precoMax: num(q.precoMax),
    anoMin: num(q.anoMin),
    kmMax: num(q.kmMax),
    q: (q.q || '').trim().toLowerCase(),
    ordem: SORTS[q.ordem] ? q.ordem : 'recentes',
  };
  let out = cars.filter(
    (c) =>
      (!f.marca || c.make === f.marca) &&
      (!f.modelo || c.model === f.modelo) &&
      (!f.combustivel || c.fuel === f.combustivel) &&
      (!f.caixa || c.gearbox === f.caixa) &&
      (f.precoMin == null || (c.price || 0) >= f.precoMin) &&
      (f.precoMax == null || (c.price && c.price <= f.precoMax)) &&
      (f.anoMin == null || (c.year && c.year >= f.anoMin)) &&
      (f.kmMax == null || (c.km != null && c.km <= f.kmMax)) &&
      (!f.q || `${c.title} ${c.make} ${c.model} ${c.version}`.toLowerCase().includes(f.q))
  );
  out = [...out].sort(SORTS[f.ordem]);
  return { filters: f, results: out };
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
  });
}));

app.get('/viaturas', wrap(async (req, res) => {
  const cars = await store.getCars();
  const { filters, results } = applyFilters(cars, req.query);
  const models = uniqueSorted(filters.marca ? cars.filter((c) => c.make === filters.marca) : cars, 'model');
  res.render('listing', {
    page: 'viaturas',
    total: cars.length,
    results,
    filters,
    makes: uniqueSorted(cars, 'make'),
    models,
    fuels: uniqueSorted(cars, 'fuel'),
    gearboxes: uniqueSorted(cars, 'gearbox'),
    years: uniqueSorted(cars, 'year').reverse(),
  });
}));

app.get('/viaturas/:slug', wrap(async (req, res, next) => {
  const cars = await store.getCars();
  const id = req.params.slug.split('-').pop();
  const car = cars.find((c) => c.slug === req.params.slug) || cars.find((c) => String(c.id).toLowerCase() === id);
  if (!car) return next();
  if (car.slug !== req.params.slug) return res.redirect(301, `/viaturas/${car.slug}`);
  const related = cars
    .filter((c) => c.id !== car.id)
    .sort((a, b) => (b.make === car.make) - (a.make === car.make) || Math.abs((a.price || 0) - (car.price || 0)) - Math.abs((b.price || 0) - (car.price || 0)))
    .slice(0, 4);
  res.render('car', { page: 'viaturas', car, related });
}));

app.get('/contactos', (req, res) => res.render('contact', { page: 'contactos' }));
app.get('/sobre', (req, res) => res.render('about', { page: 'sobre' }));

app.get('/api/viaturas', wrap(async (req, res) => {
  res.json({ updatedAt: store.state.updatedAt, cars: await store.getCars() });
}));

app.get('/sitemap.xml', wrap(async (req, res) => {
  const cars = await store.getCars();
  const urls = ['/', '/viaturas', '/sobre', '/contactos', ...cars.map((c) => `/viaturas/${c.slug}`)];
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

app.use((req, res) => res.status(404).render('404', { page: '' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Erro interno');
});

store.init().then(() => {
  app.listen(config.port, () => console.log(`Zona Auto a correr em http://localhost:${config.port}`));
});
