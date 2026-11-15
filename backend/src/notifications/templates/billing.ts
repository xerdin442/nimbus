import type { RenderedEmail } from '@src/common/types';
import { escapeHtml, layout } from './shared';

const date = (value: Date) => escapeHtml(value.toISOString().slice(0, 10));

export const subscriptionActiveEmail = (input: {
  orgName: string;
  planName: string;
  nextPaymentDate: Date | null;
}): RenderedEmail => ({
  subject: `Nimbus: Your ${input.planName} subscription is active`,
  html: layout(
    `<p>Your <strong>${escapeHtml(input.planName)}</strong> subscription for <strong>${escapeHtml(input.orgName)}</strong> is active.</p>${
      input.nextPaymentDate
        ? `<p>Your next payment is due on ${date(input.nextPaymentDate)}.</p>`
        : ''
    }`,
  ),
  text: `Your ${input.planName} subscription for ${input.orgName} is active.${
    input.nextPaymentDate
      ? ` Your next payment is due on ${date(input.nextPaymentDate)}.`
      : ''
  }`,
});

export const renewalReminderEmail = (input: {
  orgName: string;
  planName: string;
  nextPaymentDate: Date;
}): RenderedEmail => ({
  subject: `Nimbus: Upcoming renewal for ${input.orgName}`,
  html: layout(
    `<p>The <strong>${escapeHtml(input.planName)}</strong> subscription for <strong>${escapeHtml(input.orgName)}</strong> renews on ${date(input.nextPaymentDate)}.</p>`,
  ),
  text: `The ${input.planName} subscription for ${input.orgName} renews on ${date(input.nextPaymentDate)}.`,
});

export const paymentFailedEmail = (input: {
  orgName: string;
  graceEndsAt: Date;
  billingUrl: string;
}): RenderedEmail => ({
  subject: `Nimbus: Payment failed for ${input.orgName}`,
  html: layout(
    `<p>We could not charge the payment method for <strong>${escapeHtml(input.orgName)}</strong>.</p>
     <p>Update your card before <strong>${date(input.graceEndsAt)}</strong> to keep live features. After that, the subscription will be suspended until payment succeeds.</p>
     <p><a href="${escapeHtml(input.billingUrl)}">Open billing</a></p>`,
  ),
  text: `We could not charge the payment method for ${input.orgName}. Update your card before ${date(input.graceEndsAt)} to keep live features. After that, the subscription will be suspended until payment succeeds.\n\nOpen billing: ${input.billingUrl}`,
});

export const subscriptionSuspendedEmail = (input: {
  orgName: string;
  planName: string;
  billingUrl: string;
}): RenderedEmail => ({
  subject: `Nimbus: ${input.orgName} subscription suspended`,
  html: layout(
    `<p>The <strong>${escapeHtml(input.planName)}</strong> subscription for <strong>${escapeHtml(input.orgName)}</strong> is suspended because the renewal payment did not go through.</p>
     <p>Live features are unavailable until you pay. <a href="${escapeHtml(input.billingUrl)}">Open billing</a> to restore access.</p>`,
  ),
  text: `The ${input.planName} subscription for ${input.orgName} is suspended because the renewal payment did not go through. Live features are unavailable until you pay.\n\nOpen billing: ${input.billingUrl}`,
});

export const subscriptionCancelledEmail = (input: {
  orgName: string;
  planName: string;
}): RenderedEmail => ({
  subject: `Nimbus: ${input.orgName} subscription cancelled`,
  html: layout(
    `<p>The <strong>${escapeHtml(input.planName)}</strong> subscription for <strong>${escapeHtml(input.orgName)}</strong> has been cancelled.</p>
     <p>Your organization is now on Basic. You can subscribe again from the billing page.</p>`,
  ),
  text: `The ${input.planName} subscription for ${input.orgName} has been cancelled. Your organization is now on Basic. You can subscribe again from the billing page.`,
});

export const cardExpiringEmail = (input: {
  orgName: string;
  billingUrl: string;
}): RenderedEmail => ({
  subject: `Nimbus: Payment method expiring for ${input.orgName}`,
  html: layout(
    `<p>The payment method on file for <strong>${escapeHtml(input.orgName)}</strong> is about to expire.</p>
     <p><a href="${escapeHtml(input.billingUrl)}">Update your payment method</a> so your subscription keeps renewing.</p>`,
  ),
  text: `The payment method on file for ${input.orgName} is about to expire. Update it so your subscription keeps renewing: ${input.billingUrl}`,
});

export const subscriptionCancellationScheduledEmail = (input: {
  orgName: string;
  planName: string;
  accessUntil: Date;
}): RenderedEmail => ({
  subject: `Nimbus: ${input.orgName} subscription will end`,
  html: layout(
    `<p>The <strong>${escapeHtml(input.planName)}</strong> subscription for <strong>${escapeHtml(input.orgName)}</strong> will not renew.</p>
     <p>You can keep using it until <strong>${date(input.accessUntil)}</strong>. After that, the organization moves to Basic unless you subscribe again.</p>`,
  ),
  text: `The ${input.planName} subscription for ${input.orgName} will not renew. You can keep using it until ${date(input.accessUntil)}. After that, the organization moves to Basic unless you subscribe again.`,
});

export const ticketUsageWarningEmail = (input: {
  orgName: string;
  used: number;
  limit: number;
  billingUrl: string;
}): RenderedEmail => ({
  subject: `Nimbus: ${input.orgName} is close to its ticket limit`,
  html: layout(
    `<p><strong>${escapeHtml(input.orgName)}</strong> has sold <strong>${input.used}</strong> of its <strong>${input.limit}</strong> monthly live tickets.</p>
     <p>Ticket sales continue, but upgrading your plan raises the limit. <a href="${escapeHtml(input.billingUrl)}">Review your plan</a></p>`,
  ),
  text: `${input.orgName} has sold ${input.used} of its ${input.limit} monthly live tickets. Ticket sales continue, but upgrading your plan raises the limit.\n\nReview your plan: ${input.billingUrl}`,
});

export const ticketUsageOverEmail = (input: {
  orgName: string;
  used: number;
  limit: number;
  billingUrl: string;
}): RenderedEmail => ({
  subject: `Nimbus: ${input.orgName} has reached its ticket limit`,
  html: layout(
    `<p><strong>${escapeHtml(input.orgName)}</strong> has sold <strong>${input.used}</strong> live tickets this month against a plan limit of <strong>${input.limit}</strong>.</p>
     <p>Sales continue until the hard stop. <a href="${escapeHtml(input.billingUrl)}">Upgrade your plan</a> to keep selling.</p>`,
  ),
  text: `${input.orgName} has sold ${input.used} live tickets this month against a plan limit of ${input.limit}. Sales continue until the hard stop.\n\nUpgrade your plan: ${input.billingUrl}`,
});
