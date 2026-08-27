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
    'nav-account': 'Account',
    'nav-my-orders': 'My Orders',
    'nav-my-address': 'My Addresses',
    'nav-sign-out': 'Sign Out',
    'orders-loading': 'Loading your orders…',
    'orders-signed-out': 'Sign in to view your order history.',
    'orders-empty': "You haven't placed any orders yet.",
    'orders-load-error': 'Something went wrong loading your orders. Please try again.',
    'orders-order-number': 'Order',
    'checkout-total': 'Total',
    'cart-subtotal': 'Subtotal',
    'checkout-shipping-fee': 'Shipping Fee',
    'checkout-free': 'Free',
    'checkout-gst': 'GST',
    'checkout-standard-delivery': 'Standard Delivery',
    'checkout-self-collection': 'Self Collection',
    'checkout-pay-now': 'Pay Now',
    'checkout-submitting': 'Processing…',
    'checkout-error-generic': 'Something went wrong. Please try again, or contact us on WhatsApp.',
    'cart-order-success': 'Payment received — thank you! We’ll email you a confirmation shortly.',

    // Customer-facing status buckets — several DB statuses map to one label
    // here (e.g. paid + preparing both read as "Paid / Processing") since
    // the fulfilment sub-steps aren't meaningful to a customer yet. See
    // src/orders-page.ts#customerStatusBucket.
    'order-status-pending_payment': 'Awaiting Payment',
    'order-status-processing': 'Paid / Processing',
    'order-status-shipped': 'Out for Delivery',
    'order-status-completed': 'Completed',
    'order-status-cancelled': 'Cancelled',
    'order-status-expired': 'Payment Expired',
    'order-status-payment_failed': 'Payment Failed',
    'order-status-refunded': 'Refunded',
    'order-status-payment_review': 'Verifying Payment',

    'orders-filter-all': 'All',
    'orders-filter-active': 'Active',
    'orders-filter-closed': 'Completed',

    'orders-action-continue-payment': 'Continue Payment',
    'orders-action-cancel-order': 'Cancel Order',
    'orders-action-cancel-confirm': 'Cancel this order? Any reserved stock will be released.',
    'orders-action-cancel-yes': 'Yes, Cancel',
    'orders-action-cancel-no': 'Keep Order',
    'orders-action-view-detail': 'View Details',
    'orders-action-back-to-list': '‹ Back to Orders',
    'orders-action-contact-support': 'Contact Support',
    'orders-action-buy-again': 'Buy Again',
    'orders-action-retry-checkout': 'Retry Checkout',
    'orders-action-error': 'Something went wrong. Please try again or contact us.',
    'orders-action-cancelled-toast': 'Order cancelled — the reserved stock has been released.',
    'orders-action-already-paid': 'This order was already paid and can no longer be cancelled — refreshing…',
    'orders-action-buy-again-added': 'Added to your cart.',
    'orders-action-buy-again-partial': 'Some items are no longer available and were skipped.',
    'orders-action-buy-again-none': 'These items are no longer available.',

    'orders-countdown-pay-by': 'Please complete payment before {time} — unpaid stock will be released automatically after that.',
    'orders-payment-expired': 'This payment window has expired — the reserved stock has been released.',
    'orders-payment-review-note': "We're verifying this payment — no action needed. This can take a few minutes; contact us if it doesn't update soon.",

    'orders-detail-recipient': 'Recipient',
    'orders-detail-delivery-method': 'Delivery Method',
    'orders-detail-address': 'Delivery Address',
    'orders-detail-payment-status': 'Payment Status',
    'orders-detail-refunded-amount': 'Refunded',

    'footer-terms': 'Terms & Conditions', 'footer-privacy': 'Privacy Policy', 'footer-delivery': 'Delivery Policy',
    'footer-refund': 'Refund & Returns', 'footer-age': 'Responsible Drinking',
  },
  zh: {
    'page-title-orders': '我的订单',
    'nav-sign-in': '登录',
    'nav-account': '账户',
    'nav-my-orders': '我的订单',
    'nav-my-address': '我的地址',
    'nav-sign-out': '退出登录',
    'orders-loading': '正在加载您的订单…',
    'orders-signed-out': '登录后即可查看订单记录。',
    'orders-empty': '您还没有任何订单。',
    'orders-load-error': '加载订单时出错，请重试。',
    'orders-order-number': '订单号',
    'checkout-total': '总计',
    'cart-subtotal': '小计',
    'checkout-shipping-fee': '运费',
    'checkout-free': '免费',
    'checkout-gst': '消费税(GST)',
    'checkout-standard-delivery': '标准配送',
    'checkout-self-collection': '自提',
    'checkout-pay-now': '立即支付',
    'checkout-submitting': '处理中…',
    'checkout-error-generic': '出现错误，请重试或通过 WhatsApp 联系我们。',
    'cart-order-success': '支付成功，感谢您的订购！确认邮件稍后发送。',

    'order-status-pending_payment': '待付款',
    'order-status-processing': '已付款/处理中',
    'order-status-shipped': '配送中',
    'order-status-completed': '已完成',
    'order-status-cancelled': '已取消',
    'order-status-expired': '支付已过期',
    'order-status-payment_failed': '付款失败',
    'order-status-refunded': '已退款',
    'order-status-payment_review': '处理中，请稍候',

    'orders-filter-all': '全部',
    'orders-filter-active': '进行中',
    'orders-filter-closed': '已完成',

    'orders-action-continue-payment': '继续付款',
    'orders-action-cancel-order': '取消订单',
    'orders-action-cancel-confirm': '确定要取消这个订单吗？已锁定的库存将会释放。',
    'orders-action-cancel-yes': '确认取消',
    'orders-action-cancel-no': '返回',
    'orders-action-view-detail': '查看详情',
    'orders-action-back-to-list': '‹ 返回订单列表',
    'orders-action-contact-support': '联系客服',
    'orders-action-buy-again': '再次购买',
    'orders-action-retry-checkout': '重新结账',
    'orders-action-error': '操作失败，请重试或联系客服。',
    'orders-action-cancelled-toast': '订单已取消，库存已释放。',
    'orders-action-already-paid': '该订单已完成付款，无法取消，正在刷新…',
    'orders-action-buy-again-added': '已加入购物车。',
    'orders-action-buy-again-partial': '部分商品已下架或缺货，已自动跳过。',
    'orders-action-buy-again-none': '这些商品目前已无法购买。',

    'orders-countdown-pay-by': '请在 {time} 前完成付款，超时后库存将自动释放。',
    'orders-payment-expired': '支付已过期，库存已释放。',
    'orders-payment-review-note': '我们正在核实这笔付款，无需操作。这可能需要几分钟；如长时间未更新请联系我们。',

    'orders-detail-recipient': '收件人',
    'orders-detail-delivery-method': '配送方式',
    'orders-detail-address': '配送地址',
    'orders-detail-payment-status': '支付状态',
    'orders-detail-refunded-amount': '已退款金额',

    'footer-terms': '条款与条件', 'footer-privacy': '隐私政策', 'footer-delivery': '配送政策',
    'footer-refund': '退款与退货', 'footer-age': '理性饮酒',
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
