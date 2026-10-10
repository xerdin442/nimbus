import type { RenderedEmail } from '@src/common/types';

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const layout = (body: string) =>
  `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">${body}</body></html>`;

export const invitationEmail = (input: {
  orgName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
}): RenderedEmail => {
  const org = escapeHtml(input.orgName);
  const inviter = escapeHtml(input.inviterName);
  const url = escapeHtml(input.acceptUrl);

  return {
    subject: `You've been invited to ${input.orgName} on Nimbus`,
    html: layout(
      `<p>${inviter} invited you to join <strong>${org}</strong> on Nimbus as a ${escapeHtml(input.role)}.</p>
       <p><a href="${url}">Accept the invitation</a></p>
       <p>This link expires in 7 days.</p>`,
    ),
    text: `${input.inviterName} invited you to join ${input.orgName} on Nimbus as a ${input.role}.\n\nAccept the invitation: ${input.acceptUrl}\n\nThis link expires in 7 days.`,
  };
};

export const mailConnectionTestEmail = (input: {
  orgName: string;
  provider: string;
}): RenderedEmail => ({
  subject: `Nimbus: ${input.provider} is connected for ${input.orgName}`,
  html: layout(
    `<p>This is a test email from Nimbus. <strong>${escapeHtml(input.provider)}</strong> is now connected for <strong>${escapeHtml(input.orgName)}</strong>, and booking emails will be sent through it.</p>`,
  ),
  text: `This is a test email from Nimbus. ${input.provider} is now connected for ${input.orgName}, and booking emails will be sent through it.`,
});

export const passwordResetEmail = (input: {
  name: string;
  resetUrl: string;
}): RenderedEmail => ({
  subject: 'Reset your Nimbus password',
  html: layout(
    `<p>Hi ${escapeHtml(input.name)},</p>
     <p>Someone asked to reset the password for your Nimbus account. If it was you, <a href="${escapeHtml(input.resetUrl)}">choose a new password</a>.</p>
     <p>This link expires in 1 hour and works once. If you didn't ask for this, ignore this email; your password won't change.</p>`,
  ),
  text: `Hi ${input.name},\n\nSomeone asked to reset the password for your Nimbus account. If it was you, choose a new password: ${input.resetUrl}\n\nThis link expires in 1 hour and works once. If you didn't ask for this, ignore this email; your password won't change.`,
});
