// Artigos do blog, redirects, auditoria e limite de pedidos, guardados no Firestore.
// Para não gastar leituras, a lista de artigos (sem o texto) fica em memória durante um minuto.
// Localmente usa-se o emulador (FIRESTORE_EMULATOR_HOST).
const { Firestore, Timestamp, FieldValue } = require('@google-cloud/firestore');

const CACHE_MS = 60 * 1000;
// Campos da lista (tudo menos o texto, as perguntas e as fontes)
const META_FIELDS = [
  'id', 'slug', 'title', 'excerpt', 'status', 'publishedAt', 'createdAt', 'updatedAt', 'seoTitle', 'seoDescription',
  'focusKeyword', 'secondaryKeywords', 'tags', 'featuredImageKey', 'featuredImageUrl', 'featuredImageAlt', 'createdVia',
];

let db = null;
function firestore() {
  if (!db) {
    db = new Firestore({
      ignoreUndefinedProperties: true,
      ...(process.env.FIRESTORE_EMULATOR_HOST && !process.env.GOOGLE_CLOUD_PROJECT ? { projectId: 'zonaauto-local' } : {}),
    });
  }
  return db;
}
const posts = () => firestore().collection('posts');

// Datas do Firestore → Date
function fromDoc(snap) {
  const data = snap.data();
  for (const k of ['publishedAt', 'createdAt', 'updatedAt']) if (data[k] instanceof Timestamp) data[k] = data[k].toDate();
  return data;
}

const cache = { meta: null, metaAt: 0, full: new Map(), redirects: null, redirectsAt: 0 };
function invalidate() {
  cache.meta = null;
  cache.full.clear();
  cache.redirects = null;
}

// Todos os artigos, sem o texto (rascunhos incluídos), do mais recente para o mais antigo.
async function listMeta() {
  if (cache.meta && Date.now() - cache.metaAt < CACHE_MS) return cache.meta;
  const snap = await posts().select(...META_FIELDS).get();
  cache.meta = snap.docs.map(fromDoc).sort((a, b) => b.id - a.id);
  cache.metaAt = Date.now();
  return cache.meta;
}

async function listPublished() {
  return (await listMeta())
    .filter((p) => p.status === 'published')
    .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
}

async function getById(id) {
  if (!Number.isInteger(id) || id <= 0) return null;
  const hit = cache.full.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.post;
  const snap = await posts().doc(String(id)).get();
  const post = snap.exists ? fromDoc(snap) : null;
  cache.full.set(id, { post, at: Date.now() });
  return post;
}

async function getBySlug(slug) {
  const meta = (await listMeta()).find((p) => p.slug === slug);
  return meta ? getById(meta.id) : null;
}

async function findByIdempotencyKey(key) {
  const snap = await posts().where('apiIdempotencyKey', '==', key).limit(1).get();
  return snap.empty ? null : fromDoc(snap.docs[0]);
}

// Artigo completo com o mesmo endereço (fora `exceptId`), lido dentro da transação.
async function slugOwner(tx, slug, exceptId) {
  const snap = await tx.get(posts().where('slug', '==', slug).limit(2));
  const doc = snap.docs.find((d) => d.data().id !== exceptId);
  return doc ? doc.data().id : null;
}

/**
 * Cria um artigo numa transação: confirma o endereço e a Idempotency-Key e dá-lhe o número seguinte.
 * Devolve { post } | { replay: post } | { slugTakenBy: id }.
 */
async function createPost(values, idempotencyKey) {
  const counter = firestore().collection('counters').doc('posts');
  const result = await firestore().runTransaction(async (tx) => {
    if (idempotencyKey) {
      const dup = await tx.get(posts().where('apiIdempotencyKey', '==', idempotencyKey).limit(1));
      if (!dup.empty) return { replay: fromDoc(dup.docs[0]) };
    }
    const taken = await slugOwner(tx, values.slug, null);
    if (taken) return { slugTakenBy: taken };
    const c = await tx.get(counter);
    const id = (c.exists ? c.data().last : 0) + 1;
    const now = new Date();
    const post = { ...values, id, createdAt: now, updatedAt: now, apiIdempotencyKey: idempotencyKey || null };
    tx.set(counter, { last: id });
    tx.create(posts().doc(String(id)), post);
    return { post };
  });
  invalidate();
  return result;
}

// Atualiza um artigo; devolve { post } | { slugTakenBy: id }.
async function updatePost(id, values) {
  const result = await firestore().runTransaction(async (tx) => {
    const ref = posts().doc(String(id));
    const snap = await tx.get(ref);
    if (!snap.exists) return { notFound: true };
    if (values.slug) {
      const taken = await slugOwner(tx, values.slug, id);
      if (taken) return { slugTakenBy: taken };
    }
    const post = { ...fromDoc(snap), ...values, updatedAt: new Date() };
    tx.set(ref, post);
    return { post };
  });
  invalidate();
  return result;
}

async function deletePost(id) {
  await posts().doc(String(id)).delete();
  invalidate();
}

// Todos os artigos completos (para a limpeza de imagens)
async function listFull() {
  return (await posts().get()).docs.map(fromDoc);
}

// ---------- redirects ----------
const redirectId = (from) => encodeURIComponent(from);

async function redirectMap() {
  if (cache.redirects && Date.now() - cache.redirectsAt < CACHE_MS) return cache.redirects;
  const snap = await firestore().collection('redirects').get();
  cache.redirects = new Map(snap.docs.map((d) => [d.data().fromPath, d.data()]));
  cache.redirectsAt = Date.now();
  return cache.redirects;
}

// Cria (ou atualiza) um redirect permanente. Um caminho nunca redireciona para si próprio.
async function addRedirect(fromPath, toPath, note) {
  if (fromPath === toPath) return;
  await firestore().collection('redirects').doc(redirectId(fromPath))
    .set({ fromPath, toPath, statusCode: 301, note, createdAt: new Date() });
  cache.redirects = null;
}

async function removeRedirect(fromPath) {
  await firestore().collection('redirects').doc(redirectId(fromPath)).delete();
  cache.redirects = null;
}

// ---------- auditoria e limite de pedidos ----------
async function audit(action, entityId, data) {
  await firestore().collection('audit_log').add({ action, entity: 'post', entityId: String(entityId), data, at: new Date() });
}

// true se ainda houver pedidos disponíveis nesta janela (ex.: 300 por hora).
async function rateLimit(name, limit, windowSec) {
  const start = Math.floor(Date.now() / 1000 / windowSec) * windowSec;
  const ref = firestore().collection('rate_limits').doc(`${name}-${start}`);
  return firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? snap.data().count : 0;
    if (count >= limit) return false;
    tx.set(ref, { count: FieldValue.increment(1), expireAt: new Date((start + windowSec * 2) * 1000) }, { merge: true });
    return true;
  });
}

module.exports = {
  listMeta, listPublished, listFull, getById, getBySlug, findByIdempotencyKey, createPost, updatePost, deletePost,
  redirectMap, addRedirect, removeRedirect, audit, rateLimit, invalidate,
};
