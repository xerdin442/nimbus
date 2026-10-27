import {
  eventually,
  useE2eApp,
  type Mode,
  type Session,
} from './utils/e2e-app';

/**
 * Phase 3c over HTTP: customer emails (confirmation with one QR PNG per ticket,
 * cancellation, refund) through the org's own provider, test-mode skips and
 * "send test emails to me", throttled failure alerts, and the email log with retries.
 * Brevo is faked in e2e-app: it accepts any key but "bad", refuses recipients whose
 * address contains "invalid", and records every send for assertions.
 */
describe('Customer emails (e2e)', () => {
  const {
    ctx,
    paystack,
    brevoSends,
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

  const connectMail = (owner: Session) =>
    dash('put', '/emails/config', owner)
      .send({
        provider: 'brevo',
        apiKey: 'xkeysib-good',
        fromEmail: 'tickets@filmhouse.test',
        fromName: 'Filmhouse',
      })
      .expect(200);

  /** An org with a showtime in 30 minutes and Paystack + API keys ready to book, in `mode`. */
  const setupCinema = async (mode: Mode) => {
    const owner = await signup();
    await connectMail(owner);

    const secretKey = `sk_${mode}_${seq()}good`;
    await connectPaystack(owner, mode, secretKey);
    // Online checkout needs a webhook-verified config (the verification payment itself).
    await verifyWebhook(owner, mode, secretKey);

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
      await dash('post', '/movies', owner, mode)
        .send({ title: 'Anikulapo', runtimeMinutes: 100 })
        .expect(201)
    ).body.data.id as string;
    const showtimeId = (
      await dash('post', '/showtimes', owner, mode)
        .send({
          screenId,
          movieId,
          startsAt: new Date(Date.now() + 30 * MINUTE).toISOString(),
          prices: { standard: 300000, vip: 500000 },
        })
        .expect(201)
    ).body.data.id as string;
    await dash('post', `/showtimes/${showtimeId}/publish`, owner, mode).expect(
      200,
    );

    return {
      owner,
      mode,
      secretKey,
      showtimeId,
      pk: await createApiKey(owner, 'publishable', mode),
      sk: await createApiKey(owner, 'secret', mode),
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

  const hold = async (cinema: Cinema, labels: string[], email: string) =>
    (
      await api('post', '/reservations', cinema.sk)
        .send({
          showtimeId: cinema.showtimeId,
          seatIds: await seatIds(cinema, labels),
          customer: { name: 'Chioma Buyer', email },
        })
        .expect(201)
    ).body.data as { id: string; code: string; total: number };

  const checkout = async (cinema: Cinema, reservationId: string) =>
    (
      await api('post', `/reservations/${reservationId}/checkout`, cinema.sk)
        .send({ callbackUrl: 'http://localhost:3000/paid' })
        .expect(200)
    ).body.data.reference as string;

  let transactionId = 5_000_000_000;

  /** Paystack's signed `charge.success` for a reference it initialized. */
  const pay = async (cinema: Cinema, reference: string) => {
    const transaction = paystack.transactions.get(reference)!;
    await paystackWebhook(cinema.owner.orgId, cinema.mode, cinema.secretKey, {
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

  const eventuallyStatus = (cinema: Cinema, id: string, status: string) =>
    eventually(async () => {
      const res = await api('get', `/reservations/${id}`, cinema.sk).expect(
        200,
      );
      expect(res.body.data.status).toBe(status);
    });

  /** Books `labels` and pays, so the reservation is confirmed and its emails are due. */
  const bookAndPay = async (
    cinema: Cinema,
    labels: string[],
    email: string,
  ) => {
    const reservation = await hold(cinema, labels, email);
    const reference = await checkout(cinema, reservation.id);
    await pay(cinema, reference);
    await eventuallyStatus(cinema, reservation.id, 'confirmed');
    return reservation;
  };

  interface DeliveryRow {
    id: string;
    type: string;
    to: string;
    status: string;
    failureReason: string | null;
    attempts: number;
  }

  const deliveries = async (owner: Session, mode: Mode) =>
    (
      await dash('get', '/emails/deliveries', owner, mode)
        .query({ limit: 100 })
        .expect(200)
    ).body.data as DeliveryRow[];

  const eventuallyDelivery = async (
    owner: Session,
    mode: Mode,
    match: Partial<DeliveryRow>,
  ) => {
    let found: DeliveryRow | undefined;
    await eventually(async () => {
      const rows = await deliveries(owner, mode);
      found = rows.find(
        (row) =>
          (!match.type || row.type === match.type) &&
          (!match.to || row.to === match.to) &&
          (!match.status || row.status === match.status) &&
          (!match.failureReason || row.failureReason === match.failureReason),
      );
      expect(found).toBeDefined();
    });
    return found!;
  };

  const brevoSendTo = (email: string) =>
    brevoSends.filter(
      ({ body }) => (body.to as { email: string }[])[0]?.email === email,
    );

  describe('live mode: the customer gets their tickets', () => {
    let cinema: Cinema;

    beforeAll(async () => {
      cinema = await setupCinema('live');
    });

    it('emails a confirmation with one QR PNG per ticket', async () => {
      const reservation = await bookAndPay(
        cinema,
        ['A1', 'A2'],
        'ada@example.com',
      );
      const full = (
        await api('get', `/reservations/${reservation.id}`, cinema.sk).expect(
          200,
        )
      ).body.data as { tickets: { code: string }[] };
      const codes = full.tickets.map((t) => t.code).sort();

      await eventually(async () => {
        const sent = brevoSendTo('ada@example.com').find(({ body }) =>
          String(body.subject).includes('Anikulapo'),
        );
        expect(sent).toBeDefined();
        expect(String(sent!.body.subject)).toContain('Filmhouse');
        const attachments = sent!.body.attachment as { name: string }[];
        expect(attachments).toHaveLength(2);
        expect(
          attachments
            .map((a) => a.name.replace('ticket-', '').replace('.png', ''))
            .sort(),
        ).toEqual(codes);
        expect(String(sent!.body.htmlContent)).toContain(reservation.code);
        expect(String(sent!.body.textContent)).toContain(codes[0]);
      });

      const row = await eventuallyDelivery(cinema.owner, 'live', {
        type: 'confirmation',
        to: 'ada@example.com',
        status: 'sent',
      });
      expect(row.attempts).toBe(1);
      expect(row.failureReason).toBeNull();
    });
  });

  describe('test mode: previews instead of customer sends', () => {
    let cinema: Cinema;

    beforeAll(async () => {
      cinema = await setupCinema('test');
    });

    it('logs test-mode emails as skipped with a previewable rendering', async () => {
      const reservation = await bookAndPay(cinema, ['A1'], 'chidi@example.com');

      const row = await eventuallyDelivery(cinema.owner, 'test', {
        type: 'confirmation',
        to: 'chidi@example.com',
      });
      expect(row.status).toBe('skipped');
      expect(row.failureReason).toBe('test_mode');
      expect(row.attempts).toBe(0);

      // No provider call reaches the fake Brevo for the customer's address.
      expect(brevoSendTo('chidi@example.com')).toHaveLength(0);

      const preview = (
        await dash(
          'get',
          `/emails/deliveries/${row.id}/preview`,
          cinema.owner,
          'test',
        ).expect(200)
      ).body.data as { subject: string; html: string; text: string };
      expect(preview.subject).toContain('Anikulapo');
      expect(preview.html).toContain(reservation.code);
      expect(preview.text).toContain('A1');
    });

    it('sends test-mode emails to the notification email when "send to me" is on', async () => {
      await dash('patch', '/organization/settings', cinema.owner, 'test')
        .send({ sendTestEmailsToMe: true })
        .expect(200);

      await bookAndPay(cinema, ['A2'], 'bisi@example.com');

      await eventually(async () => {
        const sent = brevoSendTo(cinema.owner.email).find(({ body }) =>
          String(body.subject).includes('Anikulapo'),
        );
        expect(sent).toBeDefined();
      });
      const row = await eventuallyDelivery(cinema.owner, 'test', {
        type: 'confirmation',
        to: cinema.owner.email,
        status: 'sent',
      });
      expect(row.failureReason).toBeNull();
    });

    it('emails cancellations and refunds', async () => {
      // A pending reservation cancelled by the storefront.
      const cancelled = await hold(cinema, ['A3'], 'tola@example.com');
      await api(
        'post',
        `/reservations/${cancelled.id}/cancel`,
        cinema.sk,
      ).expect(200);
      const cancellation = await eventuallyDelivery(cinema.owner, 'test', {
        type: 'cancellation',
        status: 'sent',
      });
      expect(cancellation.to).toBe(cinema.owner.email);

      // A confirmed reservation refunded by staff.
      const refunded = await bookAndPay(cinema, ['B1'], 'ngozi@example.com');
      await dash(
        'post',
        `/reservations/${refunded.id}/refund`,
        cinema.owner,
        'test',
      ).expect(200);
      const refund = await eventuallyDelivery(cinema.owner, 'test', {
        type: 'refund',
        status: 'sent',
      });
      expect(refund.to).toBe(cinema.owner.email);
      const sent = brevoSendTo(cinema.owner.email).find(({ body }) =>
        String(body.subject).toLowerCase().includes('refund'),
      );
      expect(sent).toBeDefined();
    });
  });

  describe('failures: broken providers, alerts and retries', () => {
    let cinema: Cinema;

    beforeEach(async () => {
      await ctx.ownerPool.query(`update mail_configs set status = 'verified'`);
    });
    beforeAll(async () => {
      cinema = await setupCinema('test');
      await dash('patch', '/organization/settings', cinema.owner, 'test')
        .send({ sendTestEmailsToMe: true })
        .expect(200);
    });

    it('fails into the backlog while the provider is broken, alerts once and retries after', async () => {
      await ctx.ownerPool.query(`update mail_configs set status = 'broken'`);

      // Two bookings fail: the provider is never called, and the alert is throttled
      // to one email for the hour no matter how many sends fail.
      await bookAndPay(cinema, ['A1'], 'ada@example.com');
      await bookAndPay(cinema, ['A2'], 'bisi@example.com');

      await eventually(async () => {
        const rows = (await deliveries(cinema.owner, 'test')).filter(
          (row) => row.status === 'failed',
        );
        expect(rows).toHaveLength(2);
        expect(rows.every((row) => row.attempts === 0)).toBe(true);
      });

      await eventually(async () => {
        const alerts = ctx.platformMail.mock.calls
          .map(([, email]) => email as { subject: string })
          .filter((email) => email.subject.includes('emails are failing'));
        expect(alerts.length).toBeGreaterThanOrEqual(1);
        expect(alerts).toHaveLength(1);
      });

      // The provider is fixed: a single retry sends the email.
      await ctx.ownerPool.query(`update mail_configs set status = 'verified'`);
      const rows2 = await deliveries(cinema.owner, 'test');
      const retried = (
        await dash(
          'post',
          `/emails/deliveries/${rows2[0].id}/retry`,
          cinema.owner,
          'test',
        )
          .send({})
          .expect(201)
      ).body.data as { retried: number };
      expect(retried.retried).toBe(1);
      await eventuallyDelivery(cinema.owner, 'test', {
        type: 'confirmation',
        to: cinema.owner.email,
        status: 'sent',
      });

      // And the backlog drains in bulk, respecting the provider's rate limits.
      const bulk = (
        await dash('post', '/emails/deliveries/retry', cinema.owner, 'test')
          .send({ status: 'failed' })
          .expect(201)
      ).body.data as { retried: number };
      expect(bulk.retried).toBe(1);
      await eventuallyDelivery(cinema.owner, 'test', {
        type: 'confirmation',
        to: cinema.owner.email,
        status: 'sent',
      });
      const stillFailed = (await deliveries(cinema.owner, 'test')).filter(
        (row) => row.status === 'failed',
      );
      expect(stillFailed).toHaveLength(0);
    });

    it('refuses to retry a rejected recipient', async () => {
      await dash('patch', '/organization', cinema.owner)
        .send({ notificationEmail: 'invalid@filmhouse.test' })
        .expect(200);

      await bookAndPay(cinema, ['A3'], 'eze@example.com');

      const row = await eventuallyDelivery(cinema.owner, 'test', {
        type: 'confirmation',
        status: 'failed',
        failureReason: 'invalid_recipient',
      });
      expect(row.attempts).toBe(1);

      const res = await dash(
        'post',
        `/emails/deliveries/${row.id}/retry`,
        cinema.owner,
        'test',
      )
        .send({})
        .expect(409);
      expect(res.body.error.code).toBe('email_not_retryable');
    });

    it('alerts when a refund fails', async () => {
      const reservation = await bookAndPay(cinema, ['B2'], 'chidi@example.com');
      await dash(
        'post',
        `/reservations/${reservation.id}/refund`,
        cinema.owner,
        'test',
      ).expect(200);

      // Paystack reports the refund failed; the org is alerted, the customer is not re-emailed.
      const payment = await ctx.ownerPool.query(
        `select reference from payments where reservation_id = $1`,
        [reservation.id],
      );
      await paystackWebhook(cinema.owner.orgId, 'test', cinema.secretKey, {
        event: 'refund.failed',
        data: {
          transaction_reference: payment.rows[0].reference as string,
        },
      }).expect(200);

      await eventually(async () => {
        const alerts = ctx.platformMail.mock.calls
          .map(([, email]) => email as { subject: string })
          .filter((email) =>
            email.subject.toLowerCase().includes('refund failed'),
          );
        expect(alerts).toHaveLength(1);
      });
    });
  });
});
