// Serve as fotos do Standvirtual a partir do nosso domínio (/foto/<id>/<tamanho>.jpg).
// Assim o site não depende de "hotlinking" ao CDN da OLX e o browser guarda as fotos em cache.
const config = require('./config');

const CDN = 'https://ireland.apollo.olxcdn.com/v1/files/';
const SIZES = new Set(['200x150', '640x480', '1280x960']);
const MAX_ENTRIES = 300;
const cache = new Map(); // LRU simples em memória: chave -> Buffer

// URL do CDN -> caminho local; devolve null se não for uma foto do Standvirtual
function localPath(url, size) {
  const m = /^https:\/\/ireland\.apollo\.olxcdn\.com\/v1\/files\/([^/;]+)\/image/.exec(url || '');
  return m ? `/foto/${m[1]}/${size}.jpg` : null;
}

async function handler(req, res) {
  const { id, size } = req.params;
  if (!SIZES.has(size) || !/^[\w.-]{20,1200}$/.test(id)) return res.sendStatus(404);
  const key = `${id}/${size}`;
  let body = cache.get(key);
  if (body) {
    cache.delete(key);
    cache.set(key, body);
  } else {
    try {
      const r = await fetch(`${CDN}${id}/image;s=${size}`, { headers: { 'User-Agent': config.standvirtual.userAgent } });
      if (!r.ok || !/^image\//.test(r.headers.get('content-type') || '')) return res.sendStatus(r.status === 404 ? 404 : 502);
      body = Buffer.from(await r.arrayBuffer());
    } catch {
      return res.sendStatus(502);
    }
    cache.set(key, body);
    if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
  }
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=2592000, immutable' });
  res.send(body);
}

module.exports = { localPath, handler };
