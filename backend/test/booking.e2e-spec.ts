import { getQueueToken } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { ReservationExpiryProcessor } from '@src/reservations/expiry.processor';
import { RESERVATIONS_QUEUE } from '@src/reservations/reservations.service';
import type { ExpireReservationJob } from '@src/common/types';
import {
  eventually,
  useE2eApp,
  type Mode,
  type Session,
} from './utils/e2e-app';

/**
 * Phase 2 over HTTP: scheduling, seat holds, box office and ticket scanning, against the real
 * app, test database and Redis.
 */
describe('Booking (e2e)', () => {
  const {
    ctx,
    seq,
    dash,
    api,
    signup,
    joinAs,
    verify,
    createApiKey,
    location,
  } = useE2eApp();

  interface Keys {
    pkTest: string;
    skTest: string;
    pkLive: string;
    skLive: string;
  }

  interface SeatMapSeat {
    id: string;
    rowLabel: string;
    number: number;
    type: string;
    price: number;
    available: boolean;
  }

  /** A staff member who accepted an invite scoped to `locationIds`. */
  const joinAsStaff = (owner: Session, locationIds: string[]) =>
    joinAs(owner, `staff${seq()}@example.com`, { locationIds });

  const MINUTE = 60_000;
  const lagosDate = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(date);

  /**
   * A verified org with one location, a 5-seat screen (row A: 3 standard, row B: 2 VIP), a
   * 100-minute movie in each mode, ads/cleanup of 10 minutes, and keys in both modes.
   */
  const setupCinema = async () => {
    const owner = await signup();
    await verify(owner);

    await dash('patch', '/organization/settings', owner)
      .send({ adsMinutes: 10, cleanupMinutes: 10 })
      .expect(200);

    const createLocation = async (name: string) =>
      (await dash('post', '/locations', owner).send(location(name)).expect(201))
        .body.data.id as string;
    const locationId = await createLocation('Filmhouse Lekki');
    const otherLocationId = await createLocation('Filmhouse Surulere');

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

    // Movies are per mode: each mode schedules its own.
    const createMovie = async (mode: Mode) =>
      (
        await dash('post', '/movies', owner, mode)
          .send({ title: 'Anikulapo', runtimeMinutes: 100 })
          .expect(201)
      ).body.data.id as string;
    const movieIds: Record<Mode, string> = {
      test: await createMovie('test'),
      live: await createMovie('live'),
    };

    const keys: Keys = {
      pkTest: await createApiKey(owner, 'publishable', 'test'),
      skTest: await createApiKey(owner, 'secret', 'test'),
      pkLive: await createApiKey(owner, 'publishable', 'live'),
      skLive: await createApiKey(owner, 'secret', 'live'),
    };

    return { owner, locationId, otherLocationId, screenId, movieIds, keys };
  };

  type Cinema = Awaited<ReturnType<typeof setupCinema>>;

  const createShowtime = (
    cinema: Cinema,
    startsAt: Date,
    mode: Mode = 'live',
    prices: Record<string, number> = { standard: 300000, vip: 500000 },
  ) =>
    dash('post', '/showtimes', cinema.owner, mode).send({
      screenId: cinema.screenId,
      movieId: cinema.movieIds[mode],
      startsAt: startsAt.toISOString(),
      prices,
    });

  /** A published showtime starting in `minutesAhead` (default 30: inside the scan window). */
  const publishedShowtime = async (
    cinema: Cinema,
    minutesAhead = 30,
    mode: Mode = 'live',
  ) => {
    const startsAt = new Date(Date.now() + minutesAhead * MINUTE);
    const id = (await createShowtime(cinema, startsAt, mode).expect(201)).body
      .data.id as string;
    await dash('post', `/showtimes/${id}/publish`, cinema.owner, mode).expect(
      200,
    );
    return { id, startsAt };
  };

  const ids = (res: { body: { data: { id: string }[] } }) =>
    res.body.data.map((row) => row.id);

  const seatMap = async (showtimeId: string, key: string) =>
    (await api('get', `/showtimes/${showtimeId}/seats`, key).expect(200)).body
      .data.seats as SeatMapSeat[];

  const seatId = (seats: SeatMapSeat[], label: string) =>
    seats.find((s) => `${s.rowLabel}${s.number}` === label)!.id;

  const customer = { name: 'Chioma Buyer', email: 'Chioma@Example.com' };

  const hold = (key: string, showtimeId: string, seatIds: string[]) =>
    api('post', '/reservations', key).send({ showtimeId, seatIds, customer });

  describe('scheduling', () => {
    let cinema: Cinema;
    beforeAll(async () => {
      cinema = await setupCinema();
    });

    it('starts from default org settings and keeps updates', async () => {
      const fresh = await signup();
      const defaults = await dash(
        'get',
        '/organization/settings',
        fresh,
      ).expect(200);
      expect(defaults.body.data).toEqual({
        adsMinutes: 15,
        cleanupMinutes: 15,
        holdMinutes: 10,
      });

      const saved = await dash('get', '/organization/settings', cinema.owner);
      expect(saved.body.data).toEqual({
        adsMinutes: 10,
        cleanupMinutes: 10,
        holdMinutes: 10,
      });

      await dash('patch', '/organization/settings', cinema.owner)
        .send({ holdMinutes: 60 })
        .expect(400);
    });

    it('needs a price for every seat type in the layout', async () => {
      const res = await createShowtime(
        cinema,
        new Date(Date.now() + 24 * 60 * MINUTE),
        'live',
        { standard: 300000 },
      ).expect(400);
      expect(res.body.error).toMatchObject({
        code: 'missing_prices',
        details: { seatTypes: ['vip'] },
      });
    });

    it('rejects overlaps on a screen, cleanup included, and allows back-to-back showtimes', async () => {
      // 10 ads + 100 runtime + 10 cleanup: the screen is busy for 120 minutes.
      const start = new Date(Date.now() + 48 * 60 * MINUTE);
      const first = await createShowtime(cinema, start).expect(201);
      expect(
        new Date(first.body.data.endsAt as string).getTime() - start.getTime(),
      ).toBe(110 * MINUTE);

      const overlapping = await createShowtime(
        cinema,
        new Date(start.getTime() + 119 * MINUTE),
      ).expect(409);
      expect(overlapping.body.error.code).toBe('showtime_overlap');

      const next = await createShowtime(
        cinema,
        new Date(start.getTime() + 120 * MINUTE),
      ).expect(201);

      // Moving a draft into another showtime's slot is refused too.
      const moved = await dash(
        'patch',
        `/showtimes/${next.body.data.id}`,
        cinema.owner,
      )
        .send({
          startsAt: new Date(start.getTime() + 60 * MINUTE).toISOString(),
        })
        .expect(409);
      expect(moved.body.error.code).toBe('showtime_overlap');
    });

    it('frees the slot when a showtime is cancelled', async () => {
      const start = new Date(Date.now() + 72 * 60 * MINUTE);
      const first = await createShowtime(cinema, start).expect(201);
      await dash(
        'post',
        `/showtimes/${first.body.data.id}/cancel`,
        cinema.owner,
      ).expect(200);
      await createShowtime(cinema, start).expect(201);
    });

    it('publishes to the public API with seat inventory', async () => {
      const draft = await createShowtime(
        cinema,
        new Date(Date.now() + 96 * 60 * MINUTE),
      ).expect(201);
      const id = draft.body.data.id as string;
      expect(draft.body.data.livemode).toBe(true);

      // Drafts aren't public.
      await api('get', `/showtimes/${id}`, cinema.keys.pkLive).expect(404);

      await dash('post', `/showtimes/${id}/publish`, cinema.owner).expect(200);

      const seats = await seatMap(id, cinema.keys.pkLive);
      expect(seats.map((s) => `${s.rowLabel}${s.number}`)).toEqual([
        'A1',
        'A2',
        'A3',
        'B1',
        'B2',
      ]);
      expect(seats.every((s) => s.available)).toBe(true);
      expect(seats.find((s) => s.type === 'vip')!.price).toBe(500000);

      const listed = await api(
        'get',
        `/locations/${cinema.locationId}/showtimes?date=${lagosDate(new Date(draft.body.data.startsAt as string))}`,
        cinema.keys.pkLive,
      ).expect(200);
      expect(listed.body.data).toContainEqual(
        expect.objectContaining({
          id,
          currency: 'NGN',
          movie: expect.objectContaining({ title: 'Anikulapo' }),
          seats: { available: 5, held: 0, sold: 0 },
        }),
      );

      const nowShowing = await api(
        'get',
        `/locations/${cinema.locationId}/movies`,
        cinema.keys.pkLive,
      ).expect(200);
      expect(ids(nowShowing)).toContain(cinema.movieIds.live);

      // No reservations yet, so it can go back to draft (and its inventory goes with it).
      await dash('post', `/showtimes/${id}/unpublish`, cinema.owner).expect(
        200,
      );
      await api('get', `/showtimes/${id}/seats`, cinema.keys.pkLive).expect(
        404,
      );
    });
  });

  describe('done when: test-mode data never reaches live mode', () => {
    it('keeps test movies and showtimes out of live mode', async () => {
      const cinema = await setupCinema();
      const testShowtime = await publishedShowtime(cinema, 30, 'test');
      // Same screen, same time: a test showtime never takes a live slot.
      const liveShowtime = await publishedShowtime(cinema, 30, 'live');

      for (const [mode, key, own, other] of [
        ['test', cinema.keys.pkTest, testShowtime.id, liveShowtime.id],
        ['live', cinema.keys.pkLive, liveShowtime.id, testShowtime.id],
      ] as const) {
        const movies = await api('get', '/movies', key).expect(200);
        expect(ids(movies)).toEqual([cinema.movieIds[mode]]);

        const nowShowing = await api(
          'get',
          `/locations/${cinema.locationId}/movies`,
          key,
        ).expect(200);
        expect(ids(nowShowing)).toEqual([cinema.movieIds[mode]]);

        const listed = await api(
          'get',
          `/locations/${cinema.locationId}/showtimes?date=${lagosDate(testShowtime.startsAt)}`,
          key,
        ).expect(200);
        expect(ids(listed)).toEqual([own]);

        await api('get', `/showtimes/${other}`, key).expect(404);
        await api('get', `/showtimes/${other}/seats`, key).expect(404);

        // The dashboard follows its mode header the same way.
        const dashboard = await dash(
          'get',
          `/showtimes?locationId=${cinema.locationId}&date=${lagosDate(testShowtime.startsAt)}`,
          cinema.owner,
          mode,
        ).expect(200);
        expect(ids(dashboard)).toEqual([own]);
      }

      // A live movie can't be scheduled in test mode: it doesn't exist there.
      await dash('post', '/showtimes', cinema.owner, 'test')
        .send({
          screenId: cinema.screenId,
          movieId: cinema.movieIds.live,
          startsAt: new Date(Date.now() + 24 * 60 * MINUTE).toISOString(),
          prices: { standard: 300000, vip: 500000 },
        })
        .expect(404);

      // Nor can a live key hold seats on a test showtime.
      const testSeats = await seatMap(testShowtime.id, cinema.keys.pkTest);
      await hold(cinema.keys.skLive, testShowtime.id, [
        seatId(testSeats, 'A1'),
      ]).expect(404);
    });

    it('keeps test holds and reservations in test mode', async () => {
      const cinema = await setupCinema();
      const showtime = await publishedShowtime(cinema, 30, 'test');

      const testSeats = await seatMap(showtime.id, cinema.keys.pkTest);
      const held = await hold(cinema.keys.skTest, showtime.id, [
        seatId(testSeats, 'A1'),
        seatId(testSeats, 'B1'),
      ]).expect(201);
      expect(held.body.data).toMatchObject({
        status: 'pending',
        livemode: false,
        total: 800000,
        currency: 'NGN',
        customerEmail: 'chioma@example.com',
        code: expect.stringMatching(/^[2-9A-Z]{8}$/),
      });
      expect(held.body.data.seats.map((s: SeatMapSeat) => s.rowLabel)).toEqual([
        'A',
        'B',
      ]);

      const afterHold = await seatMap(showtime.id, cinema.keys.pkTest);
      expect(
        afterHold.find((s) => s.id === seatId(testSeats, 'A1'))!.available,
      ).toBe(false);
      const retaken = await hold(cinema.keys.skTest, showtime.id, [
        seatId(testSeats, 'A1'),
      ]).expect(409);
      expect(retaken.body.error).toMatchObject({
        code: 'seats_unavailable',
        details: { seatIds: [seatId(testSeats, 'A1')] },
      });

      // The reservation is invisible from live mode.
      await api(
        'get',
        `/reservations/${held.body.data.id}`,
        cinema.keys.skLive,
      ).expect(404);

      const listed = await dash(
        'get',
        `/showtimes?locationId=${cinema.locationId}&date=${lagosDate(showtime.startsAt)}`,
        cinema.owner,
        'test',
      ).expect(200);
      expect(listed.body.data).toEqual([
        expect.objectContaining({
          id: showtime.id,
          livemode: false,
          status: 'published',
          seats: { available: 3, held: 2, sold: 0 },
        }),
      ]);

      // Reserved showtimes can be cancelled, not taken back to draft.
      const unpublish = await dash(
        'post',
        `/showtimes/${showtime.id}/unpublish`,
        cinema.owner,
        'test',
      ).expect(409);
      expect(unpublish.body.error.code).toBe('showtime_has_reservations');
    });

    it('needs a secret key to reserve', async () => {
      const cinema = await setupCinema();
      const showtime = await publishedShowtime(cinema, 30, 'test');
      const seats = await seatMap(showtime.id, cinema.keys.pkTest);

      const res = await hold(cinema.keys.pkTest, showtime.id, [
        seatId(seats, 'A1'),
      ]).expect(403);
      expect(res.body.error.code).toBe('secret_key_required');
    });
  });

  describe('done when: concurrency test passes', () => {
    it('50 concurrent holds on one seat → exactly one succeeds', async () => {
      const cinema = await setupCinema();
      const showtime = await publishedShowtime(cinema, 30, 'test');
      const seats = await seatMap(showtime.id, cinema.keys.pkTest);
      const contested = seatId(seats, 'B2');

      const results = await Promise.all(
        Array.from({ length: 50 }, () =>
          hold(cinema.keys.skTest, showtime.id, [contested]),
        ),
      );

      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(49);
    });
  });

  describe('holds', () => {
    let cinema: Cinema;
    let showtimeId: string;

    beforeAll(async () => {
      cinema = await setupCinema();
      showtimeId = (await publishedShowtime(cinema)).id;
    });

    it('replays a retried request with the same Idempotency-Key', async () => {
      const testShowtimeId = (await publishedShowtime(cinema, 30, 'test')).id;
      const seats = await seatMap(testShowtimeId, cinema.keys.pkTest);
      const body = {
        showtimeId: testShowtimeId,
        seatIds: [seatId(seats, 'A2')],
        customer,
      };
      const first = await api('post', '/reservations', cinema.keys.skTest)
        .set('idempotency-key', 'checkout-attempt-1')
        .send(body)
        .expect(201);
      const retry = await api('post', '/reservations', cinema.keys.skTest)
        .set('idempotency-key', 'checkout-attempt-1')
        .send(body)
        .expect(201);

      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.body.data.id).toBe(first.body.data.id);

      const reused = await api('post', '/reservations', cinema.keys.skTest)
        .set('idempotency-key', 'checkout-attempt-1')
        .send({ ...body, seatIds: [seatId(seats, 'A3')] })
        .expect(422);
      expect(reused.body.error.code).toBe('idempotency_key_reused');

      // A failed request doesn't keep its key: fixing the request and retrying works.
      const failed = await api('post', '/reservations', cinema.keys.skTest)
        .set('idempotency-key', 'checkout-attempt-2')
        .send(body)
        .expect(409);
      expect(failed.body.error.code).toBe('seats_unavailable');
      await api('post', '/reservations', cinema.keys.skTest)
        .set('idempotency-key', 'checkout-attempt-2')
        .send({ ...body, seatIds: [seatId(seats, 'A3')] })
        .expect(201);
    });

    it('cancels a pending hold and frees its seats', async () => {
      const pending = await hold(cinema.keys.skLive, showtimeId, [
        seatId(await seatMap(showtimeId, cinema.keys.pkLive), 'B1'),
      ]).expect(201);
      const id = pending.body.data.id as string;

      const cancelled = await api(
        'post',
        `/reservations/${id}/cancel`,
        cinema.keys.skLive,
      ).expect(200);
      expect(cancelled.body.data.status).toBe('cancelled');
      expect(
        (await seatMap(showtimeId, cinema.keys.pkLive)).every(
          (s) => s.available,
        ),
      ).toBe(true);

      const again = await api(
        'post',
        `/reservations/${id}/cancel`,
        cinema.keys.skLive,
      ).expect(409);
      expect(again.body.error.code).toBe('reservation_not_cancellable');
    });

    it('expires a hold only once it is due (processor run directly)', async () => {
      const liveSeats = await seatMap(showtimeId, cinema.keys.pkLive);
      const pending = await hold(cinema.keys.skLive, showtimeId, [
        seatId(liveSeats, 'A3'),
      ]).expect(201);
      const id = pending.body.data.id as string;
      const job = {
        data: { orgId: cinema.owner.orgId, livemode: true, reservationId: id },
      } as Job<ExpireReservationJob>;
      const processor = ctx.app.get(ReservationExpiryProcessor);

      // Too early: the job is a no-op.
      await processor.process(job);
      expect(
        (await api('get', `/reservations/${id}`, cinema.keys.skLive)).body.data
          .status,
      ).toBe('pending');

      await ctx.ownerPool.query(
        `update reservations set expires_at = now() - interval '1 second' where id = $1`,
        [id],
      );
      await processor.process(job);

      const expired = await api(
        'get',
        `/reservations/${id}`,
        cinema.keys.skLive,
      ).expect(200);
      expect(expired.body.data.status).toBe('expired');
      expect(
        (await seatMap(showtimeId, cinema.keys.pkLive)).find(
          (s) => s.id === seatId(liveSeats, 'A3'),
        )!.available,
      ).toBe(true);
    });

    it('schedules the expiry job, and the worker expires the hold when it fires', async () => {
      const liveSeats = await seatMap(showtimeId, cinema.keys.pkLive);
      const pending = await hold(cinema.keys.skLive, showtimeId, [
        seatId(liveSeats, 'B2'),
      ]).expect(201);
      const id = pending.body.data.id as string;

      const queue = ctx.app.get<Queue>(getQueueToken(RESERVATIONS_QUEUE));
      const job = await queue.getJob(`expire-${id}`);
      expect(job).toBeDefined();
      expect(await job!.isDelayed()).toBe(true);
      // Due at expiresAt: the default 10-minute hold.
      expect(job!.opts.delay).toBeGreaterThan(9 * MINUTE);

      // Time's up: make it due and run it now instead of waiting ten minutes.
      await ctx.ownerPool.query(
        `update reservations set expires_at = now() - interval '1 second' where id = $1`,
        [id],
      );
      await job!.promote();

      await eventually(async () => {
        const res = await api('get', `/reservations/${id}`, cinema.keys.skLive);
        expect(res.body.data.status).toBe('expired');
      });
      expect(
        (await seatMap(showtimeId, cinema.keys.pkLive)).find(
          (s) => s.id === seatId(liveSeats, 'B2'),
        )!.available,
      ).toBe(true);
    });

    it('lets a new hold take a seat whose hold lapsed before the expiry job ran', async () => {
      const liveSeats = await seatMap(showtimeId, cinema.keys.pkLive);
      await hold(cinema.keys.skLive, showtimeId, [
        seatId(liveSeats, 'A2'),
      ]).expect(201);

      await ctx.ownerPool.query(
        `update showtime_seats set held_until = now() - interval '1 second' where id = $1`,
        [seatId(liveSeats, 'A2')],
      );

      await hold(cinema.keys.skLive, showtimeId, [
        seatId(liveSeats, 'A2'),
      ]).expect(201);
    });
  });

  describe('done when: a box-office sale produces a scannable ticket', () => {
    let cinema: Cinema;
    let showtimeId: string;
    let staff: Session;

    beforeAll(async () => {
      cinema = await setupCinema();
      showtimeId = (await publishedShowtime(cinema)).id;
      staff = await joinAsStaff(cinema.owner, [cinema.locationId]);
    });

    const boxOfficeSeats = async (mode: Mode, id = showtimeId) =>
      (await dash('get', `/showtimes/${id}/seats`, staff, mode).expect(200))
        .body.data.seats as SeatMapSeat[];

    const scan = (
      body: { token?: string; code?: string; locationId?: string },
      who: Session = staff,
      mode: Mode = 'live',
    ) =>
      dash('post', '/tickets/scan', who, mode)
        .send({ locationId: cinema.locationId, ...body })
        .expect(200);

    it('sells, issues tickets, and checks each ticket in exactly once', async () => {
      const seats = await boxOfficeSeats('live');
      const sale = await dash('post', '/reservations/box-office', staff, 'live')
        .send({
          showtimeId,
          seatIds: [seatId(seats, 'B1'), seatId(seats, 'B2')],
          method: 'cash',
          customer: { name: 'Walk-in' },
        })
        .expect(201);

      expect(sale.body.data).toMatchObject({
        status: 'confirmed',
        channel: 'box_office',
        livemode: true,
        total: 1000000,
      });
      const [first, second] = sale.body.data.tickets as {
        id: string;
        code: string;
        qrToken: string;
      }[];
      expect(first.qrToken).toMatch(/^tk1\.live\./);

      const payments = await ctx.ownerPool.query(
        'select method, amount, status from payments where reservation_id = $1',
        [sale.body.data.id],
      );
      expect(payments.rows).toEqual([
        { method: 'cash', amount: 1000000, status: 'succeeded' },
      ]);

      // Sold seats can't be held online.
      const liveSeats = await seatMap(showtimeId, cinema.keys.pkLive);
      await hold(cinema.keys.skLive, showtimeId, [
        seatId(liveSeats, 'B1'),
      ]).expect(409);

      const valid = await scan({ token: first.qrToken });
      expect(valid.body.data).toMatchObject({
        result: 'valid',
        ticket: {
          code: first.code,
          seat: { rowLabel: 'B', number: 1 },
          movieTitle: 'Anikulapo',
          customerName: 'Walk-in',
        },
      });
      expect(valid.body.data.ticket.checkedInAt).toBeTruthy();

      const reused = await scan({ token: first.qrToken });
      expect(reused.body.data.result).toBe('already_used');

      // The printed code works when the QR won't scan, typed in any case.
      const typed = await scan({ code: second.code.toLowerCase() });
      expect(typed.body.data.result).toBe('valid');
    });

    it('rejects forged, wrong-mode and wrong-location tickets', async () => {
      const testShowtimeId = (await publishedShowtime(cinema, 30, 'test')).id;
      const testSeats = await boxOfficeSeats('test', testShowtimeId);
      const testSale = await dash(
        'post',
        '/reservations/box-office',
        staff,
        'test',
      )
        .send({
          showtimeId: testShowtimeId,
          seatIds: [seatId(testSeats, 'A1')],
          method: 'pos',
        })
        .expect(201);
      const testTicket = testSale.body.data.tickets[0] as {
        code: string;
        qrToken: string;
      };

      expect((await scan({ token: testTicket.qrToken })).body.data.result).toBe(
        'wrong_mode',
      );
      expect((await scan({ code: testTicket.code })).body.data.result).toBe(
        'wrong_mode',
      );

      const forged = testTicket.qrToken.replace('.test.', '.live.');
      expect((await scan({ token: forged })).body.data.result).toBe('invalid');
      expect((await scan({ code: 'ZZZZZZZZZZ' })).body.data.result).toBe(
        'invalid',
      );

      // The owner scanning at the other location.
      const elsewhere = await scan(
        { token: testTicket.qrToken, locationId: cinema.otherLocationId },
        cinema.owner,
        'test',
      );
      expect(elsewhere.body.data.result).toBe('wrong_location');

      // Staff can't run a scanner at a location they aren't assigned to.
      const forbidden = await dash('post', '/tickets/scan', staff, 'test')
        .send({ locationId: cinema.otherLocationId, token: testTicket.qrToken })
        .expect(403);
      expect(forbidden.body.error.code).toBe('location_forbidden');
    });

    it('serves ticket QR codes as PNG', async () => {
      const seats = await boxOfficeSeats('live');
      const sale = await dash('post', '/reservations/box-office', staff, 'live')
        .send({ showtimeId, seatIds: [seatId(seats, 'A2')], method: 'pos' })
        .expect(201);
      const ticketId = sale.body.data.tickets[0].id as string;

      const viaApi = await api(
        'get',
        `/tickets/${ticketId}/qr`,
        cinema.keys.skLive,
      ).expect(200);
      expect(viaApi.headers['content-type']).toBe('image/png');
      // The PNG signature, not a JSON-serialized buffer.
      expect((viaApi.body as Buffer).subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );

      await dash('get', `/tickets/${ticketId}/qr`, staff, 'live')
        .expect(200)
        .expect('content-type', 'image/png');
      await api('get', `/tickets/${ticketId}/qr`, cinema.keys.pkLive).expect(
        403,
      );
    });

    it('finds the sale by reservation code', async () => {
      const seats = await boxOfficeSeats('live');
      const sale = await dash('post', '/reservations/box-office', staff, 'live')
        .send({ showtimeId, seatIds: [seatId(seats, 'A3')], method: 'cash' })
        .expect(201);

      const found = await dash(
        'get',
        `/reservations?code=${sale.body.data.code.toLowerCase()}`,
        staff,
        'live',
      ).expect(200);
      expect(found.body.data).toEqual([
        expect.objectContaining({
          id: sale.body.data.id,
          movieTitle: 'Anikulapo',
        }),
      ]);
      expect(found.body.meta.total).toBe(1);
    });

    it('says too early (or another day) before the doors open', async () => {
      const later = await publishedShowtime(cinema, 180);
      const seats = await boxOfficeSeats('live', later.id);
      const sale = await dash('post', '/reservations/box-office', staff, 'live')
        .send({ showtimeId: later.id, seatIds: [seats[0].id], method: 'cash' })
        .expect(201);

      const early = await scan({ token: sale.body.data.tickets[0].qrToken });
      expect(['too_early', 'not_today']).toContain(early.body.data.result);
      expect(early.body.data.ticket.checkedInAt).toBeNull();
    });

    it('needs a verified org to sell in live mode, but never in test mode', async () => {
      const unverified = await signup();
      const res = await dash(
        'post',
        '/reservations/box-office',
        unverified,
        'live',
      )
        .send({ showtimeId, seatIds: [showtimeId], method: 'cash' })
        .expect(403);
      expect(res.body.error.code).toBe('org_not_verified');
    });
  });

  describe('cancelling a showtime', () => {
    it('cancels its pending holds and voids its tickets', async () => {
      const cinema = await setupCinema();
      const showtime = await publishedShowtime(cinema);
      // Same slot in test mode: cancelling the live showtime leaves it alone.
      const testShowtime = await publishedShowtime(cinema, 30, 'test');

      const testHold = await hold(cinema.keys.skTest, testShowtime.id, [
        seatId(await seatMap(testShowtime.id, cinema.keys.pkTest), 'A1'),
      ]).expect(201);
      const liveSeats = await seatMap(showtime.id, cinema.keys.pkLive);
      const liveHold = await hold(cinema.keys.skLive, showtime.id, [
        seatId(liveSeats, 'A1'),
      ]).expect(201);
      const sale = await dash(
        'post',
        '/reservations/box-office',
        cinema.owner,
        'live',
      )
        .send({
          showtimeId: showtime.id,
          seatIds: [seatId(liveSeats, 'B1')],
          method: 'cash',
        })
        .expect(201);

      await dash(
        'post',
        `/showtimes/${showtime.id}/cancel`,
        cinema.owner,
      ).expect(200);

      const live = await api(
        'get',
        `/reservations/${liveHold.body.data.id}`,
        cinema.keys.skLive,
      ).expect(200);
      expect(live.body.data.status).toBe('cancelled');
      const test = await api(
        'get',
        `/reservations/${testHold.body.data.id}`,
        cinema.keys.skTest,
      ).expect(200);
      expect(test.body.data.status).toBe('pending');

      // Nothing more can be held.
      const closed = await hold(cinema.keys.skLive, showtime.id, [
        seatId(liveSeats, 'A2'),
      ]).expect(409);
      expect(closed.body.error.code).toBe('showtime_not_bookable');

      const scanned = await dash('post', '/tickets/scan', cinema.owner, 'live')
        .send({
          locationId: cinema.locationId,
          token: sale.body.data.tickets[0].qrToken,
        })
        .expect(200);
      expect(scanned.body.data.result).toBe('void');
    });
  });
});
