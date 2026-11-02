// Rotas do blog: páginas públicas, RSS, API de artigos, redirects e limpeza diária de imagens.
const express = require('express');
const config = require('../config');
const db = require('./db');
const api = require('./api');
const media = require('./media');
const { postImage } = require('./images');
const { sanitizeContentHtml } = require('./html');

const PER_PAGE = 12;
const MAX_BODY = '1mb';
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const absolute = (p) => (p.startsWith('/') ? `${config.siteUrl}${p}` : p);

// ---------- API ----------
const apiRouter = express.Router({ strict: false });
apiRouter.use(express.text({ type: () => true, limit: MAX_BODY }));
apiRouter.use(wrap(async (req, res, next) => {
  const denied = api.checkAuth(req);
  if (denied) return res.status(denied.status).json({ error: denied.error });
  if (!(await db.rateLimit('blog-api', 300, 3600))) return res.status(429).json({ error: 'Demasiados pedidos. Tente daqui a uma hora.' });
  if (req.method === 'POST' || req.method === 'PATCH') {
    try {
      req.json = JSON.parse(typeof req.body === 'string' ? req.body : '');
    } catch {
      return res.status(400).json({ error: 'O corpo do pedido tem de ser JSON válido.' });
    }
  }
  next();
}));

apiRouter.get('/contexto', wrap(async (req, res) => res.json(await api.context())));

apiRouter.post('/', wrap(async (req, res) => {
  const parsed = api.createFields.safeParse(req.json);
  if (!parsed.success) return res.status(400).json({ error: 'Pedido inválido.', details: api.zodErrors(parsed.error) });
  // Reenviar com a mesma Idempotency-Key devolve o artigo já criado, sem duplicar.
  const key = (req.get('idempotency-key') || '').trim().slice(0, 100) || null;
  if (key) {
    const done = await db.findByIdempotencyKey(key);
    if (done) return res.status(200).json({ ...api.serialize(done), idempotentReplay: true });
  }
  const r = await api.saveArticle(parsed.data, { idempotencyKey: key });
  res.status(r.status).json(r.body);
}));

apiRouter.get('/', wrap(async (req, res) => {
  const rows = (await db.listMeta()).filter((p) => p.createdVia === 'api').slice(0, 50);
  res.json({ articles: rows.map((p) => { const { contentHtml, ...rest } = api.serialize(p); return rest; }) });
}));

async function loadPost(req, res) {
  const id = Number(req.params.id);
  const post = Number.isInteger(id) ? await db.getById(id) : null;
  if (!post) res.status(404).json({ error: 'Artigo não encontrado.' });
  return post;
}

apiRouter.get('/:id', wrap(async (req, res) => {
  const post = await loadPost(req, res);
  if (post) res.json(api.serialize(post, await api.seoForPost(post)));
}));

apiRouter.patch('/:id', wrap(async (req, res) => {
  const post = await loadPost(req, res);
  if (!post) return;
  if (post.createdVia !== 'api') return res.status(403).json({ error: 'Este artigo não foi criado pela API e não pode ser alterado por ela.' });
  const parsed = api.updateFields.safeParse(req.json);
  if (!parsed.success) return res.status(400).json({ error: 'Pedido inválido.', details: api.zodErrors(parsed.error) });
  const r = await api.saveArticle(parsed.data, { prev: post });
  res.status(r.status).json(r.body);
}));

// Não há back-office: apagar também se faz pela API.
apiRouter.delete('/:id', wrap(async (req, res) => {
  const post = await loadPost(req, res);
  if (!post) return;
  if (post.createdVia !== 'api') return res.status(403).json({ error: 'Este artigo não foi criado pela API e não pode ser apagado por ela.' });
  await api.deleteArticle(post);
  res.json({ deleted: true, id: post.id, redirect: post.status === 'published' ? `${api.postPath(post.slug)} → /blog/` : null });
}));

apiRouter.use((req, res) => res.status(404).json({ error: 'Pedido desconhecido. Ver docs/API_ARTIGOS.md.' }));
// eslint-disable-next-line no-unused-vars
apiRouter.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Pedido demasiado grande (máximo 1 MB).' });
  console.error('[blog-api]', err);
  res.status(500).json({ error: 'Erro interno. Tente outra vez.' });
});

// ---------- páginas públicas ----------
const pages = express.Router();

async function renderIndex(req, res, next, page) {
  let all;
  try {
    all = await db.listPublished();
  } catch (err) {
    console.error(`[blog] ${err.message}`);
    return next(); // sem base de dados, o blog não existe (404)
  }
  const totalPages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  if (page > totalPages) return next();
  const posts = all.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const window = Array.from({ length: totalPages }, (_, i) => i + 1).filter((n) => n === 1 || n === totalPages || Math.abs(n - page) <= 2);
  res.render('blog', { page: 'blog', posts, pageNum: page, totalPages, window, postImage, pageHref: (n) => (n === 1 ? '/blog/' : `/blog/page/${n}/`) });
}

pages.get('/blog', wrap((req, res, next) => renderIndex(req, res, next, 1)));
pages.get('/blog/page/:n', wrap((req, res, next) => {
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n < 1) return next();
  if (n === 1) return res.redirect(301, '/blog/');
  return renderIndex(req, res, next, n);
}));

pages.get('/blog/:slug', wrap(async (req, res, next) => {
  let post;
  try {
    post = await db.getBySlug(req.params.slug);
  } catch (err) {
    console.error(`[blog] ${err.message}`);
    return next();
  }
  if (!post || post.status !== 'published') return next(); // rascunhos não são públicos
  const featured = postImage(post, 1600);
  const related = (await db.listPublished()).filter((p) => p.id !== post.id).slice(0, 3);
  const cars = [...(require('../store').state.cars || [])].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 3);
  res.render('post', {
    page: 'blog', post, featured, imageAbs: featured ? absolute(featured.src) : null, related, cars, postImage,
    contentHtml: sanitizeContentHtml(post.contentHtml),
  });
}));

const esc = (s) => String(s || '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

pages.get('/feed', wrap(async (req, res) => {
  const posts = (await db.listPublished()).slice(0, 20);
  const items = posts.map((p) => {
    const url = absolute(api.postPath(p.slug));
    return `<item><title>${esc(p.title)}</title><link>${url}</link><guid>${url}</guid>${p.publishedAt ? `<pubDate>${p.publishedAt.toUTCString()}</pubDate>` : ''}<description>${esc(p.excerpt)}</description></item>`;
  }).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(config.stand.name)}</title><link>${config.siteUrl}/blog/</link><description>Guias sobre comprar, financiar e manter carros usados em Portugal</description><language>pt-PT</language>${items}</channel></rss>`;
  res.type('application/rss+xml; charset=utf-8').set('Cache-Control', 'public, max-age=3600').send(xml);
}));

// ---------- redirects (depois das rotas normais, antes do 404) ----------
const redirects = wrap(async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const path = req.path.endsWith('/') ? req.path : `${req.path}/`;
  let hit;
  try {
    hit = (await db.redirectMap()).get(path);
  } catch (err) {
    console.error(`[redirects] ${err.message}`);
  }
  if (hit) return res.redirect(hit.statusCode || 301, hit.toPath);
  next();
});

// Mostra "Blog" no menu só quando há artigos publicados. Se o Firestore falhar, o resto do site continua.
const SKIP_NAV = /^\/(static|foto|media|api|tarefas)\//;
const nav = (req, res, next) => {
  if (SKIP_NAV.test(req.path)) return next();
  db.listPublished()
    .then((p) => { res.locals.hasBlog = p.length > 0; })
    .catch((err) => { res.locals.hasBlog = false; console.error(`[blog] ${err.message}`); })
    .finally(next);
};

// Endereços para o sitemap.xml
async function sitemapEntries() {
  try {
    return (await db.listPublished()).map((p) => ({ path: api.postPath(p.slug), lastmod: p.updatedAt }));
  } catch (err) {
    console.error(`[sitemap] ${err.message}`);
    return [];
  }
}

// ---------- limpeza diária de imagens ----------
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
const ORPHAN_MAX_SHARE = 0.5;

// Apaga as imagens guardadas que nenhum artigo usa, com mais de 1 dia. Travão: não apaga nada se mais de metade parecer órfã.
async function cleanupImages() {
  const [files, posts] = await Promise.all([media.listMediaKeys(), db.listFull()]);
  const used = new Set(posts.map((p) => p.featuredImageKey).filter(Boolean));
  const html = posts.map((p) => p.contentHtml || '').join('\n');
  const cutoff = Date.now() - ORPHAN_GRACE_MS;
  const orphans = [...files].filter(([key, mtime]) => !used.has(key) && mtime.getTime() <= cutoff && !html.includes(`/media/${key}-`)).map(([key]) => key);
  if (orphans.length > 2 && orphans.length > files.size * ORPHAN_MAX_SHARE) {
    throw new Error(`${orphans.length} de ${files.size} imagens sem referência; nada foi apagado (verifique a configuração).`);
  }
  for (const key of orphans) await media.deleteMedia(key);
  return { images: files.size, deleted: orphans.length };
}

module.exports = { apiRouter, pages, redirects, nav, sitemapEntries, cleanupImages };
