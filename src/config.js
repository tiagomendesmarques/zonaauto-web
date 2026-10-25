// Configuração do stand. Os valores marcados com TODO têm de ser confirmados
// com o site atual (zonaauto.pt) — podem também ser definidos por variáveis de ambiente.
const env = process.env;

module.exports = {
  port: Number(env.PORT || 8080),
  siteUrl: (env.SITE_URL || 'https://zonaauto.pt').replace(/\/$/, ''),

  // Origem do inventário
  standvirtual: {
    inventoryUrl: env.SV_INVENTORY_URL || 'https://zonaautopt.standvirtual.com/inventory',
    maxPages: Number(env.SV_MAX_PAGES || 20),
    concurrency: Number(env.SV_CONCURRENCY || 4),
    userAgent:
      env.SV_USER_AGENT ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  },

  // De quanto em quanto tempo o inventário é atualizado (minutos)
  refreshMinutes: Number(env.REFRESH_MINUTES || 30),
  // Bucket GCS opcional para guardar o último inventário (arranques rápidos no Cloud Run)
  snapshotBucket: env.SNAPSHOT_BUCKET || '',
  // Token para o endpoint /tarefas/sincronizar (Cloud Scheduler)
  syncToken: env.SYNC_TOKEN || '',

  stand: {
    name: env.STAND_NAME || 'Zona Auto',
    slogan: env.STAND_SLOGAN || 'Automóveis usados com confiança', // TODO confirmar
    phone: env.STAND_PHONE || '', // TODO
    whatsapp: env.STAND_WHATSAPP || '', // TODO só dígitos, ex: 351912345678
    email: env.STAND_EMAIL || '', // TODO
    address: env.STAND_ADDRESS || '', // TODO
    mapsEmbedUrl: env.STAND_MAPS_EMBED || '', // TODO
    hours: (env.STAND_HOURS || '').split('|').filter(Boolean), // TODO ex: "Seg–Sex: 9h–19h|Sáb: 9h–13h"
    facebook: env.STAND_FACEBOOK || '',
    instagram: env.STAND_INSTAGRAM || '',
  },
};
