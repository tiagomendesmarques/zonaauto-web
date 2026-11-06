// Área de gestão escondida (/gestao/): ver e tratar os contactos do simulador do apoio a carros elétricos.
// Entrada com a conta Google ("Iniciar sessão com o Google"); só entram os emails de ADMIN_EMAILS.
// Não há ligações para aqui no site, não entra no sitemap e as páginas pedem aos motores de busca para não as indexar.
//
// Variáveis (no Cloud Run; ver deploy/gestao-setup.sh):
//   GOOGLE_CLIENT_ID  ID do cliente OAuth (tipo "Aplicação Web") do projeto no GCP
//   ADMIN_EMAILS      emails autorizados, separados por vírgulas
// A sessão é assinada com uma chave derivada de ADMIN_SESSION_SECRET ou, se não existir, de BLOG_API_TOKEN.
const crypto = require('crypto');
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const config = require('./config');
const db = require('./blog/db');

const COOKIE = 'za_gestao';
const SESSION_HOURS = 12;
const ESTADOS = [
  ['novo', 'Novo'], ['contactado', 'Contactado'], ['interessado', 'Interessado'], ['sem-interesse', 'Sem interesse'],
];
const RESULTADOS = { ok: 'Tem direito', warn: 'Perto do limite', no: 'Acima do limite' };
const LABELS = {
  tarifaSocial: { sim: 'Sim', nao: 'Não', naosei: 'Não sabe' },
  abate: { sim: 'Sim', nao: 'Não' },
  pagamento: { prestacoes: 'Às prestações', pronto: 'Tudo de uma vez', naosei: 'Ainda não sabe' },
};

const adminEmails = () => (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const clientId = () => process.env.GOOGLE_CLIENT_ID || '';
function sessionKey() {
  const base = process.env.ADMIN_SESSION_SECRET || process.env.BLOG_API_TOKEN || '';
  return base.length >= 24 ? crypto.createHash('sha256').update(`zonaauto-gestao:${base}`).digest() : null;
}
// O que falta configurar (vazio = tudo pronto)
function missingConfig() {
  const out = [];
  if (!clientId()) out.push('GOOGLE_CLIENT_ID');
  if (!adminEmails().length) out.push('ADMIN_EMAILS');
  if (!sessionKey()) out.push('BLOG_API_TOKEN ou ADMIN_SESSION_SECRET');
  return out;
}

// ---------- sessão (cookie assinado) ----------
const b64url = (buf) => Buffer.from(buf).toString('base64url');
function signSession(email, now = Date.now(), key = sessionKey()) {
  const body = b64url(JSON.stringify({ email, exp: now + SESSION_HOURS * 3600 * 1000 }));
  const mac = crypto.createHmac('sha256', key).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function readSession(value, now = Date.now(), key = sessionKey()) {
  if (!value || !key) return null;
  const [body, mac] = String(value).split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', key).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!data.exp || data.exp < now) return null;
    // Quem deixar de estar na lista perde o acesso logo
    if (!adminEmails().includes(String(data.email).toLowerCase())) return null;
    return data;
  } catch {
    return null;
  }
}
function cookies(req) {
  const out = {};
  for (const part of (req.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const cookieOpts = (req) => ({ httpOnly: true, secure: req.secure, sameSite: 'lax', path: '/gestao' });

// ---------- CSV (separado por ";" e com BOM, para abrir bem no Excel em português) ----------
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita fórmulas
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function leadsCsv(leads) {
  const cols = [
    ['Data', (l) => fmtDateTime(l.criadoEm)], ['Nome', (l) => l.nome], ['Telemóvel', (l) => l.telemovel], ['Email', (l) => l.email],
    ['Resultado', (l) => RESULTADOS[l.resultado] || l.resultado], ['Tarifa Social', (l) => LABELS.tarifaSocial[l.tarifaSocial] || l.tarifaSocial],
    ['Pessoas 14+', (l) => l.pessoas14mais], ['Crianças', (l) => l.criancas], ['Rendimento mensal', (l) => l.rendimentoMensal],
    ['Abate', (l) => LABELS.abate[l.abate] || l.abate], ['Pagamento', (l) => LABELS.pagamento[l.pagamento] || l.pagamento],
    ['Estado', (l) => (ESTADOS.find(([k]) => k === l.estado) || [, l.estado])[1]], ['Nota', (l) => l.nota],
  ];
  const lines = [cols.map(([h]) => csvCell(h)).join(';'), ...leads.map((l) => cols.map(([, f]) => csvCell(f(l))).join(';'))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

const dtf = new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDateTime = (d) => (d ? dtf.format(d) : '');

// ---------- dados ----------
const leadsCol = () => db.firestore().collection('leads');
async function listLeads() {
  const snap = await db.guarded(() => leadsCol().orderBy('criadoEm', 'desc').limit(2000).get());
  return snap.docs.map((d) => {
    const data = d.data();
    return { ...data, id: d.id, criadoEm: data.criadoEm?.toDate ? data.criadoEm.toDate() : data.criadoEm, estado: data.estado || 'novo' };
  });
}

// ---------- rotas ----------
const router = express.Router();
router.use((req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'same-origin');
  req.admin = readSession(cookies(req)[COOKIE]);
  next();
});

// Pedidos que mudam dados só podem vir do próprio site
function sameOrigin(req) {
  const src = req.get('origin') || req.get('referer');
  if (!src) return false;
  try { return new URL(src).host === req.get('host'); } catch { return false; }
}
const requireAdmin = (req, res, next) => {
  if (!req.admin) return res.redirect(303, '/gestao/');
  if (req.method === 'POST' && !sameOrigin(req)) return res.status(403).send('Pedido recusado.');
  next();
};

const loginPage = (res, status, error) => res.status(status).render('gestao/entrar', {
  clientId: clientId(), loginUri: `${config.siteUrl}/gestao/entrar`, missing: missingConfig(), error,
});

router.get('/', async (req, res, next) => {
  if (!req.admin) return loginPage(res, 200, null);
  try {
    const all = await listLeads();
    const { resultado = '', estado = '', q = '' } = req.query;
    const term = String(q).trim().toLowerCase();
    const leads = all.filter((l) => (!resultado || l.resultado === resultado) && (!estado || l.estado === estado)
      && (!term || [l.nome, l.email, l.telemovel].some((v) => String(v || '').toLowerCase().includes(term))));
    const count = (f) => all.filter(f).length;
    res.render('gestao/leads', {
      admin: req.admin, leads, total: all.length, filters: { resultado, estado, q: term },
      counts: { novo: count((l) => l.estado === 'novo'), ok: count((l) => l.resultado === 'ok'), warn: count((l) => l.resultado === 'warn'), no: count((l) => l.resultado === 'no') },
      ESTADOS, RESULTADOS, LABELS, fmtDateTime, saved: req.query.ok,
    });
  } catch (err) {
    next(err);
  }
});

// O Google envia para aqui o "credential" (ID token) depois de a pessoa escolher a conta.
router.post('/entrar', async (req, res) => {
  if (missingConfig().length) return loginPage(res, 503, 'A área de gestão ainda não está configurada.');
  const csrf = req.body?.g_csrf_token;
  if (!csrf || csrf !== cookies(req).g_csrf_token) return loginPage(res, 400, 'O pedido de entrada não é válido. Tenta outra vez.');
  try {
    const ticket = await new OAuth2Client(clientId()).verifyIdToken({ idToken: String(req.body.credential || ''), audience: clientId() });
    const p = ticket.getPayload() || {};
    const email = String(p.email || '').toLowerCase();
    if (!p.email_verified || !adminEmails().includes(email)) {
      console.warn('[gestao] entrada recusada:', email || '(sem email)');
      return loginPage(res, 403, 'Esta conta Google não tem acesso à área de gestão.');
    }
    res.cookie(COOKIE, signSession(email), { ...cookieOpts(req), maxAge: SESSION_HOURS * 3600 * 1000 });
    res.redirect(303, '/gestao/');
  } catch (err) {
    console.warn('[gestao] não foi possível validar a entrada:', err.message);
    loginPage(res, 400, 'Não foi possível confirmar a conta Google. Tenta outra vez.');
  }
});

router.post('/sair', (req, res) => {
  res.clearCookie(COOKIE, cookieOpts(req));
  res.redirect(303, '/gestao/');
});

router.get('/contactos.csv', requireAdmin, async (req, res, next) => {
  try {
    const day = new Date().toISOString().slice(0, 10);
    res.type('text/csv; charset=utf-8').attachment(`contactos-apoio-eletrico-${day}.csv`).send(leadsCsv(await listLeads()));
  } catch (err) {
    next(err);
  }
});

// Volta à lista com os mesmos filtros e uma mensagem ("guardado", "apagado")
const back = (req, ok) => {
  const params = new URLSearchParams();
  try {
    for (const [k, v] of new URL(req.get('referer')).searchParams) if (['resultado', 'estado', 'q'].includes(k) && v) params.set(k, v);
  } catch { /* sem filtros */ }
  params.set('ok', ok);
  return `/gestao/?${params}`;
};

router.post('/contactos/:id', requireAdmin, async (req, res, next) => {
  const estado = String(req.body.estado || '');
  if (!ESTADOS.some(([k]) => k === estado)) return res.status(400).send('Estado inválido.');
  const nota = String(req.body.nota || '').trim().slice(0, 2000);
  try {
    const ref = leadsCol().doc(req.params.id);
    if (!(await db.guarded(() => ref.get())).exists) return res.status(404).send('Contacto não encontrado.');
    await db.guarded(() => ref.update({ estado, nota, atualizadoEm: new Date(), atualizadoPor: req.admin.email }));
    res.redirect(303, `${back(req, 'guardado')}#c-${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

// Apagar (por exemplo, quando a pessoa pede para os dados serem eliminados)
router.post('/contactos/:id/apagar', requireAdmin, async (req, res, next) => {
  try {
    await db.guarded(() => leadsCol().doc(req.params.id).delete());
    console.log('[gestao] contacto apagado por', req.admin.email);
    res.redirect(303, back(req, 'apagado'));
  } catch (err) {
    next(err);
  }
});

module.exports = { router, signSession, readSession, leadsCsv, csvCell, missingConfig };
