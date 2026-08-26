// Minimal, self-contained EN/ZH bridge for orders.html.
//
// Deliberately NOT sharing script.js: that file boots the product grid,
// filters, search, and marquee, several of whose DOM lookups aren't
// null-guarded, so loading it here would throw (same reasoning as
// policies/policy-i18n.js). Unlike that file, this one exposes the
// window.TG_I18N / window.TG_ON_LANG_CHANGE bridge shape instead of a
// data-i18n-only one, because src/orders-page.ts and the #navAccount
// indicator in src/cart.ts both call window.TG_I18N.t() through
// src/i18n.ts, not data-i18n attributes.
//
// Shares policy-i18n.js's localStorage key so a language choice made on
// either page carries over to the other.

const ORDERS_LANG_KEY = 'tg_lang';

const ordersTranslations = {
  en: {
    'page-title-orders': 'My Orders',
    'nav-sign-in': 'Sign In',
    'nav-my-orders': 'My Orders',
    'nav-my-address': 'My Address',
    'nav-sign-out': 'Sign Out',
    'nav-account-menu': 'Account menu',
    'orders-loading': 'Loading your orders…',
    'orders-signed-out': 'Sign in to view your order history.',
    'orders-empty': "You haven't placed any orders yet.",
    'orders-load-error': 'Something went wrong loading your orders. Please try again.',
    'orders-order-number': 'Order',
    'checkout-total': 'Total',
    'order-status-pending_payment': 'Awaiting Payment',
    'order-status-paid': 'Paid',
    'order-status-preparing': 'Preparing',
    'order-status-ready_for_collection': 'Ready for Collection',
    'order-status-out_for_delivery': 'Out for Delivery',
    'order-status-completed': 'Completed',
    'order-status-cancelled': 'Cancelled',
    'order-status-refunded': 'Refunded',
    'order-status-payment_failed': 'Payment Failed',
  },
  zh: {
    'page-title-orders': '我的订单',
    'nav-sign-in': '登录',
    'nav-my-orders': '我的订单',
    'nav-my-address': '我的地址',
    'nav-sign-out': '退出登录',
    'nav-account-menu': '账户菜单',
    'orders-loading': '正在加载您的订单…',
    'orders-signed-out': '登录后即可查看订单记录。',
    'orders-empty': '您还没有任何订单。',
    'orders-load-error': '加载订单时出错，请重试。',
    'orders-order-number': '订单号',
    'checkout-total': '总计',
    'order-status-pending_payment': '待付款',
    'order-status-paid': '已付款',
    'order-status-preparing': '备货中',
    'order-status-ready_for_collection': '待取货',
    'order-status-out_for_delivery': '配送中',
    'order-status-completed': '已完成',
    'order-status-cancelled': '已取消',
    'order-status-refunded': '已退款',
    'order-status-payment_failed': '支付失败',
  },
};

let ordersLang = localStorage.getItem(ORDERS_LANG_KEY) === 'zh' ? 'zh' : 'en';

function ordersT(key) {
  return ordersTranslations[ordersLang][key] ?? ordersTranslations.en[key] ?? key;
}

window.TG_I18N = {
  t: ordersT,
  getLang: () => ordersLang,
};
window.TG_ON_LANG_CHANGE = [];

function applyOrdersTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.innerHTML = ordersT(el.dataset.i18n);
  });
  const langToggle = document.getElementById('langToggle');
  if (langToggle) langToggle.textContent = ordersLang === 'en' ? 'English' : '中文';
  document.documentElement.lang = ordersLang === 'zh' ? 'zh-CN' : 'en';
}

function toggleOrdersLanguage() {
  ordersLang = ordersLang === 'en' ? 'zh' : 'en';
  localStorage.setItem(ORDERS_LANG_KEY, ordersLang);
  applyOrdersTranslations();
  window.TG_ON_LANG_CHANGE.forEach((cb) => {
    try {
      cb();
    } catch (err) {
      console.error(err);
    }
  });
}

document.addEventListener('DOMContentLoaded', applyOrdersTranslations);
