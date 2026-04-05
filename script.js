// ── NAV scroll effect ──
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 60);
});

// ── Format price ──
function fmt(price) {
  return 'S$' + price.toLocaleString();
}

// ── Build price grid HTML (always show all 3 tiers, "—" when null) ──
function buildPriceGrid(prices) {
  const tiers = [
    { key: 'bottle',    label: '1 Bottle' },
    { key: 'case',      label: '1 Case'   },
    { key: 'fiveCases', label: '5 Cases'  },
  ];

  const cols = tiers.map(t => {
    const val = prices[t.key];
    const display = val != null ? `<span class="price-value">${fmt(val)}</span>`
                                : `<span class="price-value price-na">—</span>`;
    return `<div class="price-item"><span class="price-label">${t.label}</span>${display}</div>`;
  }).join('');

  return `<div class="price-grid">${cols}</div>`;
}

// ── Render products from products-data.js (PRODUCTS global) ──
function loadProducts() {
  const grid = document.getElementById('productGrid');
  const products = PRODUCTS;

  grid.innerHTML = products.map(p => `
    <div class="product-card" data-category="${p.category}">
      <div class="card-img-wrap">
        <img src="images/${p.image}" alt="${p.name}" loading="lazy" />
      </div>
      <div class="card-info">
        <span class="card-cat">${p.categoryLabel}</span>
        <h3>${p.name}</h3>
        ${buildPriceGrid(p.prices)}
      </div>
    </div>`).join('');

  // Attach filter + reveal after cards are in the DOM
  initFilter();
  initReveal();
}

// ── Product filter tabs ──
function initFilter() {
  const tabs  = document.querySelectorAll('.tab');
  const cards = document.querySelectorAll('.product-card');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const filter = tab.dataset.filter;
      cards.forEach(card => {
        const show = filter === 'all' || card.dataset.category === filter;
        card.classList.toggle('hidden', !show);
        if (show) {
          card.style.opacity = '0';
          card.style.transform = 'translateY(8px)';
          requestAnimationFrame(() => {
            card.style.transition = 'opacity 0.3s ease, transform 0.3s ease, border-color 0.3s';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
          });
        }
      });
    });
  });
}

// ── Scroll reveal ──
function initReveal() {
  const els = document.querySelectorAll('.product-card, .contact-card, .highlight');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });

  els.forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = `opacity 0.45s ease ${(i % 8) * 0.05}s, transform 0.45s ease ${(i % 8) * 0.05}s, border-color 0.3s`;
    observer.observe(el);
  });
}

// ── Smooth scroll for enquire button ──
function scrollToContact() {
  document.getElementById('contact').scrollIntoView({ behavior: 'smooth' });
}

// ── Also reveal about section elements ──
document.addEventListener('DOMContentLoaded', () => {
  loadProducts(); // synchronous now — reads from products-data.js

  const staticEls = document.querySelectorAll('.about-grid, .highlight');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  staticEls.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    observer.observe(el);
  });
});
