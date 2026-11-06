// Área de gestão: sessão assinada, emails autorizados e exportação CSV.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_EMAILS = 'Dono@Exemplo.pt, outra@exemplo.pt';
process.env.BLOG_API_TOKEN = 'x'.repeat(40);
const { signSession, readSession, leadsCsv, csvCell } = require('../src/admin');

test('sessão: válida, adulterada, expirada e email fora da lista', () => {
  const now = Date.now();
  const token = signSession('dono@exemplo.pt', now);
  assert.equal(readSession(token, now + 1000).email, 'dono@exemplo.pt');
  // 12 horas depois já não serve
  assert.equal(readSession(token, now + 13 * 3600 * 1000), null);
  // mudar o conteúdo invalida a assinatura
  const [, mac] = token.split('.');
  const forged = `${Buffer.from(JSON.stringify({ email: 'dono@exemplo.pt', exp: now + 1e10 })).toString('base64url')}.${mac}`;
  assert.equal(readSession(forged, now), null);
  assert.equal(readSession('lixo', now), null);
  assert.equal(readSession('', now), null);
  // quem sai da lista perde o acesso, mesmo com sessão aberta
  assert.equal(readSession(signSession('intruso@exemplo.pt', now), now), null);
  // outra chave não serve
  process.env.BLOG_API_TOKEN = 'y'.repeat(40);
  assert.equal(readSession(token, now), null);
  process.env.BLOG_API_TOKEN = 'x'.repeat(40);
});

test('CSV: separado por ";", com BOM e sem fórmulas', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('+351912345678'), "'+351912345678");
  assert.equal(csvCell('Ana; Silva'), '"Ana; Silva"');
  const csv = leadsCsv([{
    criadoEm: new Date('2026-11-06T10:05:00Z'), nome: 'Ana', telemovel: '912345678', email: 'a@b.pt', resultado: 'ok',
    tarifaSocial: 'sim', pessoas14mais: 2, criancas: 1, rendimentoMensal: 1200, abate: 'nao', pagamento: 'pronto', estado: 'novo', nota: '',
  }]);
  assert.ok(csv.startsWith('﻿Data;Nome;Telemóvel;Email;Resultado'));
  assert.match(csv, /06\/11\/2026, 10:05;Ana;912345678;a@b\.pt;Tem direito;Sim;2;1;1200;Não;Tudo de uma vez;Novo;\r\n$/);
});
