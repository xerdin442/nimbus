import type { AddressInfo } from 'net';
import * as http from 'http';
import type { Job } from 'bullmq';
import { ReservationsProcessor } from '@src/reservations/reservations.processor';
import type { ExpireReservationJob } from '@src/common/types/job';
import { EXPIRE_JOB } from '@src/common/types/constants';
import { verifyPayloadSignature } from '@src/webhooks/signature';
import {
  eventually,
  useE2eApp,
  type Mode,
  type Session,
} from './utils/e2e-app';

/**
 * Phase 3b over HTTP: webhook endpoints owners register, signed payloads Nimbus delivers with
 * retries, and the delivery log. The org's server is faked by a local receiver below — only
 * Paystack and Brevo are intercepted in e2e-app, so delivery fetches reach it for real.
 */
describe('Webhooks (e2e)', () => {
  const {
    ctx,
    paystack,
    seq,
    dash,
    api,
    signup,
    connectPaystack,
    verifyWebhook,
    paystackWebhook,
    createApiKey,
    location,
  } = useE2eApp();

  const MINUTE = 60_000;
  const ALL_EVENTS = [
    'reservation.confirmed',
    'reservation.cancelled',
    'reservation.expired',
    'reservation.refunded',
    'ticket.checked_in',
  ];

  interface Delivery {
    url: string;
    body: string;
    signature: string | undefined;
  }

  interface Receiver {
    deliveries: Delivery[];
    url: (subPath: string) => string;
    close: () => Promise<void>;
    failNext: (count: number) => void;
  }

  /** A local server standing in for the org's app: collects posts, can answer 500 a few times. */
  const receiver = (): Promise<Receiver> =>
    new Promise((resolve, reject) => {
      const deliveries: Delivery[] = [];
      let toFail = 0;
      const server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          deliveries.push({
            url: req.url ?? '',
            body: Buffer.concat(chunks).toString('utf8'),
            signature: (req.headers['nimbus-signature'] as string) ?? undefined,
          });
          const fail = toFail > 0;
          if (fail) toFail--;
          res.statusCode = fail ? 500 : 200;
          res.end(JSON.stringify({ ok: !fail }));
        });
      });
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        resolve({
          deliveries,
          url: (subPath: string) => `http://127.0.0.1:${port}/hooks/${subPath}`,
          close: () => new Promise<void>((done) => server.close(() => done())),
          failNext: (count: number) => {
            toFail = count;
          },
        });
      });
      server.on('error', reject);
    });

  /** An org with a test-mode showtime in 30 minutes and test Paystack + API keys ready to book. */
  const setupCinema = async () => {
    const owner = await signup();
    const testKey = `sk_test_${seq()}good`;
    await connectPaystack(owner, 'test', testKey);
    // Online checkout needs a webhook-verified test config (the verification payment itself).
    await verifyWebhook(owner, 'test', testKey);

    const locationId = (
      await dash('post', '/locations', owner)
        .send(location('Lekki'))
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
      await dash('post', '/movies', owner, 'test')
        .send({ title: 'Anikulapo', runtimeMinutes: 100 })
        .expect(201)
    ).body.data.id as string;
    const showtimeId = (
      await dash('post', '/showtimes', owner, 'test')
        .send({
          screenId,
          movieId,
          startsAt: new Date(Date.now() + 30 * MINUTE).toISOString(),
          prices: { standard: 300000, vip: 500000 },
        })
        .expect(201)
    ).body.data.id as string;
    await dash(
      'post',
      `/showtimes/${showtimeId}/publish`,
      owner,
      'test',
    ).expect(200);

    return {
      owner,
      locationId,
      showtimeId,
      testKey,
      pk: await createApiKey(owner, 'publishable', 'test'),
      sk: await createApiKey(owner, 'secret', 'test'),
    };
  };

  type Cinema = Awaited<ReturnType<typeof setupCinema>>;

  interface SeatMapSeat {
    id: string;
    rowLabel: string;
    number: number;
  }

  const seatIds = async (cinema: Cinema, labels: string[]) => {
    const seats = (
      await api(
        'get',
        `/showtimes/${cinema.showtimeId}/seats`,
        cinema.pk,
      ).expect(200)
    ).body.data.seats as SeatMapSeat[];
    return labels.map(
      (label) => seats.find((s) => `${s.rowLabel}${s.number}` === label)!.id,
    );
  };

  const hold = async (cinema: Cinema, labels: string[]) => {
    const ids = await seatIds(cinema, labels);
    return (
      await api('post', '/reservations', cinema.sk)
        .send({
          showtimeId: cinema.showtimeId,
          seatIds: ids,
          customer: { name: 'Chioma Buyer', email: 'chioma@example.com' },
        })
        .expect(201)
    ).body.data as { id: string; code: string; total: number };
  };

  const checkout = async (cinema: Cinema, reservationId: string) =>
    (
      await api('post', `/reservations/${reservationId}/checkout`, cinema.sk)
        .send({ callbackUrl: 'http://localhost:3000/paid' })
        .expect(200)
    ).body.data.reference as string;

  let transactionId = 7_000_000_000;

  /** Paystack's signed `charge.success` for a reference it initialized. */
  const pay = (cinema: Cinema, reference: string) => {
    const transaction = paystack.transactions.get(reference)!;
    return paystackWebhook(cinema.owner.orgId, 'test', cinema.testKey, {
      event: 'charge.success',
      data: {
        id: ++transactionId,
        status: 'success',
        reference,
        amount: transaction.amount,
        currency: transaction.currency,
        paid_at: new Date().toISOString(),
      },
    }).expect(200);
  };

  /** Registers an endpoint in `mode`; the response carries the secret it will show only once. */
  const createEndpoint = async (
    owner: Session,
    mode: Mode,
    url: string,
    events: string[],
  ) =>
    (
      await dash('post', '/webhook-endpoints', owner, mode)
        .send({ url, events })
        .expect(201)
    ).body.data as {
      id: string;
      secret: string;
      events: string[];
      enabled: boolean;
    };

  /** Waits for the payment webhook job to settle the reservation. */
  const eventuallyStatus = (cinema: Cinema, id: string, status: string) =>
    eventually(async () => {
      const res = await api('get', `/reservations/${id}`, cinema.sk).expect(
        200,
      );
      expect(res.body.data.status).toBe(status);
    });

  /** Lets the hold lapse and runs its expiry job now. */
  const expire = async (cinema: Cinema, id: string) => {
    await ctx.ownerPool.query(
      `update reservations set expires_at = now() - interval '1 second' where id = $1`,
      [id],
    );
    await ctx.app.get(ReservationsProcessor).process({
      name: EXPIRE_JOB,
      data: { orgId: cinema.owner.orgId, livemode: false, reservationId: id },
    } as Job<ExpireReservationJob>);
  };

  const checkIn = (event: string, delivered: Delivery[]) =>
    delivered.filter(({ body }) => JSON.parse(body).event === event);

  describe('endpoints', () => {
    let owner: Session;
    let registered: { id: string; secret: string };

    beforeAll(async () => {
      owner = await signup();
    });

    it('shows the secret exactly once, on create', async () => {
      const res = await dash('post', '/webhook-endpoints', owner, 'test')
        .send({
          url: 'https://filmhouse.test/hooks/nimbus',
          events: ['reservation.confirmed', 'ticket.checked_in'],
        })
        .expect(201);

      registered = res.body.data as { id: string; secret: string };
      expect(registered.secret).toMatch(/^whsec_[a-f0-9]{48}$/);
      expect(res.body.data).toMatchObject({
        url: 'https://filmhouse.test/hooks/nimbus',
        events: ['reservation.confirmed', 'ticket.checked_in'],
        enabled: true,
      });

      const endpoints = (
        await dash('get', '/webhook-endpoints', owner, 'test').expect(200)
      ).body.data as unknown[];
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0]).not.toHaveProperty('secret');
    });

    it('enforces the plan limit per mode', async () => {
      const res = await dash('post', '/webhook-endpoints', owner, 'test')
        .send({
          url: 'https://filmhouse.test/hooks/two',
          events: ['reservation.refunded'],
        })
        .expect(403);
      expect(res.body.error.code).toBe('plan_limit_reached');
    });

    it('rotates the signing secret and keeps the secret out of lists', async () => {
      const { secret } = (
        await dash(
          'post',
          `/webhook-endpoints/${registered.id}/rotate`,
          owner,
          'test',
        ).expect(200)
      ).body.data as { secret: string };
      expect(secret).toMatch(/^whsec_[a-f0-9]{48}$/);
      expect(secret).not.toBe(registered.secret);
    });

    it('accepts edits and deletes the endpoint', async () => {
      const updated = (
        await dash(
          'patch',
          `/webhook-endpoints/${registered.id}`,
          owner,
          'test',
        )
          .send({ enabled: false, events: ['reservation.expired'] })
          .expect(200)
      ).body.data as { enabled: boolean; events: string[] };
      expect(updated.enabled).toBe(false);
      expect(updated.events).toEqual(['reservation.expired']);

      await dash(
        'delete',
        `/webhook-endpoints/${registered.id}`,
        owner,
        'test',
      ).expect(200);
      const endpoints = (
        await dash('get', '/webhook-endpoints', owner, 'test').expect(200)
      ).body.data as unknown[];
      expect(endpoints).toHaveLength(0);
    });

    it('rejects bad URLs and unknown events', async () => {
      await dash('post', '/webhook-endpoints', owner, 'test')
        .send({
          url: 'ftp://filmhouse.test/x',
          events: ['reservation.confirmed'],
        })
        .expect(400);
      await dash('post', '/webhook-endpoints', owner, 'test')
        .send({
          url: 'https://filmhouse.test/hooks/nimbus',
          events: ['reservation.confirmed', 'movie.released'],
        })
        .expect(400);
    });
  });

  describe('delivery', () => {
    let hooks: Receiver;
    let endpointId: string;
    let endpointSecret: string;
    let cinema: Cinema;
    let reservationId: string;

    beforeAll(async () => {
      hooks = await receiver();
      // The endpoints belong to the same org as the bookings, so the org's own
      // dashboard owner is the one that registered them.
      cinema = await setupCinema();
      const endpoint = await createEndpoint(
        cinema.owner,
        'test',
        hooks.url('app'),
        ALL_EVENTS,
      );
      endpointId = endpoint.id;
      endpointSecret = endpoint.secret;
    });

    afterAll(async () => {
      await hooks.close();
    });

    it('delivers reservation.confirmed signed with the endpoint secret', async () => {
      const held = await hold(cinema, ['A1', 'B1']);
      reservationId = held.id;
      const reference = await checkout(cinema, reservationId);
      await pay(cinema, reference);
      await eventuallyStatus(cinema, reservationId, 'confirmed');

      await eventually(async () => {
        expect(
          checkIn('reservation.confirmed', hooks.deliveries).length,
        ).toBeGreaterThan(0);
      });

      const [delivery] = checkIn('reservation.confirmed', hooks.deliveries);
      expect(delivery.url).toBe('/hooks/app');
      expect(
        verifyPayloadSignature(
          endpointSecret,
          delivery.body,
          delivery.signature,
        ),
      ).toBe(true);

      const payload = JSON.parse(delivery.body);
      expect(payload).toMatchObject({
        event: 'reservation.confirmed',
        livemode: false,
      });
      expect(payload.data.reservation).toMatchObject({
        id: reservationId,
        code: held.code,
        status: 'confirmed',
        total: 800000,
        currency: 'NGN',
        customerEmail: 'chioma@example.com',
      });
      expect(payload.data.reservation.movie).toMatchObject({
        title: 'Anikulapo',
      });
      expect(payload.data.reservation.seats).toHaveLength(2);
      expect(payload.data.reservation.tickets).toHaveLength(2);
    });

    it('checks a ticket in and delivers ticket.checked_in', async () => {
      const tickets = (
        await api('get', `/reservations/${reservationId}`, cinema.sk).expect(
          200,
        )
      ).body.data.tickets as { id: string; code: string }[];

      const scan = await dash('post', '/tickets/scan', cinema.owner, 'test')
        .send({ locationId: cinema.locationId, code: tickets[0].code })
        .expect(200);
      expect(scan.body.data.result).toBe('valid');

      await eventually(async () => {
        const [delivery] = checkIn('ticket.checked_in', hooks.deliveries);
        expect(delivery).toBeDefined();
        expect(
          verifyPayloadSignature(
            endpointSecret,
            delivery.body,
            delivery.signature,
          ),
        ).toBe(true);

        const payload = JSON.parse(delivery.body);
        expect(payload.data.ticket).toMatchObject({
          id: tickets[0].id,
          code: tickets[0].code,
        });
        expect(payload.data.reservation.code).toBeTruthy();
        expect(payload.data.showtime).toMatchObject({
          movieTitle: 'Anikulapo',
        });
      });
    });

    it('delivers reservation.refunded when the reservation is refunded', async () => {
      await dash(
        'post',
        `/reservations/${reservationId}/refund`,
        cinema.owner,
        'test',
      ).expect(200);

      await eventuallyStatus(cinema, reservationId, 'refunded');
      await eventually(async () => {
        const [delivery] = checkIn('reservation.refunded', hooks.deliveries);
        expect(delivery).toBeDefined();
        expect(JSON.parse(delivery.body).data.reservation.status).toBe(
          'refunded',
        );
      });
    });

    it('delivers reservation.expired when a hold lapses', async () => {
      const held = await hold(cinema, ['A2']);
      await expire(cinema, held.id);

      await eventually(async () => {
        const [delivery] = checkIn('reservation.expired', hooks.deliveries);
        expect(delivery).toBeDefined();
        expect(JSON.parse(delivery.body).data.reservation).toMatchObject({
          id: held.id,
          status: 'expired',
        });
      });
    });

    it("logs every delivery on the org's log", async () => {
      const list = (
        await dash('get', '/webhook-deliveries', cinema.owner, 'test').expect(
          200,
        )
      ).body as {
        data: {
          endpointId: string;
          event: string;
          status: string;
          attempts: number;
          responseCode: number;
        }[];
        meta: { total: number };
      };

      expect(list.meta.total).toBeGreaterThanOrEqual(4);
      const events = list.data.map((row) => row.event);
      for (const event of [
        'reservation.confirmed',
        'ticket.checked_in',
        'reservation.refunded',
        'reservation.expired',
      ]) {
        expect(events).toContain(event);
      }
      for (const row of list.data) {
        expect(row).toMatchObject({
          endpointId,
          status: 'success',
          attempts: 1,
          responseCode: 200,
        });
      }

      const filtered = (
        await dash(
          'get',
          '/webhook-deliveries?status=success&event=reservation.confirmed',
          cinema.owner,
          'test',
        ).expect(200)
      ).body as { data: { event: string }[] };
      expect(filtered.data).toHaveLength(1);
      expect(filtered.data[0].event).toBe('reservation.confirmed');
    });

    it('never delivers to endpoints registered for the other mode', async () => {
      const live = await receiver();
      await createEndpoint(cinema.owner, 'live', live.url('live'), [
        'reservation.confirmed',
      ]);

      try {
        const held = await hold(cinema, ['B2']);
        const reference = await checkout(cinema, held.id);
        await pay(cinema, reference);
        await eventuallyStatus(cinema, held.id, 'confirmed');

        await eventually(async () => {
          const confirmed = checkIn(
            'reservation.confirmed',
            hooks.deliveries,
          ).filter(
            ({ body }) => JSON.parse(body).data.reservation.id === held.id,
          );
          expect(confirmed).toHaveLength(1); // the test-mode endpoint
        });
        expect(live.deliveries).toHaveLength(0);
      } finally {
        await live.close();
      }
    });
  });

  describe('retries', () => {
    it('fails an attempt, retries with backoff and settles with the same payload', async () => {
      const flaky = await receiver();
      flaky.failNext(1);

      try {
        const cinema = await setupCinema();
        const endpoint = await createEndpoint(
          cinema.owner,
          'test',
          flaky.url('flaky'),
          ['reservation.confirmed'],
        );

        const held = await hold(cinema, ['A1']);
        const reference = await checkout(cinema, held.id);
        await pay(cinema, reference);
        await eventuallyStatus(cinema, held.id, 'confirmed');

        const rowsOf = async () =>
          (
            await dash(
              'get',
              '/webhook-deliveries?event=reservation.confirmed',
              cinema.owner,
              'test',
            ).expect(200)
          ).body as {
            data: {
              endpointId: string;
              status: string;
              attempts: number;
              responseCode: number | null;
              lastError: string | null;
            }[];
          };
        const attempt = async () =>
          (await rowsOf()).data.filter((row) => row.endpointId === endpoint.id);

        // First attempt: the endpoint is down, the delivery row says so.
        await eventually(async () => {
          const [row] = await attempt();
          expect(row).toBeDefined();
          expect(row).toMatchObject({
            status: 'failed',
            attempts: 1,
            responseCode: 500,
          });
          expect(row.lastError).toContain('500');
        });

        // The retry (10s) reaches a cooperating endpoint and settles.
        await eventually(async () => {
          const [row] = await attempt();
          expect(row).toMatchObject({
            status: 'success',
            attempts: 2,
            responseCode: 200,
          });
        }, 25_000);

        // Exactly two posts, and both carried the same bytes.
        const posts = flaky.deliveries.filter(
          ({ url }) => url === '/hooks/flaky',
        );
        expect(posts).toHaveLength(2);
        expect(posts[0].body).toBe(posts[1].body);
        expect(JSON.parse(posts[1].body).data.reservation.id).toBe(held.id);
      } finally {
        await flaky.close();
      }
    }, 45_000);
  });
});
