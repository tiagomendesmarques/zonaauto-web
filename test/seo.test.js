const test = require('node:test');
const assert = require('node:assert/strict');
const { checkSeo, internalPath } = require('../src/blog/seo');

const para = (n, word = 'carro') => `<p>${Array.from({ length: n }, (_, i) => (i % 60 === 0 ? word : `palavra${i}`)).join(' ')}.</p>`;

// Artigo completo e bem feito: deve passar sem erros e com nota alta.
function goodArticle(overrides = {}) {
  const kw = 'carro usado';
  const body = [
    `<p>Comprar um ${kw} em Lisboa exige alguns cuidados que explicamos neste guia.</p>`,
    `<h2>Como escolher um ${kw}</h2>`, para(120, kw), para(120),
    '<h2>Documentos a pedir</h2>', para(120), `<p>Veja o <a href="/stock/">nosso stock</a> e a <a href="/importacao/">importação</a>.</p>`,
    '<h2>Financiamento</h2>', para(120, kw), para(120), `<p>Fale connosco em <a href="/contactos/">contactos</a> ou consulte o <a href="https://www.imt-ip.pt/">IMT</a>.</p>`,
    para(120), para(120), para(120, kw),
  ].join('');
  return {
    title: `Como comprar um ${kw} sem surpresas`,
    slug: 'como-comprar-um-carro-usado-sem-surpresas',
    seoTitle: `Comprar ${kw}: guia completo para 2026`,
    seoDescription: `O que verificar antes de comprar um ${kw}: documentos, inspeção, quilómetros e financiamento, explicado passo a passo.`,
    excerpt: 'Guia prático para comprar carro usado.',
    contentHtml: body,
    focusKeyword: kw,
    hasFeaturedImage: true,
    featuredImageAlt: 'Carro usado num stand',
    faq: [{ question: 'Pergunta um?', answer: 'Resposta um.' }, { question: 'Pergunta dois?', answer: 'Resposta dois.' }, { question: 'Pergunta três?', answer: 'Resposta três.' }],
    sources: [{ title: 'IMT', url: 'https://www.imt-ip.pt/' }],
    internalLinkExists: (p) => ['/stock/', '/importacao/', '/contactos/'].includes(p),
    ...overrides,
  };
}

test('artigo bom: sem erros e nota ≥ 90', () => {
  const r = checkSeo(goodArticle());
  assert.deepEqual(r.errors, []);
  assert.ok(r.score >= 90, `nota ${r.score}: ${r.warnings.join(' | ')}`);
  assert.equal(r.stats.h2, 3);
  assert.equal(r.stats.internalLinks, 3);
  assert.equal(r.stats.externalLinks, 1);
});

test('erros: <h1>, imagem sem alt, título curto, texto curto, limites do Google, FAQ incompleta', () => {
  assert.ok(checkSeo(goodArticle({ contentHtml: goodArticle().contentHtml + '<h1>X</h1>' })).errors.some((e) => e.includes('<h1>')));
  assert.ok(checkSeo(goodArticle({ contentHtml: goodArticle().contentHtml + '<img src="/a.jpg">' })).errors.some((e) => e.includes('alt')));
  assert.ok(checkSeo(goodArticle({ contentHtml: goodArticle().contentHtml + '<img src="/a.jpg" alt="  ">' })).errors.some((e) => e.includes('alt')));
  assert.ok(checkSeo(goodArticle({ title: 'Curto' })).errors.some((e) => e.includes('título tem de ter')));
  assert.ok(checkSeo(goodArticle({ contentHtml: '<p>pouco texto</p>' })).errors.some((e) => e.includes('palavras')));
  assert.ok(checkSeo(goodArticle({ seoTitle: 'x'.repeat(71) })).errors.some((e) => e.includes('título para o Google')));
  assert.ok(checkSeo(goodArticle({ seoDescription: 'x'.repeat(171) })).errors.some((e) => e.includes('descrição')));
  assert.ok(checkSeo(goodArticle({ featuredImageAlt: '' })).errors.some((e) => e.includes('destaque')));
  assert.ok(checkSeo(goodArticle({ faq: [{ question: 'Pergunta?', answer: '' }] })).errors.some((e) => e.includes('perguntas')));
});

test('ligações internas partidas são listadas', () => {
  const html = goodArticle().contentHtml + '<p><a href="/nao-existe">x</a> <a href="https://zonaauto.pt/tambem-nao?x=1#a">y</a></p>';
  const r = checkSeo(goodArticle({ contentHtml: html }));
  const e = r.errors.find((x) => x.includes('não existem'));
  assert.ok(e && e.includes('/nao-existe/') && e.includes('/tambem-nao/'), e);
});

test('acentos não contam: "Café" = "cafe"', () => {
  const r = checkSeo(goodArticle({ focusKeyword: 'Usado Carró', title: 'Guia do usado carro para quem procura' }));
  assert.ok(!r.warnings.includes('A palavra-chave não está no título.'));
});

test('palavra-chave a mais dá aviso', () => {
  const spam = Array.from({ length: 320 }, () => 'carro usado').join(' ');
  const r = checkSeo(goodArticle({ contentHtml: `<p>${spam}</p>` }));
  assert.ok(r.warnings.some((w) => w.includes('demasiadas vezes')));
});

test('sem palavra-chave: as regras dela contam como falhadas', () => {
  const r = checkSeo(goodArticle({ focusKeyword: '' }));
  assert.ok(r.score <= 60, String(r.score));
  assert.ok(r.warnings.includes('Indique a palavra-chave principal.'));
});

test('normalização de ligações internas', () => {
  assert.equal(internalPath('/stock'), '/stock/');
  assert.equal(internalPath('/stock/?marca=Toyota#topo'), '/stock/');
  assert.equal(internalPath('https://www.zonaauto.pt/blog/x'), '/blog/x/');
  assert.equal(internalPath('https://zonaauto.pt'), '/');
  assert.equal(internalPath('//outro.pt/x'), null);
  assert.equal(internalPath('https://imt-ip.pt/'), null);
  assert.equal(internalPath('mailto:a@b.pt'), null);
  assert.equal(internalPath('#secao'), null);
});
