// Minimal, self-contained EN/ZH toggle for the policy pages.
//
// Deliberately NOT sharing script.js: that file boots the product grid,
// filters, search, and marquee — none of which exist on a policy page, and
// several of its DOM lookups (e.g. `document.getElementById('filterTabs')`)
// aren't null-guarded, so loading it here would throw. This file only
// carries what a policy page actually needs.
//
// Two translation layers, deliberately different mechanisms:
// - Page chrome (breadcrumb, heading) uses `data-i18n` + the short-string
//   dictionaries below, like the rest of the site.
// - The legal body itself is two full blocks per page —
//   `<div data-policy-body="en">`/`<div data-policy-body="zh">` — toggled by
//   hiding whichever doesn't match the current language. Full prose doesn't
//   fit the short-string-dictionary pattern well (a paragraph with a link
//   inside it as a JS string is unreadable to maintain), and this way the
//   two languages are never both visible stacked on the page at once.

const POLICY_LANG_KEY = 'tg_lang';

const policyTranslations = {
  en: {
    'policy-eyebrow-legal': 'Legal',
    'breadcrumb-terms': 'Terms & Conditions',
    'breadcrumb-privacy': 'Privacy Policy',
    'breadcrumb-delivery': 'Delivery Policy',
    'breadcrumb-refund': 'Refund & Returns',
    'breadcrumb-age': 'Responsible Drinking',
    'h1-terms': 'Terms & Conditions',
    'h1-privacy': 'Privacy Policy',
    'h1-delivery': 'Delivery Policy',
    'h1-refund': 'Refund & Return Policy',
    'h1-age': 'Responsible Drinking & Age Restriction Notice',
    'footer-terms': 'Terms & Conditions',
    'footer-privacy': 'Privacy Policy',
    'footer-delivery': 'Delivery Policy',
    'footer-refund': 'Refund & Returns',
    'footer-age': 'Responsible Drinking',
  },
  zh: {
    'policy-eyebrow-legal': '法律',
    'breadcrumb-terms': '条款与条件',
    'breadcrumb-privacy': '隐私政策',
    'breadcrumb-delivery': '配送政策',
    'breadcrumb-refund': '退款与退货',
    'breadcrumb-age': '理性饮酒',
    'h1-terms': '条款与条件',
    'h1-privacy': '隐私政策',
    'h1-delivery': '配送政策',
    'h1-refund': '退款与退货政策',
    'h1-age': '理性饮酒与年龄限制须知',
    'footer-terms': '条款与条件',
    'footer-privacy': '隐私政策',
    'footer-delivery': '配送政策',
    'footer-refund': '退款与退货',
    'footer-age': '理性饮酒',
  },
};

let policyLang = localStorage.getItem(POLICY_LANG_KEY) === 'zh' ? 'zh' : 'en';

function policyT(key) {
  return policyTranslations[policyLang][key] ?? policyTranslations.en[key] ?? key;
}

function applyPolicyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.innerHTML = policyT(el.dataset.i18n);
  });

  document.querySelectorAll('[data-policy-body]').forEach((el) => {
    el.hidden = el.dataset.policyBody !== policyLang;
  });

  const langToggle = document.getElementById('langToggle');
  if (langToggle) langToggle.textContent = policyLang === 'en' ? 'English' : '中文';

  document.documentElement.lang = policyLang === 'zh' ? 'zh-CN' : 'en';
}

function togglePolicyLanguage() {
  policyLang = policyLang === 'en' ? 'zh' : 'en';
  localStorage.setItem(POLICY_LANG_KEY, policyLang);
  applyPolicyTranslations();
}

document.addEventListener('DOMContentLoaded', applyPolicyTranslations);
