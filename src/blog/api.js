// API de artigos (/api/v1/artigos/): chave, campos aceites, ligações internas válidas e gravação.
const { timingSafeEqual } = require('crypto');
const { z } = require('zod');
const config = require('../config');
const db = require('./db');
const { sanitizeContentHtml } = require('./html');
const { slugify, excerpt: makeExcerpt } = require('./text');
const { ImageError, importImage, processInlineImages } = require('./images');
const { checkSeo, SEO_LIMITS } = require('./seo');

const postPath = (slug) => `/blog/${slug}/`;
const absolute = (p) => `${config.siteUrl}${p}`;
// "page" está reservado para /blog/page/{n}/
const RESERVED_SLUGS = new Set(['page', 'feed']);

// ---------- chave ----------
function checkAuth(req) {
  const token = process.env.BLOG_API_TOKEN || '';
  if (token.length < 24) return { status: 503, error: 'A API de artigos está desligada (falta BLOG_API_TOKEN).' };
  const given = Buffer.from((req.get('authorization') || '').replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(token);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { status: 401, error: 'Chave inválida.' };
  return null;
}

// ---------- campos ----------
const image = z.object({
  url: z.string().url(),
  alt: z.string().trim().min(5, 'O texto alternativo (alt) da imagem tem de ter pelo menos 5 caracteres.').max(200),
  caption: z.string().trim().max(300).optional(),
  credit: z.string().trim().max(150).optional(),
  creditUrl: z.string().url().optional(),
}).strict();

const articleFields = z.object({
  title: z.string().trim().min(10).max(100),
  slug: z.string().trim().max(120),
  status: z.enum(['draft', 'published']),
  focusKeyword: z.string().trim().min(2).max(100),
  secondaryKeywords: z.array(z.string().trim().min(2).max(100)).max(10),
  seoTitle: z.string().trim().max(70),
  seoDescription: z.string().trim().max(170),
  excerpt: z.string().trim().max(300),
  contentHtml: z.string().min(50).max(200000),
  featuredImage: image.nullable(),
  faq: z.array(z.object({ question: z.string().trim().min(5).max(300), answer: z.string().trim().min(5).max(2000) }).strict()).max(15),
  sources: z.array(z.object({ title: z.string().trim().min(2).max(200), url: z.string().url() }).strict()).max(15),
  tags: z.array(z.string().trim().min(2).max(40)).max(10),
}).strict();
const createFields = articleFields.partial().required({ title: true, focusKeyword: true, contentHtml: true });
const updateFields = articleFields.partial();

const zodErrors = (e) => e.issues.map((i) => `${i.path.join('.') || 'pedido'}: ${i.message}`);

// ---------- ligações internas ----------
const USEFUL_LINKS = [
  { title: 'Stock de viaturas', url: '/stock/' },
  { title: 'Importação de carros por encomenda', url: '/importacao/' },
  { title: 'Contactos', url: '/contactos/' },
  { title: 'Blog', url: '/blog/' },
  { title: 'Página inicial', url: '/' },
];
const PAGES = [
  ...USEFUL_LINKS,
  { title: 'Política de privacidade', url: '/politica-de-privacidade/' },
  { title: 'Termos e condições de utilização', url: '/termos-e-condicoes-de-utilizacao/' },
];

// Tudo o que existe no site e pode receber ligações: páginas, stock, viaturas, artigos publicados e redirects.
async function siteLinks() {
  const store = require('../store');
  const cars = store.state.cars || [];
  const [published, redirects] = await Promise.all([db.listPublished(), db.redirectMap()]);
  const paths = new Set([
    ...PAGES.map((p) => p.url),
    ...cars.map((c) => `/stock/${c.slug}/`),
    ...published.map((p) => postPath(p.slug)),
    ...redirects.keys(),
  ]);
  const makes = [...new Set(cars.map((c) => c.make).filter(Boolean))].sort();
  return {
    exists: (p) => paths.has(p),
    published,
    makes: makes.map((m) => ({ name: m, url: `/stock/?marca=${encodeURIComponent(m)}` })),
    cars: cars.map((c) => ({ title: [c.make, c.model, c.version, c.year].filter(Boolean).join(' '), price: c.price, url: `/stock/${c.slug}/` })),
  };
}

async function context() {
  const [links, all] = await Promise.all([siteLinks(), db.listMeta()]);
  return {
    usedKeywords: [...new Set(all.map((p) => (p.focusKeyword || '').trim()).filter(Boolean))],
    posts: links.published.map((p) => ({ title: p.title, url: postPath(p.slug), focusKeyword: p.focusKeyword })),
    pages: PAGES,
    usefulLinks: USEFUL_LINKS,
    makes: links.makes,
    cars: links.cars,
    notes: [
      'As viaturas saem do stock quando são vendidas. Para ligações que duram, prefira /stock/ ou /stock/?marca=…',
      'Ligações para /stock/?marca=… contam como /stock/ (o que vem depois de ? é ignorado na verificação).',
    ],
    imageHosts: { 'images.pexels.com': 'copiada para o site', 'images.unsplash.com': 'fica no Unsplash (creditar o fotógrafo)' },
    limits: SEO_LIMITS,
  };
}

// ---------- resposta ----------
function serialize(p, seo) {
  const hasImage = Boolean(p.featuredImageKey || p.featuredImageUrl);
  return {
    id: p.id, status: p.status, title: p.title, slug: p.slug, url: absolute(postPath(p.slug)),
    focusKeyword: p.focusKeyword, secondaryKeywords: p.secondaryKeywords || [], seoTitle: p.seoTitle, seoDescription: p.seoDescription,
    excerpt: p.excerpt, contentHtml: p.contentHtml, tags: p.tags || [], faq: p.faq || [], sources: p.sources || [],
    featuredImage: hasImage
      ? { stored: p.featuredImageKey ? 'site' : 'unsplash', alt: p.featuredImageAlt, caption: p.featuredImageCaption, credit: p.featuredImageCredit, creditUrl: p.featuredImageCreditUrl }
      : null,
    publishedAt: p.publishedAt || null, updatedAt: p.updatedAt, createdVia: p.createdVia,
    ...(seo ? { seo } : {}),
  };
}

async function seoForPost(p) {
  const links = await siteLinks();
  return checkSeo({
    title: p.title, slug: p.slug, seoTitle: p.seoTitle, seoDescription: p.seoDescription, excerpt: p.excerpt, contentHtml: p.contentHtml,
    focusKeyword: p.focusKeyword, hasFeaturedImage: Boolean(p.featuredImageKey || p.featuredImageUrl), featuredImageAlt: p.featuredImageAlt,
    faq: p.faq, sources: p.sources, internalLinkExists: (path) => links.exists(path) || path === postPath(p.slug),
  });
}

/**
 * Cria (sem `prev`) ou corrige um artigo. Ordem: validar → endereço → SEO (recusa com erros, antes de
 * descarregar imagens) → imagens → limpar HTML → gravar → redirects → auditoria.
 * Devolve { status, body }.
 */
async function saveArticle(input, { prev, idempotencyKey } = {}) {
  const merged = {
    title: input.title ?? prev?.title ?? '',
    slug: slugify(input.slug || prev?.slug || input.title || '').slice(0, 120),
    status: input.status ?? prev?.status ?? 'draft',
    focusKeyword: input.focusKeyword ?? prev?.focusKeyword ?? '',
    secondaryKeywords: input.secondaryKeywords ?? prev?.secondaryKeywords ?? [],
    seoTitle: input.seoTitle ?? prev?.seoTitle ?? null,
    seoDescription: input.seoDescription ?? prev?.seoDescription ?? null,
    contentHtml: input.contentHtml ?? prev?.contentHtml ?? '',
    faq: input.faq ?? prev?.faq ?? [],
    sources: input.sources ?? prev?.sources ?? [],
    tags: input.tags ?? prev?.tags ?? [],
  };
  const excerpt = input.excerpt ?? prev?.excerpt ?? null;
  const image = input.featuredImage; // undefined = manter, null = tirar
  const hasImage = image !== undefined ? Boolean(image) : Boolean(prev?.featuredImageKey || prev?.featuredImageUrl);
  const imageAlt = image !== undefined ? image?.alt : prev?.featuredImageAlt;

  if (!merged.slug) return { status: 400, body: { error: 'Pedido inválido.', details: ['slug: indique o título ou o endereço.'] } };
  if (RESERVED_SLUGS.has(merged.slug)) return { status: 409, body: { error: `O endereço "${merged.slug}" está reservado.` } };
  const clash = (await db.listMeta()).find((p) => p.slug === merged.slug && p.id !== prev?.id);
  if (clash) return { status: 409, body: { error: `O endereço "${merged.slug}" já está em uso.`, existingId: clash.id } };

  const links = await siteLinks();
  const seo = checkSeo({
    ...merged, excerpt, hasFeaturedImage: hasImage, featuredImageAlt: imageAlt,
    internalLinkExists: (path) => links.exists(path) || path === postPath(merged.slug),
  });
  if (seo.errors.length) return { status: 422, body: { error: 'O artigo tem erros; corrija e envie outra vez.', seo } };

  // Imagens (só as que vieram neste pedido)
  let imageFields = {};
  let contentHtml = merged.contentHtml;
  try {
    if (image) {
      const img = await importImage(image.url);
      imageFields = {
        featuredImageKey: img.key || null, featuredImageUrl: img.url || null, featuredImageAlt: image.alt,
        featuredImageCaption: image.caption || null, featuredImageCredit: image.credit || null, featuredImageCreditUrl: image.creditUrl || null,
      };
    } else if (image === null) {
      imageFields = { featuredImageKey: null, featuredImageUrl: null, featuredImageAlt: null, featuredImageCaption: null, featuredImageCredit: null, featuredImageCreditUrl: null };
    }
    if (input.contentHtml !== undefined) contentHtml = await processInlineImages(contentHtml);
  } catch (err) {
    if (err instanceof ImageError) return { status: 422, body: { error: err.message } };
    throw err;
  }
  contentHtml = sanitizeContentHtml(contentHtml);

  const values = {
    ...merged, contentHtml, ...imageFields,
    excerpt: excerpt || makeExcerpt(contentHtml, 220),
    publishedAt: merged.status === 'published' ? (prev?.publishedAt || new Date()) : (prev?.publishedAt || null),
  };

  let result;
  if (prev) result = await db.updatePost(prev.id, values);
  else result = await db.createPost({ ...values, createdVia: 'api' }, idempotencyKey);
  if (result.replay) return { status: 200, body: { ...serialize(result.replay), idempotentReplay: true } };
  if (result.slugTakenBy) return { status: 409, body: { error: `O endereço "${merged.slug}" já está em uso.`, existingId: result.slugTakenBy } };
  if (result.notFound) return { status: 404, body: { error: 'Artigo não encontrado.' } };
  const post = result.post;

  // Redirects: endereço novo de um artigo publicado; artigo que deixou de estar publicado.
  if (prev?.status === 'published') {
    if (prev.slug !== post.slug) await db.addRedirect(postPath(prev.slug), postPath(post.slug), 'Mudança de endereço do artigo (API)');
    else if (post.status !== 'published') await db.addRedirect(postPath(post.slug), '/blog/', 'Artigo despublicado (API)');
  }
  if (post.status === 'published') await db.removeRedirect(postPath(post.slug));

  await db.audit(prev ? 'post.api_update' : 'post.api_create', post.id, { status: post.status, score: seo.score });
  return { status: prev ? 200 : 201, body: serialize(post, seo) };
}

// Apaga um artigo; se estava publicado, o endereço passa a levar ao /blog/.
async function deleteArticle(post) {
  await db.deletePost(post.id);
  if (post.status === 'published') await db.addRedirect(postPath(post.slug), '/blog/', 'Artigo apagado (API)');
  await db.audit('post.api_delete', post.id, { slug: post.slug, status: post.status });
}

module.exports = { checkAuth, createFields, updateFields, zodErrors, serialize, seoForPost, saveArticle, deleteArticle, context, postPath };
