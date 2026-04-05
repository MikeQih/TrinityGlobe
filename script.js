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
  if (!prices) prices = {};
  const tiers = [
    { key: 'bottle',    label: '1 Bottle' },
    { key: 'case',      label: '1 Case'   },
    { key: 'fiveCases', label: '5 Cases'  },
  ];

  const cols = tiers.map(t => {
    const val = prices[t.key];
    const display = (val != null && val !== '' && val > 0)
      ? `<span class="price-value">${fmt(val)}</span>`
      : `<span class="price-value price-na">—</span>`;
    return `<div class="price-item"><span class="price-label">${t.label}</span>${display}</div>`;
  }).join('');

  return `<div class="price-grid">${cols}</div>`;
}

// ── Load products: fetch products.json (live), fallback to products-data.js (local) ──
async function loadProducts() {
  let products;
  try {
    const res = await fetch('/products.json');
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    products = data.products;
  } catch {
    // Local file:// fallback — requires products-data.js to be loaded
    products = (typeof PRODUCTS !== 'undefined') ? PRODUCTS.map(p => ({
      ...p,
      image: 'images/' + p.image
    })) : [];
  }

  renderProducts(products);
  buildFilterTabs(products);
  initFilter();
  initReveal();
}

// ── Render product cards ──
function renderProducts(products) {
  const grid = document.getElementById('productGrid');
  grid.innerHTML = products.map(p => `
    <div class="product-card" data-category="${p.category}">
      <div class="card-img-wrap">
        <img src="${p.image}" alt="${p.name}" loading="lazy" />
      </div>
      <div class="card-info">
        <span class="card-cat">${p.categoryLabel}</span>
        <h3>${p.name}</h3>
        ${buildPriceGrid(p.prices)}
      </div>
    </div>`).join('');
}

// ── Build filter tabs dynamically from product categories ──
function buildFilterTabs(products) {
  const tabContainer = document.getElementById('filterTabs');

  // Tab display labels for known categories
  const labelMap = {
    cognac:    'Cognac',
    whisky:    'Whisky',
    champagne: 'Champagne',
    wine:      'Wine',
    baijiu:    'Baijiu',
    other:     'Others',
  };

  // Preserve category order: known ones first, then any new ones alphabetically
  const knownOrder = ['cognac', 'whisky', 'champagne', 'wine', 'baijiu'];
  const usedCats = [...new Set(products.map(p => p.category))];
  const ordered = [
    ...knownOrder.filter(c => usedCats.includes(c)),
    ...usedCats.filter(c => !knownOrder.includes(c) && c !== 'other').sort(),
    ...(usedCats.includes('other') ? ['other'] : []),
  ];

  const tabs = ['all', ...ordered].map((cat, i) => {
    const label = cat === 'all' ? 'All' : (labelMap[cat] || cat.charAt(0).toUpperCase() + cat.slice(1));
    return `<button class="tab${i === 0 ? ' active' : ''}" data-filter="${cat}">${label}</button>`;
  }).join('');

  tabContainer.innerHTML = tabs;
}

// ── Product filter tabs ──
function initFilter() {
  const tabContainer = document.getElementById('filterTabs');
  const grid = document.getElementById('productGrid');

  tabContainer.addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (!tab) return;

    tabContainer.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    const filter = tab.dataset.filter;
    grid.querySelectorAll('.product-card').forEach(card => {
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

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  loadProducts();

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
