// Minimal, self-contained EN/ZH toggle for the policy pages.
//
// Deliberately NOT sharing script.js: that file boots the product grid,
// filters, search, and marquee — none of which exist on a policy page, and
// several of its DOM lookups (e.g. `document.getElementById('filterTabs')`)
// aren't null-guarded, so loading it here would throw. This file only
// carries what a policy page actually needs.
//
// Scope: only page chrome (breadcrumb, heading, nav toggle) is translated
// right now. The legal body text below it is still English-only — it isn't
// wired to data-i18n, so toggling language can't show a missing/incorrect
// translation for it. Once real Chinese copy for a page's body exists, add
// data-i18n attributes there and a matching zh entry below; nothing else
// needs to change.

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
    'policy-lang-notice': 'The information on this page is currently available in English only. A Chinese translation is coming soon.',
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
    'policy-lang-notice': '本页面内容目前仅提供英文版本，中文翻译稍后补充。',
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

  const langToggle = document.getElementById('langToggle');
  if (langToggle) langToggle.textContent = policyLang === 'en' ? 'English' : '中文';

  const notice = document.getElementById('policyLangNotice');
  if (notice) notice.hidden = policyLang !== 'zh';

  document.documentElement.lang = policyLang === 'zh' ? 'zh-CN' : 'en';
}

function togglePolicyLanguage() {
  policyLang = policyLang === 'en' ? 'zh' : 'en';
  localStorage.setItem(POLICY_LANG_KEY, policyLang);
  applyPolicyTranslations();
}

document.addEventListener('DOMContentLoaded', applyPolicyTranslations);
