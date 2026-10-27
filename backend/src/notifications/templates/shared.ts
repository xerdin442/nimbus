export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const layout = (body: string) =>
  `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">${body}</body></html>`;

export const formatMoney = (amount: number, currency: string): string =>
  new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).format(amount / 100);
