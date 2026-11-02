// Teste de ponta a ponta da API de artigos e das páginas do blog.
// Precisa do emulador do Firestore:  gcloud emulators firestore start --host-port=127.0.0.1:8085
// Uso:  node e2e/api-artigos.js
// Arranca o site numa porta própria, com um banco de imagens falso e uma pasta de imagens temporária.
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sharp = require('sharp');

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
const PORT = 8190;
const BANK_PORT = 8191;
const BASE = `http://127.0.0.1:${PORT}`;
const BANK = `http://127.0.0.1:${BANK_PORT}`;
const TOKEN = 'teste-'.padEnd(40, 'x');
const API = `${BASE}/api/v1/artigos`;

let passed = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) passed++;
  else failures.push(`${name}${detail ? ` → ${detail}` : ''}`);
  console.log(`${ok ? '✓' : '✗'} ${name}${!ok && detail ? ` → ${detail}` : ''}`);
}

async function call(method, url, { body, token = TOKEN, headers = {}, raw } = {}) {
  const res = await fetch(url, {
    method,
    redirect: 'manual',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined || raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* não é JSON */ }
  return { status: res.status, json, text, headers: res.headers };
}

// ---------- banco de imagens falso ----------
async function startBank() {
  const jpeg = await sharp({ create: { width: 2000, height: 1200, channels: 3, background: '#542be4' } }).jpeg().toBuffer();
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/foto')) { res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': jpeg.length }); return res.end(jpeg); }
    if (req.url === '/nao-imagem') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html></html>'); }
    if (req.url === '/redireciona') { res.writeHead(302, { Location: '/foto.jpg' }); return res.end(); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(BANK_PORT, '127.0.0.1', r));
  return server;
}

// ---------- texto de um artigo válido ----------
function article(cars, overrides = {}) {
  const filler = (n, seed) => Array.from({ length: n }, (_, i) => ['viatura', 'garantia', 'revisão', 'quilómetros', 'documentos', 'financiamento', 'inspeção', 'stand'][(i + seed) % 8]).join(' ');
  const car = cars[0];
  const html = [
    '<p>Comprar carro usado em Lisboa pode ser simples se souber o que verificar antes de assinar.</p>',
    `<h2>Como comprar carro usado com garantia</h2><p>${filler(120, 1)}.</p>`,
    `<h2>Documentos a pedir</h2><p>${filler(120, 2)}. Veja o <a href="/stock/">stock</a> e a <a href="/importacao/">importação</a>.</p>`,
    `<p><img src="${BANK}/foto-texto.jpg" alt="Interior de um carro usado"></p>`,
    `<h2>Financiamento</h2><p>${filler(120, 3)}. Fale connosco em <a href="/contactos/">contactos</a>${car ? ` ou veja o <a href="${car.url}">${car.title}</a>` : ''}, ou consulte o <a href="https://www.imt-ip.pt/">IMT</a>.</p>`,
    `<p>${filler(100, 4)} comprar carro usado.</p>`,
  ].join('');
  return {
    title: 'Comprar carro usado: o que verificar antes de assinar',
    focusKeyword: 'comprar carro usado',
    secondaryKeywords: ['carro usado com garantia'],
    seoTitle: 'Comprar carro usado: 7 coisas a verificar',
    seoDescription: 'Documentos, quilómetros, inspeção e garantia: o que confirmar antes de comprar carro usado para não ter surpresas depois.',
    excerpt: 'O que confirmar antes de comprar carro usado.',
    contentHtml: html,
    featuredImage: { url: `${BANK}/foto.jpg`, alt: 'Carro usado num stand em Lisboa', caption: 'Um dos carros do stand', credit: 'Foto: Ana Silva / Pexels', creditUrl: 'https://www.pexels.com/@ana' },
    faq: [
      { question: 'Os carros têm garantia?', answer: 'Sim, os carros do stand têm garantia.' },
      { question: 'Posso dar o meu carro como retoma?', answer: 'Sim, avaliamos o teu carro.' },
      { question: 'Há financiamento?', answer: 'Sim, com várias instituições.' },
    ],
    sources: [{ title: 'IMT', url: 'https://www.imt-ip.pt/' }],
    tags: ['carros usados', 'guias'],
    status: 'published',
    ...overrides,
  };
}

async function waitFor(url, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* ainda a arrancar */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`O site não arrancou: ${url}`);
}

(async () => {
  // Base de dados limpa
  await fetch(`http://${EMULATOR}/emulator/v1/projects/zonaauto-local/databases/(default)/documents`, { method: 'DELETE' });
  const bank = await startBank();
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zonaauto-media-'));
  const site = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env, PORT: String(PORT), FIRESTORE_EMULATOR_HOST: EMULATOR, BLOG_API_TOKEN: TOKEN, BLOG_IMAGE_TEST_ORIGIN: BANK,
      MEDIA_DIR: mediaDir, REFRESH_MINUTES: '99999', SNAPSHOT_BUCKET: '', NODE_ENV: 'test', GTM_ID: '', SYNC_TOKEN: 'sync-teste',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  site.stdout.on('data', (d) => { log += d; });
  site.stderr.on('data', (d) => { log += d; });

  try {
    await waitFor(`${BASE}/estado`);

    // Chave
    check('sem chave → 401', (await call('GET', `${API}/contexto/`, { token: null })).status === 401);
    check('chave errada → 401', (await call('GET', `${API}/contexto/`, { token: 'x'.repeat(40) })).status === 401);

    // Contexto
    const ctx = await call('GET', `${API}/contexto/`);
    check('contexto → 200 com limites, páginas e stock', ctx.status === 200 && ctx.json.limits?.minWords === 300 && ctx.json.pages.some((p) => p.url === '/stock/') && Array.isArray(ctx.json.cars));
    const cars = ctx.json.cars || [];

    // Pedidos inválidos
    check('JSON inválido → 400', (await call('POST', `${API}/`, { raw: '{isto não é json' })).status === 400);
    const short = await call('POST', `${API}/`, { body: { ...article(cars), title: 'Curto' } });
    check('título curto → 400 com detalhes', short.status === 400 && short.json.details?.some((d) => d.startsWith('title')));
    check('campo desconhecido → 400', (await call('POST', `${API}/`, { body: { ...article(cars), autor: 'x' } })).status === 400);
    const noAlt = await call('POST', `${API}/`, { body: article(cars, { featuredImage: { url: `${BANK}/foto.jpg`, alt: '' } }) });
    check('imagem de destaque sem alt → 400', noAlt.status === 400 && noAlt.json.details?.some((d) => d.includes('alt')));
    const big = await call('POST', `${API}/`, { raw: JSON.stringify({ ...article(cars), contentHtml: 'x'.repeat(1100000) }) });
    check('corpo acima de 1 MB → 413', big.status === 413);

    // Erros de SEO e de imagem (nada é gravado)
    const h1 = await call('POST', `${API}/`, { body: article(cars, { contentHtml: article(cars).contentHtml + '<h1>Outro título</h1>' }) });
    check('<h1> no texto → 422', h1.status === 422 && h1.json.seo?.errors.some((e) => e.includes('<h1>')));
    const broken = await call('POST', `${API}/`, { body: article(cars, { contentHtml: article(cars).contentHtml + '<p><a href="/nao-existe/">x</a></p>' }) });
    check('ligação interna partida → 422 com o endereço', broken.status === 422 && broken.json.seo?.errors.some((e) => e.includes('/nao-existe/')));
    const inlineNoAlt = await call('POST', `${API}/`, { body: article(cars, { contentHtml: article(cars).contentHtml + `<img src="${BANK}/foto.jpg">` }) });
    check('imagem do texto sem alt → 422', inlineNoAlt.status === 422);
    const foreign = await call('POST', `${API}/`, { body: article(cars, { featuredImage: { url: 'https://example.com/a.jpg', alt: 'Imagem de outro sítio' } }) });
    check('imagem de outro sítio → 422', foreign.status === 422 && foreign.json.error.includes('Pexels'));
    const notImage = await call('POST', `${API}/`, { body: article(cars, { featuredImage: { url: `${BANK}/nao-imagem`, alt: 'Isto não é imagem' } }) });
    check('endereço que não é imagem → 422', notImage.status === 422);
    const redir = await call('POST', `${API}/`, { body: article(cars, { featuredImage: { url: `${BANK}/redireciona`, alt: 'Imagem com redirect' } }) });
    check('imagem com redirect → 422 (não segue)', redir.status === 422);
    check('nada foi gravado depois dos erros', (await call('GET', `${API}/`)).json.articles.length === 0);

    // Criar e publicar
    const created = await call('POST', `${API}/`, { body: article(cars), headers: { 'Idempotency-Key': 'artigo-1' } });
    const post = created.json || {};
    check('criar e publicar → 201', created.status === 201, created.text.slice(0, 300));
    check('nota SEO ≥ 80 e sem erros', post.seo?.score >= 80 && post.seo.errors.length === 0, JSON.stringify(post.seo?.warnings));
    check('imagem de destaque guardada no site', post.featuredImage?.stored === 'site');
    check('endereço em /blog/', post.url === `https://zonaauto.pt/blog/${post.slug}/`);

    // Página pública
    const page = await call('GET', `${BASE}/blog/${post.slug}/`, { token: null });
    const h = page.text;
    check('página do artigo → 200', page.status === 200);
    check('<h1> com o título', h.includes(`<h1 class="post-title">${post.title}</h1>`));
    check('<title> = título para o Google', h.includes('<title>Comprar carro usado: 7 coisas a verificar</title>'));
    check('meta description', h.includes('<meta name="description" content="Documentos, quilómetros'));
    check('canonical', h.includes(`<link rel="canonical" href="https://zonaauto.pt/blog/${post.slug}/">`));
    check('figure com alt, srcset e fetchpriority', /<figure class="post-figure">\s*<img src="\/media\/blog\/[\w-]+-1600\.webp" srcset="[^"]+400w[^"]+800w[^"]+1600w" [^>]*alt="Carro usado num stand em Lisboa" fetchpriority="high"/.test(h));
    check('legenda e crédito com nofollow', h.includes('Um dos carros do stand') && h.includes('<a href="https://www.pexels.com/@ana" target="_blank" rel="noopener nofollow">Foto: Ana Silva / Pexels</a>'));
    check('imagem do texto copiada, com srcset e lazy', /<img src="\/media\/blog\/[\w-]+-1600\.webp" srcset="[^"]+" sizes="[^"]+" alt="Interior de um carro usado" width="2000" height="1200" loading="lazy"/.test(h));
    check('ligação externa com nofollow', h.includes('<a href="https://www.imt-ip.pt/" rel="noopener nofollow" target="_blank">IMT</a>'));
    check('perguntas frequentes (a primeira aberta)', h.includes('<details open><summary>Os carros têm garantia?'));
    check('fontes com nofollow', /<section class="post-sources"[\s\S]*rel="noopener nofollow">IMT<\/a>/.test(h));
    check('JSON-LD BlogPosting e FAQPage', h.includes('"@type":"BlogPosting"') && h.includes('"@type":"FAQPage"') && h.includes('"datePublished"'));
    check('og:image absoluto e twitter', /<meta property="og:image" content="https:\/\/zonaauto\.pt\/media\/blog\/[\w-]+-1600\.webp">/.test(h) && h.includes('content="summary_large_image"') && h.includes('<meta property="og:type" content="article">'));
    const imgPath = (h.match(/src="(\/media\/blog\/[\w-]+-800\.webp)"/) || [])[1] || (h.match(/(\/media\/blog\/[\w-]+)-1600\.webp/) || [])[1] + '-800.webp';
    const media = await call('GET', `${BASE}${imgPath}`, { token: null });
    check('imagem servida em WebP com cache longa', media.status === 200 && media.headers.get('content-type') === 'image/webp' && media.headers.get('cache-control').includes('immutable'));

    // Reenvio, endereço repetido, leitura, lista
    const replay = await call('POST', `${API}/`, { body: article(cars), headers: { 'Idempotency-Key': 'artigo-1' } });
    check('reenvio com a mesma Idempotency-Key → 200 sem duplicar', replay.status === 200 && replay.json.idempotentReplay === true && replay.json.id === post.id);
    const dup = await call('POST', `${API}/`, { body: article(cars) });
    check('endereço repetido → 409 com existingId', dup.status === 409 && dup.json.existingId === post.id);
    const one = await call('GET', `${API}/${post.id}/`);
    check('GET de um artigo com SEO', one.status === 200 && typeof one.json.seo?.score === 'number');
    check('artigo inexistente → 404', (await call('GET', `${API}/9999/`)).status === 404);

    // Mudar o endereço cria um redirect permanente
    const moved = await call('PATCH', `${API}/${post.id}/`, { body: { slug: 'comprar-carro-usado-guia' } });
    check('PATCH com novo endereço → 200', moved.status === 200 && moved.json.slug === 'comprar-carro-usado-guia', moved.text.slice(0, 200));
    const old = await call('GET', `${BASE}/blog/${post.slug}/`, { token: null });
    check('endereço antigo → 301 para o novo', old.status === 301 && old.headers.get('location') === '/blog/comprar-carro-usado-guia/');
    check('lista da API tem o artigo', (await call('GET', `${API}/`)).json.articles.some((a) => a.id === post.id && !('contentHtml' in a)));

    // Rascunho não é público
    const draft = await call('POST', `${API}/`, { body: article(cars, { title: 'Rascunho: guia de inspeção periódica obrigatória', status: 'draft', featuredImage: null }) });
    check('rascunho criado → 201', draft.status === 201, draft.text.slice(0, 200));
    check('rascunho não é público → 404', (await call('GET', `${BASE}/blog/${draft.json?.slug}/`, { token: null })).status === 404);

    // Blog, RSS, sitemap, menu
    const index = await call('GET', `${BASE}/blog/`, { token: null });
    check('/blog/ lista só os publicados', index.status === 200 && index.text.includes('/blog/comprar-carro-usado-guia/') && !index.text.includes(draft.json?.slug));
    check('/blog/page/2/ não existe → 404', (await call('GET', `${BASE}/blog/page/2/`, { token: null })).status === 404);
    const feed = await call('GET', `${BASE}/feed/`, { token: null });
    check('RSS com o artigo', feed.status === 200 && feed.text.includes('<link>https://zonaauto.pt/blog/comprar-carro-usado-guia/</link>'));
    const sitemap = await call('GET', `${BASE}/sitemap.xml`, { token: null });
    check('sitemap com o artigo e lastmod', /<loc>https:\/\/zonaauto\.pt\/blog\/comprar-carro-usado-guia\/<\/loc><lastmod>/.test(sitemap.text) && !sitemap.text.includes(draft.json?.slug));
    check('"Blog" no menu', (await call('GET', `${BASE}/`, { token: null })).text.includes('<a href="/blog/" >Blog</a>'));

    // Artigo que não veio da API não se mexe por ela
    const { Firestore } = require('@google-cloud/firestore');
    process.env.FIRESTORE_EMULATOR_HOST = EMULATOR;
    const fdb = new Firestore({ projectId: 'zonaauto-local' });
    await fdb.collection('posts').doc('500').set({ id: 500, slug: 'manual', title: 'Artigo manual de teste', status: 'draft', createdVia: 'manual', contentHtml: '<p>x</p>', updatedAt: new Date() });
    await new Promise((r) => setTimeout(r, 50));
    check('PATCH de artigo não criado pela API → 403', (await call('PATCH', `${API}/500/`, { body: { title: 'Outro título de teste' } })).status === 403);

    // Despublicar e apagar criam redirects para /blog/
    const unpub = await call('PATCH', `${API}/${post.id}/`, { body: { status: 'draft' } });
    check('despublicar → 200', unpub.status === 200);
    const gone = await call('GET', `${BASE}/blog/comprar-carro-usado-guia/`, { token: null });
    check('artigo despublicado → 301 para /blog/', gone.status === 301 && gone.headers.get('location') === '/blog/');
    const repub = await call('PATCH', `${API}/${post.id}/`, { body: { status: 'published' } });
    check('voltar a publicar → página de novo no ar', repub.status === 200 && (await call('GET', `${BASE}/blog/comprar-carro-usado-guia/`, { token: null })).status === 200);
    const del = await call('DELETE', `${API}/${post.id}/`);
    check('apagar → 200', del.status === 200 && del.json.deleted === true);
    const afterDel = await call('GET', `${BASE}/blog/comprar-carro-usado-guia/`, { token: null });
    check('artigo apagado → 301 para /blog/', afterDel.status === 301 && afterDel.headers.get('location') === '/blog/');
    check('artigo apagado → 404 na API', (await call('GET', `${API}/${post.id}/`)).status === 404);

    // Limpeza de imagens (recentes: nada é apagado)
    const clean = await call('POST', `${BASE}/tarefas/limpar-imagens?token=sync-teste`, { token: null });
    check('limpeza de imagens corre e não apaga imagens recentes', clean.status === 200 && clean.json.deleted === 0, clean.text);
  } catch (err) {
    failures.push(`erro inesperado: ${err.stack}`);
    console.error(err);
  } finally {
    site.kill();
    bank.close();
    fs.rmSync(mediaDir, { recursive: true, force: true });
  }
  console.log(`\n${passed} verificações passaram, ${failures.length} falharam.`);
  if (failures.length) {
    console.log('\nRegisto do site:\n' + log.split('\n').slice(-30).join('\n'));
    process.exit(1);
  }
  process.exit(0);
})();
