import type { Job } from 'bullmq';
import { ReservationsProcessor } from '@src/reservations/reservations.processor';
import type { ExpireReservationJob } from '@src/common/types/job';
import { eventually, useE2eApp, type Session } from './utils/e2e-app';
import { EXPIRE_JOB } from '@src/common/types/constants';

/**
 * Phase 3a over HTTP: checkout with the org's Paystack key, signed Paystack webhooks, late and
 * duplicate payments, refunds, and a broken key. Paystack itself is the fake in e2e-app.
 */
describe('Payments (e2e)', () => {
  const {
    ctx,
    paystack,
    seq,
    dash,
    api,
    signup,
    joinAs,
    verify,
    connectPaystack,
    verifyWebhook,
    paystackWebhook,
    createApiKey,
    location,
  } = useE2eApp();

  interface SeatMapSeat {
    id: string;
    rowLabel: string;
    number: number;
    available: boolean;
  }

  const MINUTE = 60_000;

  /**
   * A verified org with a published TEST-mode showtime in 30 minutes (5 seats: A1–A3 standard at
   * 3,000, B1–B2 VIP at 5,000), its own test Paystack key, and test + live API keys.
   */
  const setupCinema = async () => {
    const owner = await signup();
    await verify(owner);
    const testKey = `sk_test_${seq()}good`;
    await connectPaystack(owner, 'test', testKey);
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

  // Seat ids first: a request built before awaiting another one loses supertest's server.
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
    ).body.data.id as string;
  };

  const checkout = async (cinema: Cinema, reservationId: string) =>
    (
      await api('post', `/reservations/${reservationId}/checkout`, cinema.sk)
        .send({ callbackUrl: 'http://localhost:3000/paid' })
        .expect(200)
    ).body.data.reference as string;

  let transactionId = 5_000_000_000;

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

  const refundEvent = (cinema: Cinema, reference: string, status: string) =>
    paystackWebhook(cinema.owner.orgId, 'test', cinema.testKey, {
      event: `refund.${status}`,
      data: {
        status,
        transaction_reference: reference,
        refund_reference: null,
        amount: '300000',
        currency: 'NGN',
        domain: 'test',
      },
    }).expect(200);

  const reservation = async (cinema: Cinema, id: string) =>
    (await api('get', `/reservations/${id}`, cinema.sk).expect(200)).body.data;

  /** Waits for the webhook job to settle the reservation. */
  const eventuallyStatus = (cinema: Cinema, id: string, status: string) =>
    eventually(async () => {
      expect((await reservation(cinema, id)).status).toBe(status);
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

  const refundsOf = async (reservationId: string) =>
    (
      await ctx.ownerPool.query<{ reason: string; status: string }>(
        'select reason, status from refunds where reservation_id = $1 order by created_at',
        [reservationId],
      )
    ).rows;

  describe('checkout', () => {
    it("starts a Paystack transaction with the org's key for the mode", async () => {
      const cinema = await setupCinema();
      const id = await hold(cinema, ['A1', 'B1']);

      const res = await api('post', `/reservations/${id}/checkout`, cinema.sk)
        .set('idempotency-key', 'pay-1')
        .send({ callbackUrl: 'http://localhost:3000/paid' })
        .expect(200);

      const { reference, authorizationUrl } = res.body.data as {
        reference: string;
        authorizationUrl: string;
      };
      expect(reference).toMatch(/^nmb-[a-z0-9]{24}$/);
      expect(authorizationUrl).toBe(
        `https://checkout.paystack.com/${reference}`,
      );
      expect(paystack.transactions.get(reference)).toMatchObject({
        secretKey: cinema.testKey,
        email: 'chioma@example.com',
        amount: 800000,
        currency: 'NGN',
        callbackUrl: 'http://localhost:3000/paid',
        metadata: expect.objectContaining({ reservationId: id }),
      });

      // A retried request gets the same transaction back.
      const retry = await api('post', `/reservations/${id}/checkout`, cinema.sk)
        .set('idempotency-key', 'pay-1')
        .send({ callbackUrl: 'http://localhost:3000/paid' })
        .expect(200);
      expect(retry.body.data.reference).toBe(reference);
    });

    it('refuses reservations whose hold has lapsed', async () => {
      const cinema = await setupCinema();
      const id = await hold(cinema, ['A1']);
      await ctx.ownerPool.query(
        `update reservations set expires_at = now() - interval '1 second' where id = $1`,
        [id],
      );

      const res = await api('post', `/reservations/${id}/checkout`, cinema.sk)
        .send({ callbackUrl: 'http://localhost:3000/paid' })
        .expect(409);
      expect(res.body.error.code).toBe('reservation_not_payable');
    });
  });

  describe('done when: a signed webhook confirms the reservation', () => {
    it('confirms, issues tickets, and handles a redelivered event once', async () => {
      const cinema = await setupCinema();
      const id = await hold(cinema, ['A1', 'B1']);
      const reference = await checkout(cinema, id);

      await pay(cinema, reference);
      await eventuallyStatus(cinema, id, 'confirmed');

      const confirmed = await reservation(cinema, id);
      expect(confirmed.tickets).toHaveLength(2);
      expect(confirmed.refund).toBeNull();

      // Paystack retries; the second delivery is acknowledged and ignored.
      const transaction = paystack.transactions.get(reference)!;
      await paystackWebhook(cinema.owner.orgId, 'test', cinema.testKey, {
        event: 'charge.success',
        data: {
          id: transactionId,
          status: 'success',
          reference,
          amount: transaction.amount,
          currency: 'NGN',
        },
      }).expect(200);

      const events = await ctx.ownerPool.query(
        'select 1 from payment_events where reference = $1',
        [reference],
      );
      expect(events.rowCount).toBe(1);
      const payments = await ctx.ownerPool.query(
        'select status, provider_transaction_id from payments where reference = $1',
        [reference],
      );
      expect(payments.rows).toEqual([
        { status: 'succeeded', provider_transaction_id: String(transactionId) },
      ]);
      expect((await reservation(cinema, id)).tickets).toHaveLength(2);
    });

    it('rejects webhooks not signed with that mode’s key', async () => {
      const cinema = await setupCinema();
      const payload = { event: 'charge.success', data: { id: 1 } };

      await paystackWebhook(
        cinema.owner.orgId,
        'test',
        'sk_test_someone_else',
        payload,
      ).expect(401);
      // The live URL checks against the live key.
      await paystackWebhook(
        cinema.owner.orgId,
        'live',
        cinema.testKey,
        payload,
      ).expect(401);
    });
  });

  describe('late and duplicate payments', () => {
    it('confirms a payment that lands after expiry if its seats are still free', async () => {
      const cinema = await setupCinema();
      const id = await hold(cinema, ['A2']);
      const reference = await checkout(cinema, id);
      await expire(cinema, id);
      expect((await reservation(cinema, id)).status).toBe('expired');

      await pay(cinema, reference);

      await eventuallyStatus(cinema, id, 'confirmed');
      expect((await reservation(cinema, id)).tickets).toHaveLength(1);
    });

    it('refunds a late payment whose seats were sold meanwhile', async () => {
      const cinema = await setupCinema();
      const id = await hold(cinema, ['A3']);
      const reference = await checkout(cinema, id);
      await expire(cinema, id);
      await hold(cinema, ['A3']); // someone else takes the seat

      await pay(cinema, reference);

      await eventually(async () => {
        expect(paystack.refunds).toContainEqual({
          secretKey: cinema.testKey,
          reference,
        });
      });
      const late = await reservation(cinema, id);
      expect(late.status).toBe('expired');
      expect(late.refund).toMatchObject({
        reason: 'payment_conflict',
        status: 'pending',
        amount: 300000,
      });
    });

    it('refunds a second payment for an already-paid reservation', async () => {
      const cinema = await setupCinema();
      const id = await hold(cinema, ['B2']);
      const first = await checkout(cinema, id);
      const second = await checkout(cinema, id);

      await pay(cinema, first);
      await eventuallyStatus(cinema, id, 'confirmed');
      await pay(cinema, second);

      await eventually(async () => {
        expect(await refundsOf(id)).toEqual([
          { reason: 'duplicate_payment', status: 'pending' },
        ]);
      });
      const paid = await reservation(cinema, id);
      expect(paid.status).toBe('confirmed');
      // The customer's own payment wasn't refunded.
      expect(paid.refund).toBeNull();
    });
  });

  describe('refunds', () => {
    let cinema: Cinema;
    let manager: Session;
    beforeAll(async () => {
      cinema = await setupCinema();
      manager = await joinAs(cinema.owner, `manager${seq()}@example.com`, {
        role: 'manager',
      });
    });

    /** A reservation paid online, confirmed. */
    const paidReservation = async (labels: string[]) => {
      const id = await hold(cinema, labels);
      const reference = await checkout(cinema, id);
      await pay(cinema, reference);
      await eventuallyStatus(cinema, id, 'confirmed');
      return { id, reference };
    };

    it('refunds through Paystack, voids the tickets and puts the seats back on sale', async () => {
      const { id, reference } = await paidReservation(['A1']);
      const ticket = (await reservation(cinema, id)).tickets[0] as {
        qrToken: string;
      };

      const res = await dash(
        'post',
        `/reservations/${id}/refund`,
        manager,
        'test',
      )
        .send({ note: 'Customer asked' })
        .expect(200);
      expect(res.body.data).toMatchObject({
        status: 'refunded',
        refund: { status: 'pending', reason: 'requested', amount: 300000 },
      });
      expect(paystack.refunds).toContainEqual({
        secretKey: cinema.testKey,
        reference,
      });

      const [seat] = await seatIds(cinema, ['A1']);
      const seats = (
        await api('get', `/showtimes/${cinema.showtimeId}/seats`, cinema.pk)
      ).body.data.seats as SeatMapSeat[];
      expect(seats.find((s) => s.id === seat)!.available).toBe(true);

      const scanned = await dash('post', '/tickets/scan', manager, 'test')
        .send({ locationId: cinema.locationId, token: ticket.qrToken })
        .expect(200);
      expect(scanned.body.data.result).toBe('void');

      const again = await dash(
        'post',
        `/reservations/${id}/refund`,
        manager,
        'test',
      ).expect(409);
      expect(again.body.error.code).toBe('reservation_not_refundable');

      // Paystack's progress, and a late event never moves a finished refund back.
      await refundEvent(cinema, reference, 'processed');
      await refundEvent(cinema, reference, 'processing');
      await eventually(async () => {
        expect((await reservation(cinema, id)).refund.status).toBe('processed');
      });
    });

    it('retries a refund that failed at Paystack', async () => {
      const { id, reference } = await paidReservation(['A2']);
      await dash('post', `/reservations/${id}/refund`, manager, 'test').expect(
        200,
      );

      await refundEvent(cinema, reference, 'failed');
      await eventually(async () => {
        expect((await reservation(cinema, id)).refund.status).toBe('failed');
      });

      const calls = paystack.refunds.length;
      const retried = await dash(
        'post',
        `/reservations/${id}/refund`,
        manager,
        'test',
      ).expect(200);
      expect(retried.body.data.refund.status).toBe('pending');
      expect(paystack.refunds).toHaveLength(calls + 1);
    });

    it('leaves the reservation confirmed when Paystack errors', async () => {
      const { id } = await paidReservation(['A3']);
      paystack.failNextRefund = 500;

      const res = await dash(
        'post',
        `/reservations/${id}/refund`,
        manager,
        'test',
      ).expect(502);
      expect(res.body.error.code).toBe('payment_provider_unavailable');
      expect(await reservation(cinema, id)).toMatchObject({
        status: 'confirmed',
        refund: null,
      });
    });

    it('records box-office refunds as handed back, without Paystack', async () => {
      const [seat] = await seatIds(cinema, ['B1']);
      const sale = await dash(
        'post',
        '/reservations/box-office',
        cinema.owner,
        'test',
      )
        .send({
          showtimeId: cinema.showtimeId,
          seatIds: [seat],
          method: 'cash',
        })
        .expect(201);
      const calls = paystack.refunds.length;

      const res = await dash(
        'post',
        `/reservations/${sale.body.data.id}/refund`,
        manager,
        'test',
      ).expect(200);
      expect(res.body.data.refund).toMatchObject({
        status: 'processed',
        amount: 500000,
      });
      expect(paystack.refunds).toHaveLength(calls);
    });

    it('is for owners and managers only', async () => {
      const staff = await joinAs(cinema.owner, `staff${seq()}@example.com`);
      const { id } = await paidReservation(['B2']);

      await dash('post', `/reservations/${id}/refund`, staff, 'test').expect(
        403,
      );
    });
  });

  describe('a broken Paystack key', () => {
    it('stops online booking in its mode until reconnected, then reconciles', async () => {
      const cinema = await setupCinema();
      const id = await hold(cinema, ['A1']);
      const reference = await checkout(cinema, id);

      // The org revokes its key in Paystack; the next call finds out.
      paystack.revokedKeys.add(cinema.testKey);
      const other = await hold(cinema, ['A2']);
      const res = await api(
        'post',
        `/reservations/${other}/checkout`,
        cinema.sk,
      )
        .send({ callbackUrl: 'http://localhost:3000/paid' })
        .expect(503);
      expect(res.body.error.code).toBe('payment_provider_unavailable');

      const config = await dash('get', '/payment-config', cinema.owner, 'test');
      expect(config.body.data.status).toBe('broken');

      // No new holds without a way to pay.
      const a3 = await seatIds(cinema, ['A3']);
      const blocked = await api('post', '/reservations', cinema.sk)
        .send({
          showtimeId: cinema.showtimeId,
          seatIds: a3,
          customer: { name: 'Chioma Buyer', email: 'chioma@example.com' },
        })
        .expect(503);
      expect(blocked.body.error.code).toBe('payment_provider_unavailable');

      // The customer had paid before the break, but its webhook never made it.
      paystack.verifyStatus.set(reference, 'success');
      await connectPaystack(cinema.owner, 'test', `sk_test_${seq()}good`);

      await eventuallyStatus(cinema, id, 'confirmed');
      expect(
        (await dash('get', '/payment-config', cinema.owner, 'test')).body.data,
      ).toMatchObject({ status: 'verified', isWebhookVerified: false });
    });
  });

  describe('cancelling a showtime', () => {
    it('refunds online sales automatically and leaves box-office sales to staff', async () => {
      const cinema = await setupCinema();
      const online = await hold(cinema, ['A1']);
      await pay(cinema, await checkout(cinema, online));
      await eventuallyStatus(cinema, online, 'confirmed');
      const [seat] = await seatIds(cinema, ['B1']);
      const sale = await dash(
        'post',
        '/reservations/box-office',
        cinema.owner,
        'test',
      )
        .send({ showtimeId: cinema.showtimeId, seatIds: [seat], method: 'pos' })
        .expect(201);

      await dash(
        'post',
        `/showtimes/${cinema.showtimeId}/cancel`,
        cinema.owner,
        'test',
      ).expect(200);

      await eventuallyStatus(cinema, online, 'refunded');
      expect((await reservation(cinema, online)).refund).toMatchObject({
        reason: 'showtime_cancelled',
      });
      expect(
        (await reservation(cinema, sale.body.data.id as string)).status,
      ).toBe('confirmed');
    });
  });
});
