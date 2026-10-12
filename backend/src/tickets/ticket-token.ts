import { createHmac, timingSafeEqual } from 'crypto';
import { Secrets } from '@src/common/secrets';
import type { QrTokenPayload } from '@src/common/types';

const VERSION = 'tk1';
const SIGNATURE_BYTES = 16;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sign = (body: string): string =>
  createHmac('sha256', Secrets.TICKET_SIGNING_SECRET)
    .update(body)
    .digest()
    .subarray(0, SIGNATURE_BYTES)
    .toString('base64url');

/**
 * What a ticket's QR code encodes: `tk1.<test|live>.<ticket id>.<signature>`. The HMAC covers the
 * mode and id, so a forged or edited code is rejected without a database lookup.
 */
export const signTicketToken = (
  ticketId: string,
  livemode: boolean,
): string => {
  const id = Buffer.from(ticketId.replace(/-/g, ''), 'hex').toString(
    'base64url',
  );
  const body = `${VERSION}.${livemode ? 'live' : 'test'}.${id}`;
  return `${body}.${sign(body)}`;
};

/** The ticket a token names, or null if it's malformed or the signature doesn't match. */
export const verifyTicketToken = (token: string): QrTokenPayload | null => {
  const parts = token.trim().split('.');
  if (parts.length !== 4) {
    return null;
  }

  const [version, mode, id, signature] = parts;
  if (version !== VERSION || (mode !== 'test' && mode !== 'live')) {
    return null;
  }

  const expected = Buffer.from(sign(`${version}.${mode}.${id}`));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }

  const hex = Buffer.from(id, 'base64url').toString('hex');
  const ticketId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

  return UUID_PATTERN.test(ticketId)
    ? { ticketId, livemode: mode === 'live' }
    : null;
};
