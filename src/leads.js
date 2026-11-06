// Contactos do simulador do apoio a carros elétricos (/apoio-eletrico-simulador-2027/), guardados no Firestore (coleção "leads").
// Para os ver: consola do Firestore no GCP → coleção "leads".
const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const config = require('./config');
const db = require('./blog/db');
const { verdict, simulate, RULES } = require('../public/js/apoio-eletrico-regras');

const ORIGEM = 'simulador-apoio-eletrico';
// Texto do quadrado de consentimento, tal como aparece na página. Fica guardado com cada contacto (prova RGPD).
const CONSENTIMENTO =
  'Aceito que a Zona Auto guarde estes dados e me contacte por telefone, WhatsApp ou email sobre este apoio e carros elétricos.';
const LIMITE_IP = { pedidos: 10, segundos: 3600 };
const LIMITE_TOTAL = { pedidos: 500, segundos: 3600 };

// "912 345 678", "+351 912345678" ou "00351912345678" → "912345678"
const telemovel = z.string().trim().max(30).transform((v) => v.replace(/[\s.\-()]/g, '').replace(/^(\+|00)351/, ''))
  .refine((v) => /^\d{9}$/.test(v), 'O telemóvel tem de ter 9 números.');

const leadFields = z.object({
  nome: z.string().trim().min(1, 'Escreve o teu nome.').max(120),
  telemovel,
  email: z.string().trim().toLowerCase().max(200).email('O email não é válido.'),
  consentimento: z.literal(true, { errorMap: () => ({ message: 'Falta aceitar o consentimento.' }) }),
  tarifaSocial: z.enum(['sim', 'nao', 'naosei']),
  pessoas14mais: z.number().int().min(1).max(RULES.maxPeople),
  criancas: z.number().int().min(0).max(RULES.maxPeople),
  rendimentoMensal: z.number().int().min(0).max(999999),
  abate: z.enum(['sim', 'nao']),
  pagamento: z.enum(['prestacoes', 'pronto', 'naosei']),
  resultado: z.enum(['ok', 'warn', 'no']).optional(),
  precoEscolhido: z.number().int().min(RULES.minPrice).max(RULES.maxPrice).optional(),
  // Campo escondido: as pessoas não o veem, os bots preenchem-no.
  website: z.string().max(500).optional(),
}).strict();

// Monta o documento a gravar. O resultado é sempre recalculado aqui, com as mesmas regras da página.
function buildLead(input, now = new Date()) {
  const v = verdict({ tarifa: input.tarifaSocial, adults: input.pessoas14mais, kids: input.criancas, income: input.rendimentoMensal });
  const preco = input.precoEscolhido ?? null;
  return {
    origem: ORIGEM,
    criadoEm: now,
    nome: input.nome,
    telemovel: input.telemovel,
    email: input.email,
    tarifaSocial: input.tarifaSocial,
    pessoas14mais: input.pessoas14mais,
    criancas: input.criancas,
    rendimentoMensal: input.rendimentoMensal,
    rendimentoAnual: v.annual,
    limiteAnual: v.limit,
    abate: input.abate,
    pagamento: input.pagamento,
    resultado: v.kind,
    precoEscolhido: preco,
    apoioEstimado: preco && v.kind !== 'no' ? simulate(preco, input.abate === 'sim').ref : null,
    consentimento: { texto: CONSENTIMENTO, dadoEm: now },
    estado: 'novo',
  };
}

const ipKey = (ip) => crypto.createHash('sha256').update(String(ip || '')).digest('hex').slice(0, 16);

const router = express.Router();
router.post('/', express.json({ limit: '16kb' }), async (req, res) => {
  // Só aceita pedidos vindos do próprio site
  const origin = req.get('origin');
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch { /* inválido */ }
    if (host !== req.get('host') && host !== new URL(config.siteUrl).host) return res.status(403).json({ error: 'Pedido recusado.' });
  }
  const parsed = leadFields.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dados inválidos.', details: parsed.error.issues.map((i) => `${i.path.join('.') || 'pedido'}: ${i.message}`) });
  }
  // Bot: responde como se tivesse corrido bem, sem gravar
  if (parsed.data.website) return res.status(201).json({ ok: true });

  try {
    const okIp = await db.guarded(() => db.rateLimit(`leads-${ipKey(req.ip)}`, LIMITE_IP.pedidos, LIMITE_IP.segundos));
    const okTotal = okIp && await db.guarded(() => db.rateLimit('leads-total', LIMITE_TOTAL.pedidos, LIMITE_TOTAL.segundos));
    if (!okIp || !okTotal) return res.status(429).json({ error: 'Demasiados pedidos. Tenta daqui a uma hora.' });
    const ref = await db.guarded(() => db.firestore().collection('leads').add(buildLead(parsed.data)));
    res.status(201).json({ ok: true, id: ref.id });
  } catch (err) {
    console.error('[leads] não foi possível gravar:', err.message);
    res.status(503).json({ error: 'Não conseguimos guardar os teus dados. Tenta outra vez.' });
  }
});
// Corpo grande demais ou JSON partido
router.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Pedido grande demais.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
  next(err);
});

module.exports = { router, leadFields, buildLead, CONSENTIMENTO, ORIGEM };
