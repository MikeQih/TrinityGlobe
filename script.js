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

    // Cart / checkout (rendered by assets/storefront.js, src/cart.ts)
    'cart-add-btn': 'Add to Cart', 'cart-added': 'Added ✓',
    'cart-title': 'Your Cart', 'cart-empty': 'Your cart is empty.',
    'cart-continue-shopping': 'Continue Shopping',
    'cart-subtotal': 'Subtotal', 'cart-remove': 'Remove',
    'cart-qty-decrease': 'Decrease quantity', 'cart-qty-increase': 'Increase quantity', 'cart-qty-label': 'Quantity',
    'cart-checkout-btn': 'Checkout',
    'cart-free-shipping-hint': 'Add {amount} more for free delivery',
    'cart-free-shipping-met': "You've unlocked free delivery!",
    'cart-close': 'Close cart',
    'cart-order-success': 'Payment received — thank you! We’ll email you a confirmation shortly.',
    'cart-order-cancelled': 'Checkout was cancelled — your cart has been saved.',
    'cart-tier-case': 'Case price', 'cart-tier-five-case': '5-case price',
    'checkout-back-to-cart': '‹ Back to cart',
    'checkout-title': 'Checkout',
    'checkout-account-lead': 'Sign in to view this order later, or continue as a guest.',
    'checkout-signin-google': 'Sign in with Google',
    'checkout-signin-facebook': 'Sign in with Facebook',
    'checkout-continue-guest': 'Continue as Guest',
    'checkout-signed-in-as': 'Signed in as',
    'checkout-sign-out': 'Sign out',
    'checkout-name': 'Full Name', 'checkout-phone': 'Phone Number', 'checkout-email': 'Email',
    'checkout-address': 'Delivery Address', 'checkout-postal': 'Postal Code',
    'checkout-notes': 'Order Notes (optional)',
    'checkout-delivery-method': 'Delivery Method',
    'checkout-standard-delivery': 'Standard Delivery', 'checkout-self-collection': 'Self Collection',
    'checkout-standard-delivery-info': 'Delivered to the address below. Free above S$120, otherwise a flat S$15 delivery fee applies (shown in the total below).',
    'checkout-self-collection-info': 'Free — no delivery fee. We\'ll send the collection address, hours, and pickup instructions to the phone/email above once your order is confirmed; please wait for that notice before coming down.',
    'checkout-age-confirm': 'I confirm I am at least 18 years old. It is illegal to purchase alcohol if you are under the legal age.',
    'checkout-age-learn-more': 'Learn more',
    'checkout-age-required': 'Please confirm you are 18 or older to continue.',
    'checkout-shipping-fee': 'Shipping Fee', 'checkout-free': 'Free', 'checkout-gst': 'GST',
    'checkout-total': 'Total',
    'checkout-submit': 'Proceed to Payment', 'checkout-submitting': 'Processing…',
    'checkout-field-required': 'This field is required.',
    'checkout-error-generic': 'Something went wrong. Please try again, or contact us on WhatsApp.',
    'checkout-error-stock': 'Some items in your cart are no longer available in the requested quantity.',
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

    // 购物车 / 结账（由 assets/storefront.js 即 src/cart.ts 渲染）
    'cart-add-btn': '加入购物车', 'cart-added': '已加入 ✓',
    'cart-title': '购物车', 'cart-empty': '购物车是空的。',
    'cart-continue-shopping': '继续购物',
    'cart-subtotal': '小计', 'cart-remove': '移除',
    'cart-qty-decrease': '减少数量', 'cart-qty-increase': '增加数量', 'cart-qty-label': '数量',
    'cart-checkout-btn': '去结账',
    'cart-free-shipping-hint': '再购 {amount} 即可免运费',
    'cart-free-shipping-met': '已享受免运费！',
    'cart-close': '关闭购物车',
    'cart-order-success': '支付成功，感谢您的订购！确认邮件稍后发送。',
    'cart-order-cancelled': '结账已取消 —— 购物车内容已保留。',
    'cart-tier-case': '整箱价', 'cart-tier-five-case': '五箱价',
    'checkout-back-to-cart': '‹ 返回购物车',
    'checkout-title': '结账',
    'checkout-account-lead': '登录以便日后查看该订单，或以访客身份继续结账。',
    'checkout-signin-google': '使用 Google 登录',
    'checkout-signin-facebook': '使用 Facebook 登录',
    'checkout-continue-guest': '以访客身份继续',
    'checkout-signed-in-as': '已登录：',
    'checkout-sign-out': '退出登录',
    'checkout-name': '姓名', 'checkout-phone': '手机号', 'checkout-email': '邮箱',
    'checkout-address': '收货地址', 'checkout-postal': '邮编',
    'checkout-notes': '订单备注（选填）',
    'checkout-delivery-method': '配送方式',
    'checkout-standard-delivery': '标准配送', 'checkout-self-collection': '自提',
    'checkout-standard-delivery-info': '配送至下方填写的地址。订单满 S$120 免运费，未满则收取 S$15 运费（详见下方总计）。',
    'checkout-self-collection-info': '免费自提，不收取运费。订单确认后，我们会将具体自提地址、开放时间和取货说明发送到您填写的电话/邮箱，请等待通知后再前来取货。',
    'checkout-age-confirm': '我确认已达到法定饮酒年龄。未达法定年龄购买酒类属违法行为。',
    'checkout-age-learn-more': '了解详情',
    'checkout-age-required': '请先确认您已达到法定饮酒年龄。',
    'checkout-shipping-fee': '运费', 'checkout-free': '免费', 'checkout-gst': '消费税(GST)',
    'checkout-total': '总计',
    'checkout-submit': '前往支付', 'checkout-submitting': '处理中…',
    'checkout-field-required': '此项为必填。',
    'checkout-error-generic': '出现问题，请重试，或通过 WhatsApp 联系我们。',
    'checkout-error-stock': '购物车中部分商品库存不足，请调整数量。',
  },
};

function t(key) {
  return translations[currentLang][key] ?? translations.en[key] ?? key;
}

// ── Bridge for assets/storefront.js (src/cart.ts) ──
// `t` and `currentLang` live in this file's module-less top-level scope;
// currentLang is a `let` so it never becomes a `window` property on its own.
// Cart/checkout code needs to read the live language and re-render its own
// (non data-i18n) DOM — like formatted prices — whenever it changes, so we
// expose a tiny explicit API instead of relying on incidental globals.
window.TG_I18N = {
  t,
  getLang: () => currentLang,
};
window.TG_ON_LANG_CHANGE = [];

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

  window.TG_ON_LANG_CHANGE.forEach(cb => {
    try { cb(); } catch (err) { console.error(err); }
  });
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
// Purely informational — the actual "add to cart" control is the single
// button rendered below it in renderProducts (always adds 1 bottle). Buying
// case-size quantities happens by adjusting qty in the cart drawer instead,
// where it auto-prices to the case/five-case tier once qty crosses that
// threshold (src/pricing.ts#effectiveUnitPriceCents) — tried making each
// tier its own tap target on the card, but the price cells are too narrow
// on mobile to be a reliable tap target, so reverted to this.
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
  window.TG_PRODUCTS = products; // read by src/cart.ts to resolve sku -> name/image/price for optimistic cart UI
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
    <div class="product-card" data-category="${p.category}" data-sku="${p.sku || ''}">
      <div class="card-img-wrap">
        <img src="${p.image}" alt="${(p.nameEn || p.name).replace(/<br\s*\/?>/gi, ' ')}" loading="lazy" />
      </div>
      <div class="card-info">
        <span class="card-cat">${catLabel}</span>
        <h3>${primary}</h3>
        ${buildPriceGrid(p.prices)}
        ${p.prices && p.prices.bottle > 0 ? `<button class="add-cart-btn" type="button" data-sku="${p.sku || ''}" data-i18n="cart-add-btn">${t('cart-add-btn')}</button>` : ''}
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
