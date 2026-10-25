// Menu móvel
const header = document.querySelector('.site-header');
const navToggle = document.querySelector('.nav-toggle');
navToggle?.addEventListener('click', () => {
  const open = header.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', open);
  navToggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
});

// Filtros do stock
const filters = document.getElementById('filters');
filters?.querySelectorAll('[data-autosubmit]').forEach((el) =>
  el.addEventListener('change', () => {
    // Ao mudar de marca, o modelo escolhido deixa de fazer sentido
    if (el.name === 'marca' && filters.modelo) filters.modelo.value = '';
    filters.submit();
  })
);
document.getElementById('sort')?.addEventListener('change', (e) => {
  filters.ordem.value = e.target.value;
  filters.submit();
});
const filtersToggle = document.querySelector('.filters-toggle');
filtersToggle?.addEventListener('click', () => {
  const open = filters.classList.toggle('open');
  filtersToggle.setAttribute('aria-expanded', open);
});

// Galeria e ecrã inteiro
const gallery = document.querySelector('.gallery');
if (gallery) {
  const images = JSON.parse(gallery.dataset.images || '[]');
  const main = document.getElementById('gal-img');
  const idxEl = document.getElementById('gal-idx');
  const thumbs = [...gallery.querySelectorAll('.thumbs button')];
  const lb = document.querySelector('.lightbox');
  const lbImg = lb.querySelector('img');
  const lbCount = lb.querySelector('.lb-count');
  let idx = 0;

  const show = (i) => {
    if (!images.length) return;
    idx = (i + images.length) % images.length;
    main.src = images[idx];
    lbImg.src = images[idx];
    if (idxEl) idxEl.textContent = idx + 1;
    lbCount.textContent = `${idx + 1} / ${images.length}`;
    thumbs.forEach((t, n) => t.setAttribute('aria-current', n === idx));
    thumbs[idx]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    // Pré-carrega a seguinte
    new Image().src = images[(idx + 1) % images.length];
  };
  const openLb = () => { lbImg.src = images[idx]; lbCount.textContent = `${idx + 1} / ${images.length}`; lb.hidden = false; document.body.style.overflow = 'hidden'; lb.querySelector('.lb-close').focus(); };
  const closeLb = () => { lb.hidden = true; document.body.style.overflow = ''; };

  thumbs.forEach((t) => t.addEventListener('click', () => show(Number(t.dataset.idx))));
  document.querySelectorAll('.gal-btn.prev').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); show(idx - 1); }));
  document.querySelectorAll('.gal-btn.next').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); show(idx + 1); }));
  const mainBox = gallery.querySelector('.gallery-main');
  mainBox.addEventListener('click', openLb);
  mainBox.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLb(); } });
  lb.querySelector('.lb-close').addEventListener('click', closeLb);
  lb.addEventListener('click', (e) => { if (e.target === lb) closeLb(); });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea')) return;
    if (e.key === 'ArrowLeft') show(idx - 1);
    if (e.key === 'ArrowRight') show(idx + 1);
    if (e.key === 'Escape') closeLb();
  });
  // Deslizar com o dedo
  let x0 = null;
  [mainBox, lb].forEach((el) => {
    el.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX), { passive: true });
    el.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) { e.preventDefault(); show(idx + (dx < 0 ? 1 : -1)); }
      x0 = null;
    });
  });
}
