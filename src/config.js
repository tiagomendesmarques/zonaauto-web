// Configuração do site. Os valores por omissão são os do zonaauto.pt atual;
// todos podem ser alterados por variáveis de ambiente (ver env.example.yaml).
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

  // Envio dos formulários por email (SMTP). Sem isto, os pedidos seguem por WhatsApp.
  mail: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 465),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    to: env.MAIL_TO || env.STAND_EMAIL || 'geral@zonaauto.pt',
  },

  stand: {
    name: env.STAND_NAME || 'Zona Auto',
    tagline: env.STAND_TAGLINE || 'A tua referência no mundo automóvel. Ligamos pessoas a carros com transparência, rapidez e confiança.',
    phone: env.STAND_PHONE || '+351 912 347 926',
    whatsapp: env.STAND_WHATSAPP || '351912347926',
    email: env.STAND_EMAIL || 'geral@zonaauto.pt',
    street: env.STAND_STREET || 'R. João Ortigão Ramos 30B',
    city: env.STAND_CITY || '1500-062 Lisboa',
    hours: (env.STAND_HOURS || 'Segunda a sexta|9h às 19h|Sábado|11h às 17h').split('|'),
    facebook: env.STAND_FACEBOOK || 'https://www.facebook.com/ZonaAuto',
    instagram: env.STAND_INSTAGRAM || 'https://www.instagram.com/zonaautopt/',
  },
};
