// Minimal, self-contained EN/ZH bridge for addresses.html — same reasoning
// as orders-i18n.js (deliberately not sharing script.js, which assumes
// product-grid DOM that doesn't exist here). Shares policy-i18n.js's
// localStorage key so a language choice made on any of these pages carries
// over to the others.

const ADDRESSES_LANG_KEY = 'tg_lang';

const addressesTranslations = {
  en: {
    'page-title-addresses': 'My Addresses',
    'nav-sign-in': 'Sign In',
    'nav-account': 'Account',
    'nav-my-orders': 'My Orders',
    'nav-my-address': 'My Addresses',
    'nav-sign-out': 'Sign Out',
    'addresses-loading': 'Loading your addresses…',
    'addresses-signed-out': 'Sign in to manage your saved addresses.',
    'addresses-empty-title': "You haven't saved any addresses yet.",
    'addresses-empty-subtitle': 'Save an address you use often to check out faster next time.',
    'addresses-load-error': 'Something went wrong loading your addresses. Please try again.',
    'addresses-untitled': 'Address',
    'addresses-default-badge': 'Default',
    'addresses-set-default': 'Set as Default',
    'addresses-edit': 'Edit',
    'addresses-delete': 'Delete',
    'addresses-add-new': 'Add New Address',
    'addresses-cancel': 'Cancel',
    'addresses-save': 'Save Address',
    'addresses-update': 'Save Changes',
    'addresses-field-label': 'Label (e.g. Home, Office)',
    'addresses-field-recipient': 'Recipient Name',
    'addresses-field-phone': 'Phone Number',
    'addresses-field-postal': 'Postal Code',
    'addresses-field-address': 'Street / Building Address',
    'addresses-field-unit': 'Unit Number (e.g. #11-03, optional)',
    'addresses-field-default': 'Set as default address',
    'addresses-error-required': 'Please fill in recipient name, phone, address, and postal code.',
    'addresses-error-save': 'Something went wrong saving this address. Please try again.',
    'checkout-submitting': 'Submitting…',
    'footer-terms': 'Terms & Conditions', 'footer-privacy': 'Privacy Policy', 'footer-delivery': 'Delivery Policy',
    'footer-refund': 'Refund & Returns', 'footer-age': 'Responsible Drinking',
  },
  zh: {
    'page-title-addresses': '我的地址',
    'nav-sign-in': '登录',
    'nav-account': '账户',
    'nav-my-orders': '我的订单',
    'nav-my-address': '我的地址',
    'nav-sign-out': '退出登录',
    'addresses-loading': '正在加载您的地址…',
    'addresses-signed-out': '登录后即可管理已保存的地址。',
    'addresses-empty-title': '您还没有保存地址',
    'addresses-empty-subtitle': '保存常用地址后，结账时可以快速填写。',
    'addresses-load-error': '加载地址时出错，请重试。',
    'addresses-untitled': '地址',
    'addresses-default-badge': '默认',
    'addresses-set-default': '设为默认',
    'addresses-edit': '编辑',
    'addresses-delete': '删除',
    'addresses-add-new': '添加新地址',
    'addresses-cancel': '取消',
    'addresses-save': '保存地址',
    'addresses-update': '保存修改',
    'addresses-field-label': '标签（如：家、公司）',
    'addresses-field-recipient': '收件人姓名',
    'addresses-field-phone': '联系电话',
    'addresses-field-postal': '邮编',
    'addresses-field-address': '详细地址（街道/大厦）',
    'addresses-field-unit': '单元号（如 #11-03，选填）',
    'addresses-field-default': '设为默认地址',
    'addresses-error-required': '请填写收件人姓名、电话、地址和邮编。',
    'addresses-error-save': '保存地址时出错，请重试。',
    'checkout-submitting': '提交中…',
    'footer-terms': '条款与条件', 'footer-privacy': '隐私政策', 'footer-delivery': '配送政策',
    'footer-refund': '退款与退货', 'footer-age': '理性饮酒',
  },
};

let addressesLang = localStorage.getItem(ADDRESSES_LANG_KEY) === 'zh' ? 'zh' : 'en';

function addressesT(key) {
  return addressesTranslations[addressesLang][key] ?? addressesTranslations.en[key] ?? key;
}

window.TG_I18N = {
  t: addressesT,
  getLang: () => addressesLang,
};
window.TG_ON_LANG_CHANGE = [];

function applyAddressesTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.innerHTML = addressesT(el.dataset.i18n);
  });
  const langToggle = document.getElementById('langToggle');
  if (langToggle) langToggle.textContent = addressesLang === 'en' ? 'English' : '中文';
  document.documentElement.lang = addressesLang === 'zh' ? 'zh-CN' : 'en';
}

function toggleAddressesLanguage() {
  addressesLang = addressesLang === 'en' ? 'zh' : 'en';
  localStorage.setItem(ADDRESSES_LANG_KEY, addressesLang);
  applyAddressesTranslations();
  window.TG_ON_LANG_CHANGE.forEach((cb) => {
    try {
      cb();
    } catch (err) {
      console.error(err);
    }
  });
}

document.addEventListener('DOMContentLoaded', applyAddressesTranslations);
