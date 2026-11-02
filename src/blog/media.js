// Imagens do blog guardadas em WebP (400, 800 e 1600 px), servidas em /media/{key}-{w}.webp.
// Em produção ficam no bucket do inventário (pasta "media/"); localmente, na pasta MEDIA_DIR.
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const config = require('../config');

const IMAGE_WIDTHS = [400, 800, 1600];
const PREFIX = 'media/';
const mediaDir = () => process.env.MEDIA_DIR || path.join(__dirname, '..', '..', 'data', 'media');

let bucket = null;
function getBucket() {
  if (!config.snapshotBucket) return null;
  if (!bucket) {
    const { Storage } = require('@google-cloud/storage');
    bucket = new Storage().bucket(config.snapshotBucket);
  }
  return bucket;
}

function localPath(file) {
  const root = path.resolve(mediaDir());
  const p = path.resolve(root, file);
  if (!p.startsWith(root + path.sep)) throw new Error('caminho inválido');
  return p;
}

const store = {
  async put(file, data) {
    const b = getBucket();
    if (b) {
      await b.file(PREFIX + file).save(data, {
        resumable: false,
        contentType: 'image/webp',
        metadata: { cacheControl: 'public, max-age=31536000, immutable' },
      });
      return;
    }
    const p = localPath(file);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data);
  },
  async get(file) {
    const b = getBucket();
    try {
      if (b) return (await b.file(PREFIX + file).download())[0];
      return await fs.readFile(localPath(file));
    } catch (err) {
      if (err.code === 404 || err.code === 'ENOENT') return null;
      throw err;
    }
  },
  // Todos os ficheiros (nome relativo → data da última alteração)
  async list() {
    const out = new Map();
    const b = getBucket();
    if (b) {
      const [files] = await b.getFiles({ prefix: PREFIX, autoPaginate: true });
      for (const f of files) {
        if (f.name.endsWith('.webp')) out.set(f.name.slice(PREFIX.length), new Date(f.metadata.updated || f.metadata.timeCreated || 0));
      }
      return out;
    }
    let entries = [];
    try {
      entries = await fs.readdir(mediaDir(), { recursive: true });
    } catch {
      return out;
    }
    for (const rel of entries) {
      if (rel.endsWith('.webp')) out.set(rel.split(path.sep).join('/'), (await fs.stat(localPath(rel))).mtime);
    }
    return out;
  },
  async remove(file) {
    const b = getBucket();
    if (b) await b.file(PREFIX + file).delete({ ignoreNotFound: true });
    else await fs.rm(localPath(file), { force: true });
  },
};

// Converte para WebP nos 3 tamanhos (corrigindo a orientação EXIF) e guarda. Falha se a imagem não for legível.
async function storeImage(key, input) {
  const img = sharp(input, { failOn: 'error' }).rotate();
  const meta = await img.metadata();
  const swap = meta.orientation >= 5; // rotações de 90°: largura e altura trocam
  const width = (swap ? meta.height : meta.width) || 0;
  const height = (swap ? meta.width : meta.height) || 0;
  for (const w of IMAGE_WIDTHS) {
    const out = await img.clone().resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    await store.put(`${key}-${w}.webp`, out);
  }
  return { width, height };
}

const mediaUrl = (key, width = 800) => `/media/${key}-${width}.webp`;
const mediaSrcSet = (key) => IMAGE_WIDTHS.map((w) => `${mediaUrl(key, w)} ${w}w`).join(', ');

// Chaves (sem "-{w}.webp") de todas as imagens guardadas, com a data do ficheiro mais recente.
async function listMediaKeys() {
  const keys = new Map();
  for (const [file, date] of await store.list()) {
    const m = file.match(/^(.+)-(\d+)\.webp$/);
    if (!m) continue;
    const prev = keys.get(m[1]);
    if (!prev || date > prev) keys.set(m[1], date);
  }
  return keys;
}

async function deleteMedia(key) {
  await Promise.all(IMAGE_WIDTHS.map((w) => store.remove(`${key}-${w}.webp`)));
}

// Rota /media/*: só nomes do tipo "blog/<id>-<largura>.webp".
async function handler(req, res) {
  const file = req.params[0];
  if (!/^blog\/[\w-]+-(400|800|1600)\.webp$/.test(file)) return res.sendStatus(404);
  try {
    const data = await store.get(file);
    if (!data) return res.sendStatus(404);
    res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.send(data);
  } catch (err) {
    console.error(`[media] ${file}: ${err.message}`);
    res.sendStatus(502);
  }
}

module.exports = { IMAGE_WIDTHS, storeImage, mediaUrl, mediaSrcSet, listMediaKeys, deleteMedia, handler };
