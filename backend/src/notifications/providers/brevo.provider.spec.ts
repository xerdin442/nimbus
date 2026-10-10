import { BrevoProvider, parseAddress } from './brevo.provider';
import { MailProviderError } from './mail-provider.interface';

const message = {
  from: 'Filmhouse <tickets@filmhouse.test>',
  to: 'ada@example.com',
  subject: 'Your tickets',
  html: '<p>Hi</p>',
  text: 'Hi',
  replyTo: 'support@filmhouse.test',
};

const respond = (status: number, body: unknown) =>
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
    }),
  );

const failureKind = (provider: BrevoProvider) =>
  provider.send(message).then(
    () => 'sent',
    (error: unknown) =>
      error instanceof MailProviderError ? error.kind : 'unclassified',
  );

describe('BrevoProvider', () => {
  const provider = new BrevoProvider('xkeysib-test');

  afterEach(() => jest.restoreAllMocks());

  it('sends sender, recipient, content and reply-to in Brevo’s shape', async () => {
    const fetchMock = respond(201, { messageId: '<abc@brevo>' });

    await expect(provider.send(message)).resolves.toEqual({
      messageId: '<abc@brevo>',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((init!.headers as Record<string, string>)['api-key']).toBe(
      'xkeysib-test',
    );
    expect(JSON.parse(init!.body as string)).toEqual({
      sender: { name: 'Filmhouse', email: 'tickets@filmhouse.test' },
      to: [{ email: 'ada@example.com' }],
      subject: 'Your tickets',
      htmlContent: '<p>Hi</p>',
      textContent: 'Hi',
      replyTo: { email: 'support@filmhouse.test' },
    });
  });

  it('treats any 2xx as sent, even without a messageId (no retry, no duplicate)', async () => {
    respond(201, {});

    await expect(provider.send(message)).resolves.toEqual({
      messageId: 'unknown',
    });
  });

  it.each([
    [401, { message: 'Key not found' }, 'auth'],
    [403, { message: 'Permission denied' }, 'auth'],
    [400, { message: 'invalid email' }, 'rejected'],
    [429, { message: 'Too many requests' }, 'unavailable'],
    [500, { message: 'Internal error' }, 'unavailable'],
  ])('classifies HTTP %i as %s', async (status, body, kind) => {
    respond(status, body);

    await expect(failureKind(provider)).resolves.toBe(kind);
  });

  it('classifies a non-JSON 502 from a gateway as unavailable, not an unclassified error', async () => {
    respond(502, '<html><body>Bad Gateway</body></html>');

    const error = await provider.send(message).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MailProviderError);
    expect(error).toMatchObject({ kind: 'unavailable', message: 'HTTP 502' });
  });

  it('classifies a network failure or timeout as unavailable', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNRESET'));

    await expect(failureKind(provider)).resolves.toBe('unavailable');
  });
});

describe('parseAddress', () => {
  it.each([
    [
      'Filmhouse <tickets@filmhouse.test>',
      { name: 'Filmhouse', email: 'tickets@filmhouse.test' },
    ],
    [
      '<tickets@filmhouse.test>',
      { name: undefined, email: 'tickets@filmhouse.test' },
    ],
    [' tickets@filmhouse.test ', { email: 'tickets@filmhouse.test' }],
  ])('%s', (input, expected) => {
    expect(parseAddress(input)).toEqual(expected);
  });
});
