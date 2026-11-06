// Contas do simulador do apoio a carros elétricos e validação dos contactos (casos da secção 7 das regras).
const test = require('node:test');
const assert = require('node:assert/strict');
const { houseLimit, weights, support, simulate, verdict } = require('../public/js/apoio-eletrico-regras');
const { leadFields, buildLead, CONSENTIMENTO } = require('../src/leads');

test('limite anual da casa (escala da OCDE modificada)', () => {
  const casos = [
    [1, 0, 1.0, 11572], [1, 1, 1.3, 15043.6], [2, 0, 1.5, 17358], [2, 1, 1.8, 20829.6],
    [3, 0, 2.0, 23144], [2, 2, 2.1, 24301.2], [2, 3, 2.4, 27772.8],
  ];
  for (const [a, k, w, lim] of casos) {
    assert.equal(weights(a, k), w, `pesos ${a}+${k}`);
    assert.equal(houseLimit(a, k), lim, `limite ${a}+${k}`);
  }
});

test('contas do apoio: 80%, intervalo 70–90% e tetos', () => {
  const casos = [
    // preço, abate, apoio 80%, paga, 70%, 90%
    [15000, false, 9756, 5244, 8537, 10976],
    [20000, false, 13008, 6992, 11382, 14634],
    [25000, true, 16000, 9000, 14228, 16000],
    [37500, false, 15000, 22500, 15000, 15000],
  ];
  for (const [price, abate, ref, pays, lo, hi] of casos) {
    const s = simulate(price, abate);
    assert.deepEqual([s.ref, s.pays, s.lo, s.hi], [ref, pays, lo, hi], `carro de ${price} €`);
  }
  assert.equal(support(20000, 0.8, false), 13008);
});

test('direito ao apoio', () => {
  const base = { tarifa: 'nao', adults: 1, kids: 0 };
  // casal, só um ganha o salário mínimo: 12.880 € ÷ 1,5 = 8.587 € por adulto equivalente
  assert.equal(verdict({ ...base, adults: 2, income: 920 }).kind, 'ok');
  assert.equal(verdict({ ...base, income: 750 }).kind, 'ok');
  assert.equal(verdict({ ...base, income: 900 }).kind, 'warn');
  assert.equal(verdict({ ...base, income: 1000 }).kind, 'no');
  const tarifa = verdict({ ...base, tarifa: 'sim', income: 5000 });
  assert.deepEqual([tarifa.kind, tarifa.via], ['ok', 'tarifa']);
  // mesmo no limite conta como "tem direito"; 10% acima ainda é "perto"
  assert.equal(verdict({ ...base, adults: 2, kids: 2, income: 24301.2 / 14 }).kind, 'ok');
  assert.equal(verdict({ ...base, income: 12729.2 / 14 }).kind, 'warn');
});

const valido = {
  nome: 'Ana Silva', telemovel: '+351 912 345 678', email: 'Ana@Exemplo.pt', consentimento: true,
  tarifaSocial: 'naosei', pessoas14mais: 2, criancas: 1, rendimentoMensal: 1200, abate: 'nao', pagamento: 'prestacoes',
  resultado: 'no',
};

test('contactos: validação', () => {
  const ok = leadFields.parse(valido);
  assert.equal(ok.telemovel, '912345678');
  assert.equal(ok.email, 'ana@exemplo.pt');
  assert.equal(leadFields.parse({ ...valido, telemovel: '00351912345678' }).telemovel, '912345678');
  for (const mau of [
    { telemovel: '91234567' }, { telemovel: '+44 7911 123456' }, { email: 'ana' }, { nome: '  ' },
    { consentimento: false }, { pessoas14mais: 0 }, { criancas: 11 }, { rendimentoMensal: -1 }, { tarifaSocial: 'talvez' },
    { campoDesconhecido: 1 },
  ]) {
    assert.equal(leadFields.safeParse({ ...valido, ...mau }).success, false, JSON.stringify(mau));
  }
});

test('contactos: o resultado é recalculado no servidor e o consentimento fica guardado', () => {
  const now = new Date('2026-11-06T10:00:00Z');
  const lead = buildLead({ ...leadFields.parse(valido), resultado: 'no', precoEscolhido: 20000 }, now);
  // 1200 × 14 = 16.800 € ≤ 20.829,60 € (casal + 1 criança)
  assert.equal(lead.resultado, 'ok');
  assert.equal(lead.limiteAnual, 20829.6);
  assert.equal(lead.apoioEstimado, 13008);
  assert.equal(lead.origem, 'simulador-apoio-eletrico');
  assert.deepEqual(lead.consentimento, { texto: CONSENTIMENTO, dadoEm: now });
  assert.equal('website' in lead, false);
});
