// ── i18n ──
let currentLang = 'en';
let cachedProducts = null;
let marqueeOriginalHTML = null;

const translations = {
  en: {
    'nav-home': 'Home', 'nav-about': 'About', 'nav-collection': 'Collection', 'nav-contact': 'Contact',
    'hero-eyebrow': "Singapore's Premier Spirits Distributor",
    'hero-tagline': "Curating the world's finest spirits,<br/>delivered to your door.",
    'hero-btn-explore': 'Explore Collection <b>›</b>', 'hero-btn-about': 'About Us <b>›</b>',
    'feat-delivery-title': 'Free Delivery', 'feat-delivery-sub': 'Min. order S$120',
    'feat-tasting-title': 'Free Tasting', 'feat-tasting-sub': 'Available on request',
    'feat-exclusive-title': 'Exclusive Distributor', 'feat-exclusive-sub': 'Blue Dash spirits',
    'feat-support-title': 'Dedicated Support', 'feat-support-sub': "We're here to help",
    'about-eyebrow': 'About Trinity Globe',
    'about-title': 'Built on Passion.<br/>Driven by <span>Quality.</span>',
    'about-desc': "Singapore's premier supplier of fine spirits. We carry Hennessy, Martell, Macallan, Moutai, Wuliangye, Yamazaki and more — spanning cognac, whisky, champagne and baijiu. As the exclusive distributor of Blue Dash, we bring world-class spirits to your door.",
    'about-btn': 'Our Collection',
    'products-label': 'Our Collection', 'products-title': 'Finest Spirits,<br/>Curated for You',
    'search-placeholder': 'Search spirits…',
    'contact-label': 'Get in Touch', 'contact-title': 'Ready to Order?',
    'contact-sub': 'Reach out via WhatsApp or WeChat. Free delivery on orders above S$120.',
    'contact-wechat': 'WeChat', 'contact-phone': 'Phone',
    'contact-note': '✦ Free delivery on orders S$120 and above &nbsp;·&nbsp; Free tasting available on request',
    'footer-copy': '© 2025 Trinity Globe Trading Pte. Ltd. · Singapore · Premium Spirits Supplier',
    'price-bottle': '1 Bottle', 'price-case': '1 Case', 'price-five': '5 Cases', 'price-enquire': 'Enquire',
    'filter-all': 'All',
    'cat-cognac': 'Cognac', 'cat-whisky': 'Whisky', 'cat-champagne': 'Champagne',
    'cat-wine': 'Wine', 'cat-sake': 'Sake', 'cat-baijiu': 'Baijiu',
    'cat-beer': 'Beer', 'cat-vodka': 'Vodka', 'cat-tequila': 'Tequila', 'cat-other': 'Others',
  },
  zh: {
    'nav-home': '首页', 'nav-about': '关于', 'nav-collection': '产品', 'nav-contact': '联系我们',
    'hero-eyebrow': '新加坡顶级烈酒供应商',
    'hero-tagline': '甄选全球顶级名酒，<br/>送货上门。',
    'hero-btn-explore': '浏览产品 <b>›</b>', 'hero-btn-about': '关于我们 <b>›</b>',
    'feat-delivery-title': '免费配送', 'feat-delivery-sub': '最低消费 S$120',
    'feat-tasting-title': '免费品鉴', 'feat-tasting-sub': '可预约申请',
    'feat-exclusive-title': '独家经销商', 'feat-exclusive-sub': 'Blue Dash 烈酒',
    'feat-support-title': '专属客服', 'feat-support-sub': '随时为您服务',
    'about-eyebrow': '关于 Trinity Globe',
    'about-title': '热情铸就，<br/>品质<span>驱动。</span>',
    'about-desc': '新加坡顶级烈酒与精品饮品供应商。精选轩尼诗、马爹利、麦卡伦、飞天茅台、五粮液、山崎等国际名酒，涵盖干邑、威士忌、香槟及白酒。作为布鲁大师独家经销商，甄选世界级精品，送货上门。',
    'about-btn': '我们的产品',
    'products-label': '我们的产品', 'products-title': '臻选名酒，<br/>专为您甄选',
    'search-placeholder': '搜索产品…',
    'contact-label': '联系我们', 'contact-title': '准备下单？',
    'contact-sub': '通过 WhatsApp 或微信联系我们，订单满 S$120 免费配送。',
    'contact-wechat': '微信', 'contact-phone': '电话',
    'contact-note': '✦ 订单满 S$120 免费配送 &nbsp;·&nbsp; 可预约免费品鉴',
    'footer-copy': '© 2025 Trinity Globe Trading Pte. Ltd. · 新加坡 · 顶级烈酒供应商',
    'price-bottle': '单瓶', 'price-case': '一箱', 'price-five': '五箱', 'price-enquire': '限量供应',
    'filter-all': '全部',
    'cat-cognac': '干邑', 'cat-whisky': '威士忌', 'cat-champagne': '香槟',
    'cat-wine': '葡萄酒', 'cat-sake': '清酒', 'cat-baijiu': '白酒',
    'cat-beer': '啤酒', 'cat-vodka': '伏特加', 'cat-tequila': '龙舌兰', 'cat-other': '其他',
  },
};

function t(key) {
  return translations[currentLang][key] ?? translations.en[key] ?? key;
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.innerHTML = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
}

function toggleLanguage() {
  currentLang = currentLang === 'en' ? 'zh' : 'en';
  const label = currentLang === 'en' ? 'English' : '中文';
  document.getElementById('langToggle').textContent = label;
  const mobileBtn = document.getElementById('mobileLangToggle');
  if (mobileBtn) mobileBtn.textContent = label;

  applyTranslations();

  // Re-render dynamic content with new language
  if (cachedProducts) {
    renderProducts(cachedProducts);
    buildFilterTabs(cachedProducts);
    initFilter();
    initSearch();
    initReveal();
  }

  // Rebuild marquee with new language
  const track = document.getElementById('featuresTrack');
  if (track && marqueeOriginalHTML) {
    track.innerHTML = marqueeOriginalHTML;
    track.querySelectorAll('[data-i18n]').forEach(el => {
      el.innerHTML = t(el.dataset.i18n);
    });
    initMarquee();
  }
}

// ── NAV scroll effect + active link ──
const navbar = document.getElementById('navbar');
const navEnquire = document.querySelector('.nav-enquire');
const navSections = [
  { id: 'hero',     link: document.querySelector('.nav-links a[href="#hero"]') },
  { id: 'about',    link: document.querySelector('.nav-links a[href="#about"]') },
  { id: 'products', link: document.querySelector('.nav-links a[href="#products"]') },
  { id: 'contact',  link: document.querySelector('.nav-links a[href="#contact"]') },
];

window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 60);

  const scrollMid = window.scrollY + window.innerHeight / 3;
  let current = navSections[0];
  for (const s of navSections) {
    const el = document.getElementById(s.id);
    if (el && el.offsetTop <= scrollMid) current = s;
  }
  navSections.forEach(s => s.link?.classList.remove('nav-active'));
  current.link?.classList.add('nav-active');

  const inContact = current.id === 'contact';
  navEnquire?.classList.toggle('nav-enquire-active', inContact);
});

// ── Format price ──
function fmt(price) {
  return 'S$' + price.toLocaleString();
}

// ── Build price grid HTML (always show all 3 tiers, "—" when null) ──
function buildPriceGrid(prices) {
  if (!prices) prices = {};
  const tiers = [
    { key: 'bottle',    label: t('price-bottle') },
    { key: 'case',      label: t('price-case')   },
    { key: 'fiveCases', label: t('price-five')   },
  ];

  const labels = tiers.map(tier => `<span class="price-label">${tier.label}</span>`).join('');
  const values = tiers.map(tier => {
    const val = prices[tier.key];
    return (val != null && val !== '' && val > 0)
      ? `<span class="price-value">${fmt(val)}</span>`
      : `<a class="enquire-link" href="https://wa.me/6598680555" target="_blank">
          <span class="icon-dash">—</span>
          <span class="hover-text"><span class="enquire-label">${t('price-enquire')}</span></span>
        </a>`;
  }).join('');

  return `<div class="price-grid">${labels}${values}</div>`;
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

  cachedProducts = products;
  renderProducts(products);
  buildFilterTabs(products);
  initFilter();
  initSearch();
  initReveal();
}

// ── Render product cards ──
function renderProducts(products) {
  const grid = document.getElementById('productGrid');
  grid.innerHTML = products.map(p => {
    const primary  = currentLang === 'en' ? (p.nameEn || p.name) : (p.nameZh || p.name);
    const catLabel = t('cat-' + p.category) || p.categoryLabel;
    return `
    <div class="product-card" data-category="${p.category}">
      <div class="card-img-wrap">
        <img class="card-product-img" src="${p.image}" alt="${(p.nameEn || p.name).replace(/<br\s*\/?>/gi, ' ')}" loading="lazy" />
        <img class="card-logo" src="images/logo-tg-transparent.png" alt="" loading="lazy" />
      </div>
      <div class="card-info">
        <span class="card-cat">${catLabel}</span>
        <h3>${primary}</h3>
        ${buildPriceGrid(p.prices)}
      </div>
    </div>`;
  }).join('');
}

// ── Build filter tabs dynamically from product categories ──
function buildFilterTabs(products) {
  const tabContainer = document.getElementById('filterTabs');

  // Tab display labels for known categories
  const labelMap = {
    cognac:    t('cat-cognac'),
    whisky:    t('cat-whisky'),
    champagne: t('cat-champagne'),
    wine:      t('cat-wine'),
    sake:      t('cat-sake'),
    baijiu:    t('cat-baijiu'),
    beer:      t('cat-beer'),
    vodka:     t('cat-vodka'),
    tequila:   t('cat-tequila'),
    other:     t('cat-other'),
  };

  // Preserve category order: known ones first, then any new ones alphabetically
  const knownOrder = ['cognac', 'whisky', 'champagne', 'wine', 'sake', 'baijiu', 'beer', 'vodka', 'tequila'];
  const usedCats = [...new Set(products.map(p => p.category))];
  const ordered = [
    ...knownOrder.filter(c => usedCats.includes(c)),
    ...usedCats.filter(c => !knownOrder.includes(c) && c !== 'other').sort(),
    ...(usedCats.includes('other') ? ['other'] : []),
  ];

  const tabs = ['all', ...ordered].map((cat, i) => {
    const label = cat === 'all' ? t('filter-all') : (labelMap[cat] || cat.charAt(0).toUpperCase() + cat.slice(1));
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

// ── Search ──
function initSearch() {
  const input = document.getElementById('searchInput');
  const clearBtn = document.getElementById('searchClear');
  const grid = document.getElementById('productGrid');

  function applySearch() {
    const q = input.value.trim().toLowerCase();
    clearBtn.classList.toggle('visible', q.length > 0);

    const activeFilter = document.querySelector('.tab.active')?.dataset.filter || 'all';

    grid.querySelectorAll('.product-card').forEach(card => {
      const name    = (card.querySelector('h3')?.textContent || '').toLowerCase();
      const nameAlt = (card.querySelector('.card-name-alt')?.textContent || '').toLowerCase();
      const cat     = (card.querySelector('.card-cat')?.textContent || '').toLowerCase();
      const matchesSearch = !q || name.includes(q) || nameAlt.includes(q) || cat.includes(q);
      const matchesFilter = activeFilter === 'all' || card.dataset.category === activeFilter;
      card.classList.toggle('hidden', !(matchesSearch && matchesFilter));
    });
  }

  input.addEventListener('input', applySearch);

  clearBtn.addEventListener('click', () => {
    input.value = '';
    applySearch();
    input.focus();
  });

  // Re-run search when filter tab changes
  document.getElementById('filterTabs').addEventListener('click', () => {
    requestAnimationFrame(applySearch);
  });
}

// ── Smooth scroll for enquire button ──
function scrollToContact() {
  closeMobileMenu();
  document.getElementById('contact').scrollIntoView({ behavior: 'smooth' });
}

// ── Mobile hamburger menu ──
const hamburger = document.getElementById('navHamburger');
const mobileMenu = document.getElementById('mobileMenu');

hamburger?.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = mobileMenu.classList.toggle('open');
  hamburger.classList.toggle('open', isOpen);
});

document.addEventListener('click', (e) => {
  if (mobileMenu?.classList.contains('open') &&
      !mobileMenu.contains(e.target) && e.target !== hamburger) {
    closeMobileMenu();
  }
});

function closeMobileMenu() {
  mobileMenu?.classList.remove('open');
  hamburger?.classList.remove('open');
}

// ── Features marquee: clone until wider than 2× viewport ──
function initMarquee() {
  const track = document.getElementById('featuresTrack');
  if (!track) return;

  if (!marqueeOriginalHTML) marqueeOriginalHTML = track.innerHTML;

  const singleHTML = track.innerHTML;
  const originalWidth = track.scrollWidth;

  const needed = Math.ceil((window.innerWidth * 2.5) / originalWidth);
  for (let i = 0; i < needed; i++) {
    track.innerHTML += singleHTML;
  }

  const totalCopies = needed + 1;
  const offset = -(1 / totalCopies * 100).toFixed(4) + '%';
  track.style.setProperty('--marquee-offset', offset);
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  loadProducts();
  initMarquee();

  const staticEls = document.querySelectorAll('.highlight');
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
