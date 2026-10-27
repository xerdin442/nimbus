import type { RenderedEmail } from '@src/common/types';
import { escapeHtml, formatMoney, layout } from './shared';

/** Alert to `organizations.notification_email`: emails are failing permanently. */
export const deliveryFailedAlertEmail = (input: {
  orgName: string;
  failedCount: number;
  failureReason: string;
  since: Date;
}): RenderedEmail => ({
  subject: `Nimbus: Customer emails are failing for ${input.orgName}`,
  html: layout(
    `<p>${input.failedCount} customer email${input.failedCount === 1 ? '' : 's'} failed since ${escapeHtml(
      input.since.toISOString(),
    )} (reason: <strong>${escapeHtml(input.failureReason)}</strong>).</p>
     <p>Check your email provider connection in the Nimbus dashboard, then retry the failed sends from the email log.</p>`,
  ),
  text: `${input.failedCount} customer email(s) failed since ${input.since.toISOString()} (reason: ${input.failureReason}).\n\nCheck your email provider connection in the Nimbus dashboard, then retry the failed sends from the email log.`,
});

/** Alert to `organizations.notification_email`: a refund could not be completed. */
export const refundFailedAlertEmail = (input: {
  orgName: string;
  reservationCode: string;
  amount: number;
  currency: string;
}): RenderedEmail => ({
  subject: `Nimbus: Refund failed for ${input.orgName}`,
  html: layout(
    `<p>The refund of ${formatMoney(input.amount, input.currency)} for reservation <strong>${escapeHtml(
      input.reservationCode,
    )}</strong> failed.</p>
     <p>Retry it from the reservation detail view in the Nimbus dashboard once the issue with your payment provider is resolved.</p>`,
  ),
  text: `The refund of ${formatMoney(input.amount, input.currency)} for reservation ${input.reservationCode} failed.\n\nRetry it from the reservation detail view in the Nimbus dashboard once the issue with your payment provider is resolved.`,
});
