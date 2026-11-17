import type { EmailBranding } from '@src/common/types';

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export interface LayoutOptions {
  orgName?: string;
  branding?: EmailBranding | null;
}

const SOCIAL_LABELS = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  twitter: 'Twitter',
  tiktok: 'TikTok',
} as const;

const socialEntries = (branding: EmailBranding) =>
  (
    Object.entries(SOCIAL_LABELS) as [keyof typeof SOCIAL_LABELS, string][]
  ).filter(([key]) => Boolean(branding.socials[key]));

const socialLinks = (branding: EmailBranding): string =>
  socialEntries(branding)
    .map(
      ([key, label]) =>
        `<a href="${escapeHtml(branding.socials[key]!)}" style="color:#111;margin-right:12px">${label}</a>`,
    )
    .join('');

const brandingHeader = (branding: EmailBranding, orgName?: string): string => {
  const header = branding.headerImageUrl
    ? `<img src="${escapeHtml(branding.headerImageUrl)}" alt="" style="display:block;width:100%;max-height:240px;object-fit:cover;border-radius:6px">`
    : '';
  const logo = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(orgName ?? '')}" style="display:block;max-width:160px;max-height:48px;margin:16px 0">`
    : orgName
      ? `<p style="font-weight:600;font-size:16px;margin:16px 0">${escapeHtml(orgName)}</p>`
      : '';
  return `${header}${logo}`;
};

const brandingFooter = (branding: EmailBranding, orgName?: string): string => {
  const links = socialLinks(branding);
  return `<hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 12px">
    ${orgName ? `<p style="font-size:12px;color:#6b7280;margin:0 0 6px">${escapeHtml(orgName)}</p>` : ''}
    ${links ? `<p style="font-size:12px;margin:0">${links}</p>` : ''}`;
};

export const layout = (body: string, options: LayoutOptions = {}): string => {
  const { orgName, branding } = options;
  if (!branding) {
    return `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">${body}</body></html>`;
  }

  return `<!doctype html><html><body style="margin:0;background:#f6f7f9">
  <div style="max-width:600px;margin:0 auto;padding:24px;background:#fff;font-family:system-ui,sans-serif;line-height:1.5;color:#111">
    ${brandingHeader(branding, orgName)}
    ${body}
    ${brandingFooter(branding, orgName)}
  </div></body></html>`;
};

export const textFooter = (
  branding: EmailBranding,
  orgName?: string,
): string => {
  const links = socialEntries(branding)
    .map(([key, label]) => `${label}: ${branding.socials[key]}`)
    .join('\n');
  const name = orgName ? `\n${orgName}` : '';
  const socials = links ? `\n\n${links}` : '';
  return `${name}${socials}`;
};

export const formatMoney = (amount: number, currency: string): string =>
  new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).format(amount / 100);
