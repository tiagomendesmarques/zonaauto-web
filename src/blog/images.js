// Imagens dos artigos vindas de bancos de imagens grátis.
//  - Pexels: o site descarrega e guarda uma cópia em WebP (3 tamanhos).
//  - Unsplash: fica nos servidores do Unsplash (as regras da API deles obrigam a isso), com crédito ao fotógrafo.
// Qualquer outro sítio é recusado.
const { randomUUID } = require('crypto');
const { storeImage, mediaUrl, mediaSrcSet } = require('./media');

const HOSTS = {
  'images.pexels.com': 'copy',
  'images.unsplash.com': 'link',
  'plus.unsplash.com': 'link',
};
const MAX_BYTES = 15 * 1024 * 1024;
const SIZES = '(min-width: 1024px) 760px, 100vw';

class ImageError extends Error {}

// Os testes usam um banco de imagens falso; em produção só os anfitriões reais.
const testOrigin = () => (process.env.NODE_ENV !== 'production' ? process.env.BLOG_IMAGE_TEST_ORIGIN || null : null);

function imageSource(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ImageError(`Endereço de imagem inválido: ${raw}`);
  }
  const test = testOrigin();
  if (test && url.origin === test) return { url, mode: 'copy' };
  const mode = HOSTS[url.hostname];
  if (url.protocol !== 'https:' || !mode) {
    throw new ImageError(`Só são aceites imagens do Pexels (images.pexels.com) ou do Unsplash (images.unsplash.com): ${raw}`);
  }
  return { url, mode };
}

// Endereço do Unsplash com a largura pedida, mantendo os parâmetros que já tinha.
function unsplashSized(raw, width) {
  const url = new URL(raw);
  url.searchParams.set('w', String(width));
  url.searchParams.set('q', '80');
  url.searchParams.set('auto', 'format');
  url.searchParams.set('fit', 'max');
  return url.toString();
}
const unsplashSrcSet = (raw) => [400, 800, 1600].map((w) => `${unsplashSized(raw, w)} ${w}w`).join(', ');

// Descarrega uma imagem permitida e guarda-a (Pexels), ou confirma que existe (Unsplash).
async function importImage(raw) {
  const { url, mode } = imageSource(raw);
  let res;
  try {
    res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  } catch (err) {
    throw new ImageError(`Não foi possível obter a imagem ${raw}: ${err.message}`);
  }
  if (res.status !== 200) throw new ImageError(`A imagem ${raw} respondeu ${res.status}.`);
  if (!(res.headers.get('content-type') || '').startsWith('image/')) throw new ImageError(`O endereço ${raw} não é uma imagem.`);
  if (mode === 'link') {
    await res.body?.cancel();
    return { url: url.toString() };
  }
  if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) throw new ImageError(`A imagem ${raw} tem mais de 15 MB.`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new ImageError(`A imagem ${raw} tem mais de 15 MB.`);
  const key = `blog/${randomUUID()}`;
  try {
    return { key, ...(await storeImage(key, buf)) };
  } catch {
    throw new ImageError(`Não foi possível ler a imagem ${raw}.`);
  }
}

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// <img> do texto: as do Pexels passam a ser servidas pelo site, as do Unsplash ficam com tamanhos responsivos.
async function processInlineImages(html) {
  const tags = [...new Set(html.match(/<img\b[^>]*>/gi) || [])];
  for (const tag of tags) {
    const src = (tag.match(/\bsrc\s*=\s*"([^"]+)"/i) || [])[1];
    const alt = (tag.match(/\balt\s*=\s*"([^"]*)"/i) || [])[1] || '';
    if (!src || src.startsWith('/media/')) continue;
    const img = await importImage(src.replace(/&amp;/g, '&'));
    const replacement = img.key
      ? `<img src="${mediaUrl(img.key, 1600)}" srcset="${mediaSrcSet(img.key)}" sizes="${SIZES}" alt="${alt}" width="${img.width}" height="${img.height}" loading="lazy">`
      : `<img src="${escAttr(unsplashSized(img.url, 1600))}" srcset="${escAttr(unsplashSrcSet(img.url))}" sizes="${SIZES}" alt="${alt}" loading="lazy">`;
    html = html.split(tag).join(replacement);
  }
  return html;
}

// Imagem de destaque de um artigo, guardada no site ou do Unsplash.
function postImage(post, width) {
  if (post.featuredImageUrl) return { src: unsplashSized(post.featuredImageUrl, width), srcSet: unsplashSrcSet(post.featuredImageUrl) };
  if (post.featuredImageKey) return { src: mediaUrl(post.featuredImageKey, width), srcSet: mediaSrcSet(post.featuredImageKey) };
  return null;
}

module.exports = { ImageError, imageSource, unsplashSized, unsplashSrcSet, importImage, processInlineImages, postImage };
