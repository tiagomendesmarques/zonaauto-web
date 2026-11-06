// Simulador "Elétrico com Apoio" (/apoio-eletrico/): uma pergunta por ecrã, contacto obrigatório no fim
// e o resultado só aparece depois de o contacto ficar gravado (POST /api/leads).
// As regras e as contas estão em apoio-eletrico-regras.js (window.ApoioEletrico).
(() => {
  const { RULES, verdict: calcVerdict, simulate } = window.ApoioEletrico;
  const state = { step: 1, tarifa: null, adults: 1, kids: 0, income: null, abate: null, pagamento: null, price: 20000, contact: null };
  const TOTAL = 6;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const eur = (n) => `${Math.round(n).toLocaleString('pt-PT', { useGrouping: 'always' }).replace(/\s/g, '.')} €`;
  const verdict = () => calcVerdict({ tarifa: state.tarifa, adults: state.adults, kids: state.kids, income: state.income });
  window.dataLayer = window.dataLayer || [];

  // ---- navegação ----
  function show(id) {
    ['#s-intro', '#s-quiz', '#s-result'].forEach((s) => { $(s).hidden = s !== id; });
    $('#app').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
  function goStep(n) {
    state.step = n;
    $$('.step').forEach((el) => { el.hidden = Number(el.dataset.step) !== n; });
    $('#step-label').textContent = n === TOTAL ? 'Último passo' : `Pergunta ${n} de ${TOTAL - 1}`;
    $('#bar').style.width = `${((n - 1) / TOTAL) * 100}%`;
    if (n === 3) setTimeout(() => $('#income').focus(), 50);
  }
  function next() { if (state.step < TOTAL) goStep(state.step + 1); }

  $('#start').addEventListener('click', () => { show('#s-quiz'); goStep(1); });
  $('#back').addEventListener('click', () => { if (state.step > 1) goStep(state.step - 1); else show('#s-intro'); });

  // escolhas (um toque responde e avança)
  $$('.choices').forEach((group) => {
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('.choice');
      if (!btn) return;
      group.querySelectorAll('.choice').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      state[group.dataset.key] = btn.dataset.val;
      setTimeout(next, 220);
    });
  });

  // pessoas
  function renderHouse() {
    $('#adults').textContent = state.adults;
    $('#kids').textContent = state.kids;
    $('#adults-minus').disabled = state.adults <= 1;
    $('#kids-minus').disabled = state.kids <= 0;
    $('#adults-plus').disabled = state.adults >= RULES.maxPeople;
    $('#kids-plus').disabled = state.kids >= RULES.maxPeople;
    const total = state.adults + state.kids;
    $('#house-summary').textContent = total === 1 ? 'Vives sozinho ou sozinha.' : `Na tua casa vivem ${total} pessoas, contigo.`;
  }
  $('#adults-minus').addEventListener('click', () => { state.adults = Math.max(1, state.adults - 1); renderHouse(); });
  $('#adults-plus').addEventListener('click', () => { state.adults = Math.min(RULES.maxPeople, state.adults + 1); renderHouse(); });
  $('#kids-minus').addEventListener('click', () => { state.kids = Math.max(0, state.kids - 1); renderHouse(); });
  $('#kids-plus').addEventListener('click', () => { state.kids = Math.min(RULES.maxPeople, state.kids + 1); renderHouse(); });
  $$('.next').forEach((b) => b.addEventListener('click', next));

  // rendimento
  const incomeEl = $('#income');
  incomeEl.addEventListener('input', () => {
    const digits = incomeEl.value.replace(/\D/g, '').slice(0, 6);
    incomeEl.value = digits ? Number(digits).toLocaleString('pt-PT', { useGrouping: 'always' }).replace(/\s/g, '.') : '';
    $('#income-err').hidden = true;
  });
  function submitIncome() {
    const digits = incomeEl.value.replace(/\D/g, '');
    if (digits === '') { $('#income-err').hidden = false; incomeEl.focus(); return; }
    state.income = Number(digits);
    next();
  }
  $('#income-next').addEventListener('click', submitIncome);
  incomeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitIncome(); } });

  // ---- resultado ----
  function showResult() {
    $('#bar').style.width = '100%';
    const v = verdict();
    $('#verdict').className = `verdict ${v.kind}`;
    const people = state.adults + state.kids;
    const casa = `Para uma casa com ${people} ${people === 1 ? 'pessoa' : 'pessoas'}, o limite é ${eur(v.limit)} por ano`;
    if (v.kind === 'ok' && v.via === 'tarifa') {
      $('#verdict-badge').textContent = '✓ Tens Tarifa Social';
      $('#verdict-title').textContent = 'Deves ter direito ao apoio.';
      $('#verdict-text').textContent = 'Quem tem Tarifa Social na luz pode pedir este apoio e passa à frente na fila.';
    } else if (v.kind === 'ok') {
      $('#verdict-badge').textContent = '✓ Dentro do limite';
      $('#verdict-title').textContent = 'Pelas tuas respostas, deves ter direito.';
      $('#verdict-text').textContent = `${casa}. Pelas nossas contas, na tua casa entram cerca de ${eur(v.annual)} por ano.`;
    } else if (v.kind === 'warn') {
      $('#verdict-badge').textContent = 'Perto do limite';
      $('#verdict-title').textContent = 'Estás mesmo no limite.';
      $('#verdict-text').textContent = `${casa} e na tua entram cerca de ${eur(v.annual)}. Ainda pode dar. Fala connosco para vermos bem.`;
    } else {
      $('#verdict-badge').textContent = 'Acima do limite';
      $('#verdict-title').textContent = 'Este apoio parece não ser para ti.';
      $('#verdict-text').textContent = `${casa} e na tua entram cerca de ${eur(v.annual)}. Mas há outro apoio para toda a gente e carros a bons preços no nosso stand.`;
    }
    if (state.tarifa === 'naosei' && v.kind !== 'ok') {
      $('#verdict-text').textContent += ' Se descobrires que tens Tarifa Social na luz, já tens direito.';
    }
    $('#calc').hidden = v.kind === 'no';
    $('#lead-title').textContent = v.kind === 'no' ? 'Queres saber que carros consegues comprar?' : 'Queres ajuda a escolher o carro?';
    $('#lead-text').textContent = v.kind === 'no'
      ? 'Fala connosco pelo WhatsApp sobre outros apoios e carros dentro do teu orçamento. A tua simulação já vai escrita.'
      : 'Manda-nos a tua simulação pelo WhatsApp. Já vai escrita, só tens de carregar em enviar.';
    $('#wa-hint').textContent = '';
    renderCalc();
    show('#s-result');
  }

  function renderCalc() {
    const p = state.price;
    const abate = state.abate === 'sim';
    const s = simulate(p, abate);
    $('#price-out').textContent = eur(p);
    $('#r-price').textContent = eur(p);
    $('#r-state').textContent = eur(s.ref);
    $('#r-you').textContent = eur(s.pays);
    $('#r-month').textContent = `~${eur(s.monthly)}`;
    $('#bar-state').style.width = `${(s.ref / p) * 100}%`;
    $('#bar-you').style.width = `${(s.pays / p) * 100}%`;
    const capNote = abate ? 'até 16.000 € porque entregas um carro para abate' : 'até 15.000 €';
    $('#r-range').textContent = s.lo === s.hi
      ? `Com este preço recebes o apoio máximo (${capNote}).`
      : `Contámos com 80%. Conforme o teu rendimento, o Estado pode pagar entre ${eur(s.lo)} e ${eur(s.hi)}, e tu entre ${eur(s.paysMin)} e ${eur(s.paysMax)}. O apoio vai ${capNote}.`;
    $$('#price-chips .chip').forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.p) === p)));
    // O botão do WhatsApp leva sempre a simulação atual (passa pelo /whatsapp/ do site, que conta o clique)
    $('#wa').href = `/whatsapp/?t=${encodeURIComponent(buildMessage(state.contact || {}))}`;
  }
  $('#price').addEventListener('input', (e) => { state.price = Number(e.target.value); renderCalc(); });
  $('#price-chips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    state.price = Number(c.dataset.p); $('#price').value = state.price; renderCalc();
  });

  // ---- contacto ----
  const label = { tarifa: { sim: 'Sim', nao: 'Não', naosei: 'Não sabe' }, abate: { sim: 'Sim', nao: 'Não' }, pagamento: { prestacoes: 'Às prestações', pronto: 'Tudo de uma vez', naosei: 'Ainda não sabe' } };
  const verdictLabel = { ok: 'Deve ter direito', warn: 'Perto do limite', no: 'Acima do limite' };
  function buildMessage({ nome = '', tel = '', email = '' }) {
    const v = verdict();
    const lines = ['Olá! Fiz a simulação do apoio para carro elétrico.', '', `Nome: ${nome}`, `Telemóvel: ${tel}`];
    if (email) lines.push(`Email: ${email}`);
    lines.push(
      `Tarifa Social: ${label.tarifa[state.tarifa] || '-'}`,
      `Em casa: ${state.adults} com 14+ anos, ${state.kids} criança(s)`,
      `Rendimento da casa: ${eur(state.income || 0)} por mês`,
      `Carro para abate: ${label.abate[state.abate] || '-'}`,
      `Pagamento do resto: ${label.pagamento[state.pagamento] || '-'}`,
      `Resultado: ${verdictLabel[v.kind]}`
    );
    if (v.kind !== 'no') {
      const s = simulate(state.price, state.abate === 'sim');
      lines.push(`Carro de ${eur(state.price)}: apoio ~${eur(s.ref)}, fico a pagar ~${eur(s.pays)}`);
      lines.push(`Com crédito: ~${eur(s.monthly)}/mês em ${RULES.creditMonths} meses (valor indicativo)`);
    }
    lines.push('', 'Aceito ser contactado pela Zona Auto.');
    return lines.join('\n');
  }

  // Grava o contacto no servidor. Só devolve true se ficou mesmo gravado.
  async function saveLead() {
    const { nome, tel, email } = state.contact;
    const body = {
      nome, telemovel: tel, email, consentimento: true,
      tarifaSocial: state.tarifa, pessoas14mais: state.adults, criancas: state.kids,
      rendimentoMensal: state.income, abate: state.abate, pagamento: state.pagamento,
      resultado: verdict().kind, website: $('#website').value,
    };
    try {
      const res = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) return { ok: true };
      const data = await res.json().catch(() => ({}));
      return { ok: false, status: res.status, error: data.error };
    } catch {
      return { ok: false };
    }
  }

  let sending = false;
  $('#lead').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    const nome = $('#nome').value.trim();
    const tel = $('#tel').value.replace(/[^\d+]/g, '');
    const email = $('#email').value.trim();
    const err = $('#lead-err');
    const digits = tel.replace(/^(\+|00)351/, '').replace(/\D/g, '');
    let msg = '';
    if (!nome) msg = 'Escreve o teu nome.';
    else if (digits.length !== 9) msg = 'Escreve o teu telemóvel com 9 números.';
    else if (!/^\S+@\S+\.\S+$/.test(email)) msg = 'Escreve o teu email, por exemplo nome@gmail.com.';
    else if (!$('#ok').checked) msg = 'Para veres o resultado, marca o quadrado a aceitar.';
    if (msg) { err.textContent = msg; err.hidden = false; return; }
    err.hidden = true;
    state.contact = { nome, tel, email };

    sending = true;
    const btn = $('#lead-submit');
    btn.disabled = true;
    $('#lead-submit-text').textContent = 'A guardar…';
    const saved = await saveLead();
    sending = false;
    btn.disabled = false;
    if (!saved.ok) {
      err.textContent = saved.status === 400 && saved.error ? 'Confirma os teus dados e tenta outra vez.'
        : saved.status === 429 ? 'Já fizeste muitas simulações. Tenta daqui a uma hora ou fala connosco pelo WhatsApp.'
        : 'Não conseguimos guardar os teus dados. Tenta outra vez.';
      err.hidden = false;
      $('#lead-submit-text').textContent = 'Tentar outra vez';
      return;
    }
    $('#lead-submit-text').textContent = 'Ver o meu resultado';
    window.dataLayer.push({ event: 'lead_simulador', contacto_local: 'simulador_apoio_eletrico', resultado: verdict().kind });
    showResult();
  });

  $('#wa').addEventListener('click', () => {
    $('#wa-hint').textContent = 'Se o WhatsApp não abriu, escreve-nos para o email abaixo.';
  });

  $('#copy-mail').addEventListener('click', async () => {
    const btn = $('#copy-mail');
    const mail = $('#mail').textContent.trim();
    try { await navigator.clipboard.writeText(mail); btn.textContent = 'Copiado'; } catch {
      const r = document.createRange(); r.selectNodeContents($('#mail')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); btn.textContent = 'Selecionado';
    }
  });

  $('#restart').addEventListener('click', () => {
    Object.assign(state, { step: 1, tarifa: null, adults: 1, kids: 0, income: null, abate: null, pagamento: null, price: 20000 });
    $$('.choice').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    incomeEl.value = ''; $('#price').value = 20000;
    renderHouse(); show('#s-quiz'); goStep(1);
  });

  renderHouse();
})();
