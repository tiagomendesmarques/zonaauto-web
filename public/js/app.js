// Menu móvel
const toggle = document.querySelector('.nav-toggle');
const nav = document.querySelector('.main-nav');
toggle?.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  toggle.setAttribute('aria-expanded', open);
});

// Filtros da listagem
const filtersForm = document.getElementById('filters');
filtersForm?.querySelectorAll('[data-autosubmit]').forEach((el) => el.addEventListener('change', () => filtersForm.submit()));
document.getElementById('sort')?.addEventListener('change', (e) => {
  filtersForm.ordem.value = e.target.value;
  filtersForm.submit();
});
document.querySelector('.filters-toggle')?.addEventListener('click', () => document.querySelector('.filters').classList.toggle('open'));

// Galeria + lightbox
const gallery = document.querySelector('.gallery');
if (gallery) {
  const images = JSON.parse(gallery.dataset.images || '[]');
  const mainImg = document.getElementById('gallery-main-img');
  const idxEl = document.getElementById('gal-idx');
  const thumbs = [...gallery.querySelectorAll('.gallery-thumbs button')];
  const lb = document.querySelector('.lightbox');
  const lbImg = lb.querySelector('img');
  let idx = 0;
  const show = (i) => {
    if (!images.length) return;
    idx = (i + images.length) % images.length;
    mainImg.src = images[idx];
    lbImg.src = images[idx];
    if (idxEl) idxEl.textContent = idx + 1;
    thumbs.forEach((t, n) => t.classList.toggle('active', n === idx));
    thumbs[idx]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  thumbs.forEach((t) => t.addEventListener('click', () => show(Number(t.dataset.idx))));
  document.querySelectorAll('.gal-nav.prev').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); show(idx - 1); }));
  document.querySelectorAll('.gal-nav.next').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); show(idx + 1); }));
  gallery.querySelector('.gallery-main').addEventListener('click', () => { lbImg.src = images[idx]; lb.hidden = false; });
  lb.querySelector('.lb-close').addEventListener('click', () => (lb.hidden = true));
  lb.addEventListener('click', (e) => { if (e.target === lb) lb.hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(idx - 1);
    if (e.key === 'ArrowRight') show(idx + 1);
    if (e.key === 'Escape') lb.hidden = true;
  });
  // Deslizar no telemóvel
  let x0 = null;
  gallery.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX), { passive: true });
  gallery.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) show(idx + (dx < 0 ? 1 : -1));
    x0 = null;
  });
}
