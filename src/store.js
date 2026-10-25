// Guarda o inventário em memória e mantém-no atualizado.
//  - Ao arrancar carrega o último snapshot (GCS ou ficheiro local) para servir de imediato.
//  - Sempre que os dados ficam mais velhos que REFRESH_MINUTES, sincroniza em segundo plano.
//  - Se a sincronização falhar, continua a servir o último inventário válido.
const fs = require('fs/promises');
const path = require('path');
const config = require('./config');
const { scrapeInventory } = require('./scraper');

const LOCAL_SNAPSHOT = path.join(__dirname, '..', 'data', 'inventory.json');
const SNAPSHOT_OBJECT = 'inventory.json';

const state = { cars: [], updatedAt: null, lastError: null, lastAttempt: 0, syncing: null };

let bucket = null;
function getBucket() {
  if (!config.snapshotBucket) return null;
  if (!bucket) {
    const { Storage } = require('@google-cloud/storage');
    bucket = new Storage().bucket(config.snapshotBucket);
  }
  return bucket;
}

async function loadSnapshot() {
  try {
    let raw;
    const b = getBucket();
    if (b) [raw] = await b.file(SNAPSHOT_OBJECT).download();
    else raw = await fs.readFile(LOCAL_SNAPSHOT);
    const data = JSON.parse(raw.toString());
    state.cars = data.cars || [];
    state.updatedAt = data.updatedAt ? new Date(data.updatedAt) : null;
    console.log(`[store] snapshot carregado: ${state.cars.length} viaturas (${data.updatedAt})`);
  } catch (err) {
    console.log(`[store] sem snapshot (${err.code || err.message})`);
  }
}

async function saveSnapshot() {
  const body = JSON.stringify({ updatedAt: state.updatedAt, cars: state.cars });
  try {
    const b = getBucket();
    if (b) await b.file(SNAPSHOT_OBJECT).save(body, { contentType: 'application/json' });
    else {
      await fs.mkdir(path.dirname(LOCAL_SNAPSHOT), { recursive: true });
      await fs.writeFile(LOCAL_SNAPSHOT, body);
    }
  } catch (err) {
    console.error(`[store] não foi possível guardar snapshot: ${err.message}`);
  }
}

function sync() {
  if (state.syncing) return state.syncing;
  state.lastAttempt = Date.now();
  state.syncing = (async () => {
    try {
      const cars = await scrapeInventory();
      // Proteção: uma queda brusca (>60%) costuma indicar erro de leitura, não vendas.
      // Se o mesmo número se repetir na sincronização seguinte, aceita-se como real.
      if (state.cars.length >= 5 && cars.length < state.cars.length * 0.4 && state.suspectCount !== cars.length) {
        state.suspectCount = cars.length;
        throw new Error(`resultado suspeito: ${cars.length} viaturas (antes ${state.cars.length}), a confirmar`);
      }
      state.suspectCount = null;
      state.cars = cars;
      state.updatedAt = new Date();
      state.lastError = null;
      await saveSnapshot();
    } catch (err) {
      state.lastError = err.message;
      console.error(`[sync] erro: ${err.message}`);
    } finally {
      state.syncing = null;
    }
  })();
  return state.syncing;
}

function isStale() {
  // Depois de uma falha espera 2 minutos antes de tentar de novo.
  if (state.lastError && Date.now() - state.lastAttempt < 2 * 60 * 1000) return false;
  return !state.updatedAt || Date.now() - state.updatedAt.getTime() > config.refreshMinutes * 60 * 1000;
}

// Chamado em cada pedido: devolve logo o que existe e atualiza em segundo plano se necessário.
async function getCars() {
  if (!state.cars.length && !state.updatedAt && isStale()) await sync();
  else if (isStale()) sync();
  return state.cars;
}

async function init() {
  await loadSnapshot();
  if (isStale()) sync();
  // Em servidores sempre ligados atualiza também por temporizador.
  setInterval(() => isStale() && sync(), 60 * 1000).unref();
}

module.exports = { init, getCars, sync, state };
