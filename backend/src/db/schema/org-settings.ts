import { boolean, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { id, timestamps } from './columns';
import { organizationId } from './organizations';

export const DEFAULT_ORG_SETTINGS = {
  adsMinutes: 15,
  cleanupMinutes: 15,
  holdMinutes: 10,
  sendTestEmailsToMe: false,
  companyLogo: null,
  companyLogoPublicId: null,
  emailHeaderImage: null,
  emailHeaderImagePublicId: null,
  tiktok: null,
  instagram: null,
  facebook: null,
  twitter: null,
} as const;

/** Scheduling and booking settings, one row per org, created on first update. */
export const orgSettings = pgTable('org_settings', {
  id: id(),
  organizationId: organizationId().unique(),
  /** Ads and trailers before the film: a showtime ends at start + ads + runtime. */
  adsMinutes: integer('ads_minutes')
    .notNull()
    .default(DEFAULT_ORG_SETTINGS.adsMinutes),
  /** Turnover after a showtime ends, before the next one can start on the same screen. */
  cleanupMinutes: integer('cleanup_minutes')
    .notNull()
    .default(DEFAULT_ORG_SETTINGS.cleanupMinutes),
  /** How long online reservations hold their seats while the customer pays. */
  holdMinutes: integer('hold_minutes')
    .notNull()
    .default(DEFAULT_ORG_SETTINGS.holdMinutes),
  /**
   * Send test-mode booking emails to the notification email instead of skipping them. Test-mode
   * emails are otherwise rendered, logged as `skipped` and previewable from the dashboard.
   */
  sendTestEmailsToMe: boolean('send_test_emails_to_me')
    .notNull()
    .default(false),
  companyLogo: text('company_logo'),
  companyLogoPublicId: text('company_logo_public_id'),
  emailHeaderImage: text('email_header_image'),
  emailHeaderImagePublicId: text('email_header_image_public_id'),
  tiktok: text('tiktok'),
  instagram: text('instagram'),
  facebook: text('facebook'),
  twitter: text('twitter'),
  ...timestamps,
});
