import { EntitlementsService } from '@src/entitlements/entitlements.service';
import { eventually, useE2eApp, type Session } from './utils/e2e-app';

/**
 * Phase 4c: live ticket quotas. Usage is counted per subscription-anchored month; new live
 * reservations stop at the hard stop, while box office sales are never gated.
 */
describe('Billing limits (e2e)', () => {
  const {
    ctx,
    dash,
    api,
    signup,
    verify,
    connectPaystack,
    verifyWebhook,
    createApiKey,
    location,
    seq,
  } = useE2eApp();

  interface Cinema {
    owner: Session;
    orgId: string;
    email: string;
    key: string;
    showtimeId: string;
  }

  const clearCaches = async (orgId: string) => {
    await ctx.app.get(EntitlementsService).clear(orgId);
  };

  const planId = async (key: string): Promise<string> => {
    const result = await ctx.ownerPool.query<{ id: string }>(
      'select id from plans where key = $1',
      [key],
    );
    return result.rows[0].id;
  };

  const setTicketLimit = async (
    orgId: string,
    monthly: number,
    hardStopPct: number,
  ) => {
    for (const [key, value] of [
      ['tickets.monthly', monthly],
      ['tickets.hard_stop_pct', hardStopPct],
    ] as const) {
      await ctx.ownerPool.query(
        `insert into entitlement_overrides (organization_id, key, value, reason, set_by)
         values ($1, $2, $3::jsonb, 'test', 'e2e')
         on conflict (organization_id, key)
         do update set value = excluded.value`,
        [orgId, key, JSON.stringify(value)],
      );
    }
    await clearCaches(orgId);
  };

  const setupCinema = async (): Promise<Cinema> => {
    const owner = await signup();
    await verify(owner);
    await connectPaystack(owner, 'test', 'sk_test_good');
    await verifyWebhook(owner, 'test', 'sk_test_good');
    await verifyWebhook(owner, 'live', 'sk_live_good');

    await dash('patch', '/organization/settings', owner)
      .send({ adsMinutes: 10, cleanupMinutes: 10 })
      .expect(200);

    const locationId = (
      await dash('post', '/locations', owner)
        .send(location('Filmhouse Lekki'))
        .expect(201)
    ).body.data.id as string;
    const screenId = (
      await dash('post', `/locations/${locationId}/screens`, owner)
        .send({ name: 'Screen 1' })
        .expect(201)
    ).body.data.id as string;
    await dash('put', `/screens/${screenId}/layout`, owner)
      .send({
        rows: 2,
        columns: 3,
        seats: [
          { row: 0, column: 0 },
          { row: 0, column: 1 },
          { row: 0, column: 2 },
          { row: 1, column: 0, type: 'vip' },
          { row: 1, column: 2, type: 'vip' },
        ],
      })
      .expect(200);

    const movieId = (
      await dash('post', '/movies', owner, 'live')
        .send({ title: 'Anikulapo', runtimeMinutes: 100 })
        .expect(201)
    ).body.data.id as string;

    await ctx.ownerPool.query(
      `insert into subscriptions (organization_id, plan_id, status, started_at)
       values ($1, $2, 'active', now())`,
      [owner.orgId, await planId('pro_monthly')],
    );
    await clearCaches(owner.orgId);

    const key = await createApiKey(owner, 'secret', 'live');
    const startsAt = new Date(Date.now() + 30 * 60_000);
    const showtimeId = (
      await dash('post', '/showtimes', owner, 'live')
        .send({
          screenId,
          movieId,
          startsAt: startsAt.toISOString(),
          prices: { standard: 300000, vip: 500000 },
        })
        .expect(201)
    ).body.data.id as string;
    await dash(
      'post',
      `/showtimes/${showtimeId}/publish`,
      owner,
      'live',
    ).expect(200);

    return {
      owner,
      orgId: owner.orgId,
      email: owner.email,
      key,
      showtimeId,
    };
  };

  interface Seat {
    id: string;
    rowLabel: string;
    number: number;
    type: string;
  }

  const seatsOf = async (cinema: Cinema): Promise<Seat[]> =>
    (
      await api(
        'get',
        `/showtimes/${cinema.showtimeId}/seats`,
        cinema.key,
      ).expect(200)
    ).body.data.seats as Seat[];

  const hold = (cinema: Cinema, seatIds: string[]) =>
    api('post', '/reservations', cinema.key).send({
      showtimeId: cinema.showtimeId,
      seatIds,
      customer: { name: 'Chioma Buyer', email: `buyer${seq()}@example.com` },
    });

  const sell = (cinema: Cinema, seatIds: string[]) =>
    dash('post', '/reservations/box-office', cinema.owner, 'live').send({
      showtimeId: cinema.showtimeId,
      seatIds,
      method: 'cash',
    });

  const sentTo = (email: string) =>
    ctx.platformMail.mock.calls
      .filter(([to]) => to === email)
      .map(([, sent]) => sent as { subject: string; text: string });

  it('refuses new live holds at the hard stop but never blocks box office', async () => {
    const cinema = await setupCinema();
    const seats = await seatsOf(cinema);
    await setTicketLimit(cinema.orgId, 1, 100); // hard stop = 2

    await hold(cinema, [seats[0].id]).expect(201);
    await hold(cinema, [seats[1].id]).expect(201);

    const blocked = await hold(cinema, [seats[2].id]).expect(403);
    expect(blocked.body.error.code).toBe('ticket_quota_exceeded');

    const sale = await sell(cinema, [seats[3].id]).expect(201);
    expect(sale.body.data.status).toBe('confirmed');

    const overview = await dash('get', '/billing', cinema.owner).expect(200);
    expect(overview.body.data.usage.tickets).toMatchObject({
      used: 1,
      limit: 1,
      hardStop: 2,
    });
  });

  it('emails at 80% and at the plan limit', async () => {
    const cinema = await setupCinema();
    const seats = await seatsOf(cinema);
    await setTicketLimit(cinema.orgId, 5, 100); // 80% = 4, over = 5

    await sell(
      cinema,
      seats.slice(0, 4).map((seat) => seat.id),
    ).expect(201);
    await eventually(async () => {
      expect(
        sentTo(cinema.email).some(({ subject }) =>
          subject.includes('close to its ticket limit'),
        ),
      ).toBe(true);
    });

    await sell(cinema, [seats[4].id]).expect(201);
    await eventually(async () => {
      expect(
        sentTo(cinema.email).some(({ subject }) =>
          subject.includes('reached its ticket limit'),
        ),
      ).toBe(true);
    });
  });
});
