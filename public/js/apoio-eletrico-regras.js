// Regras do apoio de 2027 para famílias carenciadas comprarem carro elétrico, e as contas do simulador.
// Ainda não é lei: tudo o que muda com o regulamento está em RULES. O mesmo ficheiro corre no navegador
// (window.ApoioEletrico) e no servidor (require), para as contas serem as mesmas nos dois lados e nos testes.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ApoioEletrico = api;
})(typeof self !== 'undefined' ? self : this, () => {
  const RULES = {
    refIncome: 11572,      // € líquidos por ano, por adulto equivalente (80% do rendimento mediano)
    wFirst: 1, wOther14: 0.5, wChild: 0.3, // escala da OCDE modificada (pessoas com 14+ anos / crianças)
    monthsPerYear: 14,     // ordenados e pensões com subsídios de férias e de Natal
    nearMargin: 1.10,      // até 10% acima do limite: "perto do limite"
    pctRef: 0.80, pctMin: 0.70, pctMax: 0.90,
    cap: 15000, abateBonus: 1000,
    vat: 1.23,
    minPrice: 5000, maxPrice: 37500,
    maxPeople: 10,
  };

  const cents = (n) => Math.round(n * 100) / 100;

  // Soma dos pesos da casa: 1 para a primeira pessoa, 0,5 para cada outra com 14+ anos, 0,3 por criança.
  const weights = (adults, kids) => cents(RULES.wFirst + RULES.wOther14 * Math.max(0, adults - 1) + RULES.wChild * kids);

  // Rendimento líquido anual máximo da casa.
  const houseLimit = (adults, kids) => cents(RULES.refIncome * weights(adults, kids));

  // Apoio para um carro (preço com IVA), com uma percentagem do preço sem IVA, até ao teto.
  function support(price, pct, abate) {
    const cap = RULES.cap + (abate ? RULES.abateBonus : 0);
    return Math.min(Math.round((price / RULES.vat) * pct), cap);
  }

  // Apoio de referência (80%), intervalo de 70% a 90% e o que fica para pagar.
  function simulate(price, abate) {
    const ref = support(price, RULES.pctRef, abate);
    const lo = support(price, RULES.pctMin, abate);
    const hi = support(price, RULES.pctMax, abate);
    return { price, ref, lo, hi, pays: price - ref, paysMin: price - hi, paysMax: price - lo };
  }

  // ok = deve ter direito; warn = perto do limite (até 10% acima); no = acima do limite.
  function verdict({ tarifa, adults, kids, income }) {
    const annual = (Number(income) || 0) * RULES.monthsPerYear;
    const limit = houseLimit(adults, kids);
    if (tarifa === 'sim') return { kind: 'ok', via: 'tarifa', annual, limit };
    if (annual <= limit) return { kind: 'ok', via: 'rend', annual, limit };
    if (annual <= cents(limit * RULES.nearMargin)) return { kind: 'warn', annual, limit };
    return { kind: 'no', annual, limit };
  }

  return { RULES, weights, houseLimit, support, simulate, verdict };
});
