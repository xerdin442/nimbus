import { randomBytes, createHmac, timingSafeEqual } from 'crypto';

export const generateEndpointSecret = (): string =>
  `whsec_${randomBytes(24).toString('hex')}`;

export const signPayload = (secret: string, body: string): string => {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
};

export const verifyPayloadSignature = (
  secret: string,
  body: string,
  header: string | undefined,
): boolean => {
  if (!header) return false;

  const timestamp = /t=(\d+)/.exec(header)?.[1];
  const given = /^.*,v1=([0-9a-f]+)$/.exec(header)?.[1];
  if (!timestamp || !given) return false;

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest();
  const actual = Buffer.from(given, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
