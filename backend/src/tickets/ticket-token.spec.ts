import { signTicketToken, verifyTicketToken } from './ticket-token';

describe('ticket tokens', () => {
  const ticketId = '0b6f6c3e-9a3d-4c1e-8f7a-2d9e4b5c6a71';

  it('round-trips the ticket id and mode', () => {
    expect(verifyTicketToken(signTicketToken(ticketId, true))).toEqual({
      ticketId,
      livemode: true,
    });
    expect(verifyTicketToken(signTicketToken(ticketId, false))).toEqual({
      ticketId,
      livemode: false,
    });
  });

  it('looks like tk1.<mode>.<id>.<signature>', () => {
    expect(signTicketToken(ticketId, false)).toMatch(
      /^tk1\.test\.[\w-]{22}\.[\w-]{22}$/,
    );
  });

  it('rejects a token whose mode was edited (test ticket passed off as live)', () => {
    const forged = signTicketToken(ticketId, false).replace('.test.', '.live.');
    expect(verifyTicketToken(forged)).toBeNull();
  });

  it('rejects a token pointing at another ticket', () => {
    const [version, mode, , signature] = signTicketToken(ticketId, true).split(
      '.',
    );
    const otherId = Buffer.from('ffffffffffffffffffffffffffffffff', 'hex');
    expect(
      verifyTicketToken(
        `${version}.${mode}.${otherId.toString('base64url')}.${signature}`,
      ),
    ).toBeNull();
  });

  it('rejects malformed tokens', () => {
    for (const token of [
      '',
      'tk1.live',
      'tk2.live.abc.def',
      'tk1.prod.abc.def',
      `${signTicketToken(ticketId, true)}x`,
    ]) {
      expect(verifyTicketToken(token)).toBeNull();
    }
  });
});
