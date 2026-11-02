// Pontuação SEO de um artigo (0–100), com erros (impedem a API de gravar) e avisos (baixam a nota).
// Função pura: não toca na base de dados.
const { normalizeText, stripHtml, slugify } = require('./text');

const SEO_LIMITS = Object.freeze({
  titleMin: 10, titleMax: 100,
  seoTitleIdeal: 60, seoTitleMax: 70,
  seoDescriptionMin: 70, seoDescriptionIdeal: 155, seoDescriptionMax: 170,
  minWords: 300,
});

const SITE_HOST = /^https?:\/\/(www\.)?zonaauto\.pt/i;

// Endereço interno normalizado ("/stock" → "/stock/", sem ? nem #), ou null se a ligação for externa.
function internalPath(href) {
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return null;
  let path;
  if (SITE_HOST.test(href)) path = href.replace(SITE_HOST, '') || '/';
  else if (href.startsWith('/') && !href.startsWith('//')) path = href;
  else return null;
  path = path.split('#')[0].split('?')[0] || '/';
  return path.endsWith('/') ? path : `${path}/`;
}

const words = (s) => s.split(/\s+/).filter(Boolean).length;

/**
 * a: { title, slug, seoTitle, seoDescription, excerpt, contentHtml, focusKeyword, hasFeaturedImage,
 *      featuredImageAlt, faq, sources, internalLinkExists(path) }
 */
function checkSeo(a) {
  const errors = [];
  const warnings = [];
  let points = 0;
  let max = 0;
  const award = (weight, ok, warning) => {
    max += weight;
    if (ok) points += weight;
    else if (warning) warnings.push(warning);
  };

  const html = a.contentHtml || '';
  const text = stripHtml(html);
  const total = words(text);
  const nText = normalizeText(text);
  const kw = a.focusKeyword && a.focusKeyword.trim() ? normalizeText(a.focusKeyword) : '';
  const has = (s) => Boolean(kw && s && normalizeText(stripHtml(s)).includes(kw));
  const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => m[1]);
  const firstP = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  const firstParagraph = firstP ? firstP[1] : text.slice(0, 400);
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const imgsNoAlt = imgs.filter((tag) => !/\balt\s*=\s*"[^"]*\S[^"]*"/i.test(tag)).length;
  const hrefs = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*"([^"]+)"/gi)].map((m) => m[1]);
  const internal = hrefs.map(internalPath).filter((p) => p !== null);
  const external = hrefs.filter((h) => /^https?:\/\//i.test(h) && internalPath(h) === null);
  const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => words(stripHtml(m[1])));
  const occurrences = kw ? nText.split(kw).length - 1 : 0;
  const density = kw && total ? (occurrences * kw.split(' ').length * 100) / total : 0;
  const title = (a.title || '').trim();
  const seoTitle = (a.seoTitle || '').trim() || title;
  const seoDescription = (a.seoDescription || '').trim();
  const faq = a.faq || [];

  // Erros: o artigo não deve ser gravado assim.
  if (title.length < SEO_LIMITS.titleMin || title.length > SEO_LIMITS.titleMax) errors.push(`O título tem de ter entre ${SEO_LIMITS.titleMin} e ${SEO_LIMITS.titleMax} caracteres.`);
  if (total < SEO_LIMITS.minWords) errors.push(`O texto tem ${total} palavras; o mínimo são ${SEO_LIMITS.minWords}.`);
  if (/<h1[\s>]/i.test(html)) errors.push('O texto não pode ter <h1>: o título do artigo já é o <h1>. Use <h2> e <h3>.');
  if (imgsNoAlt) errors.push(`${imgsNoAlt} imagem(ns) no texto sem texto alternativo (alt).`);
  if (a.hasFeaturedImage && !(a.featuredImageAlt || '').trim()) errors.push('A imagem de destaque precisa de texto alternativo (alt).');
  if (seoTitle.length > SEO_LIMITS.seoTitleMax) errors.push(`O título para o Google tem ${seoTitle.length} caracteres; o máximo são ${SEO_LIMITS.seoTitleMax}.`);
  if (seoDescription.length > SEO_LIMITS.seoDescriptionMax) errors.push(`A descrição para o Google tem ${seoDescription.length} caracteres; o máximo são ${SEO_LIMITS.seoDescriptionMax}.`);
  if (a.internalLinkExists) {
    const broken = [...new Set(internal.filter((p) => !a.internalLinkExists(p)))];
    if (broken.length) errors.push(`Ligações internas para páginas que não existem: ${broken.join(', ')}`);
  }
  if (faq.some((f) => !(f.question || '').trim() || !(f.answer || '').trim())) errors.push('Há perguntas frequentes sem pergunta ou sem resposta.');

  // Pontuação e avisos.
  award(5, Boolean(kw), 'Indique a palavra-chave principal.');
  if (kw) {
    award(10, has(title), 'A palavra-chave não está no título.');
    award(5, has(seoTitle), 'A palavra-chave não está no título para o Google.');
    award(5, has(seoDescription), 'A palavra-chave não está na descrição para o Google.');
    award(5, (a.slug || '').includes(slugify(a.focusKeyword)), 'A palavra-chave não está no endereço.');
    award(10, has(firstParagraph), 'A palavra-chave não aparece no primeiro parágrafo.');
    award(5, h2s.some((h) => has(h)), 'A palavra-chave não aparece em nenhum intertítulo (<h2>).');
    award(5, density >= 0.5 && density <= 2.5, density > 2.5
      ? `A palavra-chave aparece demasiadas vezes (${density.toFixed(1)}%); escreva de forma natural.`
      : `A palavra-chave aparece pouco no texto (${density.toFixed(1)}%).`);
  } else {
    max += 45; // as 7 regras da palavra-chave contam como falhadas
  }
  award(5, seoTitle.length >= 30 && seoTitle.length <= SEO_LIMITS.seoTitleIdeal, `O título para o Google deve ter 30 a ${SEO_LIMITS.seoTitleIdeal} caracteres (tem ${seoTitle.length}).`);
  award(5, seoDescription.length >= SEO_LIMITS.seoDescriptionMin && seoDescription.length <= SEO_LIMITS.seoDescriptionIdeal,
    seoDescription ? `A descrição para o Google deve ter ${SEO_LIMITS.seoDescriptionMin} a ${SEO_LIMITS.seoDescriptionIdeal} caracteres (tem ${seoDescription.length}).` : 'Escreva a descrição para o Google.');
  award(5, total >= 900, `Texto curto (${total} palavras): os artigos que ficam bem no Google têm normalmente 900 ou mais.`);
  award(5, total >= 1200);
  award(5, h2s.length >= 3, 'Use pelo menos 3 intertítulos (<h2>) para organizar o texto.');
  award(10, internal.length >= 3, `Ponha pelo menos 3 ligações para outras páginas do site (tem ${internal.length}).`);
  award(5, external.length >= 1, 'Ponha pelo menos uma ligação para uma fonte externa fiável.');
  award(5, Boolean(a.hasFeaturedImage), 'Falta a imagem de destaque.');
  award(5, faq.length >= 3, 'Acrescente pelo menos 3 perguntas frequentes.');
  award(5, Boolean((a.excerpt || '').trim()), 'Escreva um resumo curto.');
  award(5, !paragraphs.some((n) => n > 150), 'Há parágrafos muito longos (mais de 150 palavras); divida-os.');
  if ((a.sources || []).length === 0 && external.length === 0) warnings.push('Sem fontes: em temas legais ou fiscais (IUC, ISV, inspeções, garantias), indique de onde vem a informação.');

  return {
    score: Math.round((points / max) * 100),
    errors,
    warnings,
    stats: {
      words: total, h2: h2s.length, internalLinks: internal.length, externalLinks: external.length,
      images: imgs.length, faq: faq.length, keywordDensity: Math.round(density * 10) / 10,
    },
  };
}

module.exports = { checkSeo, internalPath, SEO_LIMITS };
