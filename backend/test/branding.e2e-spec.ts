import { EntitlementsService } from '@src/entitlements/entitlements.service';
import {
  eventually,
  useE2eApp,
  type Mode,
  type Session,
} from './utils/e2e-app';

/**
 * Phase 4c/5 branding: Pro+ orgs upload a logo and header image to Nimbus's Cloudinary,
 * set footer socials, and customer emails render them. Basic orgs are refused, and a
 * downgrade hides branding without losing the stored fields.
 */
describe('Email branding (e2e)', () => {
  const {
    ctx,
    paystack,
    cloudinary,
    dash,
    api,
    signup,
    connectPaystack,
    verifyWebhook,
    paystackWebhook,
    subscribe,
    createApiKey,
    location,
  } = useE2eApp();

  const MINUTE = 60_000;
  const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

  const clearCaches = (orgId: string) =>
    ctx.app.get(EntitlementsService).clear(orgId);

  beforeEach(() => {
    cloudinary.uploads.length = 0;
    cloudinary.deleted.length = 0;
  });

  const connectMail = (owner: Session) =>
    dash('put', '/emails/config', owner)
      .send({
        provider: 'brevo',
        apiKey: 'xkeysib-good',
        fromEmail: 'tickets@filmhouse.test',
        fromName: 'Filmhouse',
      })
      .expect(200);

  const upload = (
    owner: Session,
    asset: 'logo' | 'image',
    file: { content: Buffer; filename: string; contentType: string } = {
      content: PNG,
      filename: 'brand.png',
      contentType: 'image/png',
    },
  ) =>
    dash('post', `/organization/settings/branding/${asset}`, owner).attach(
      'file',
      file.content,
      { filename: file.filename, contentType: file.contentType },
    );

  interface Cinema {
    owner: Session;
    mode: Mode;
    secretKey: string;
    showtimeId: string;
    pk: string;
    sk: string;
  }

  const setupCinema = async (mode: Mode = 'test'): Promise<Cinema> => {
    const owner = await signup();
    await connectMail(owner);
    const secretKey = `sk_${mode}_brandinggood`;
    await connectPaystack(owner, mode, secretKey);
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
        rows: 1,
        columns: 3,
        seats: [
          { row: 0, column: 0 },
          { row: 0, column: 1 },
          { row: 0, column: 2 },
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
          prices: { standard: 300000 },
        })
        .expect(201)
    ).body.data.id as string;
    await dash('post', `/showtimes/${showtimeId}/publish`, owner, mode).expect(
      200,
    );

    await subscribe(owner);

    return {
      owner,
      mode,
      secretKey,
      showtimeId,
      pk: await createApiKey(owner, 'publishable', mode),
      sk: await createApiKey(owner, 'secret', mode),
    };
  };

  const seatsOf = async (cinema: Cinema) =>
    (
      await api(
        'get',
        `/showtimes/${cinema.showtimeId}/seats`,
        cinema.pk,
      ).expect(200)
    ).body.data.seats as { id: string }[];

  let transactionId = 10_000_000_000;

  const bookAndPay = async (cinema: Cinema, email: string) => {
    const seats = await seatsOf(cinema);
    const reservation = (
      await api('post', '/reservations', cinema.sk)
        .send({
          showtimeId: cinema.showtimeId,
          seatIds: [seats[0].id],
          customer: { name: 'Chioma Buyer', email },
        })
        .expect(201)
    ).body.data as { id: string };
    const reference = (
      await api('post', `/reservations/${reservation.id}/checkout`, cinema.sk)
        .send({ callbackUrl: 'http://localhost:3000/paid' })
        .expect(200)
    ).body.data.reference as string;
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
    await eventually(async () => {
      const status = (
        await api('get', `/reservations/${reservation.id}`, cinema.sk).expect(
          200,
        )
      ).body.data.status;
      expect(status).toBe('confirmed');
    });
    return reservation;
  };

  it('refuses branding for a Basic org', async () => {
    const owner = await signup();

    const uploadRes = await upload(owner, 'logo').expect(403);
    expect(uploadRes.body.error.code).toBe('feature_not_in_plan');

    const socials = await dash(
      'patch',
      '/organization/settings/branding',
      owner,
    )
      .send({ instagram: 'https://instagram.com/filmhouse' })
      .expect(403);
    expect(socials.body.error.code).toBe('feature_not_in_plan');
  });

  it('uploads assets, saves socials and renders them in a customer email', async () => {
    const cinema = await setupCinema();

    const logo = await upload(cinema.owner, 'logo').expect(200);
    expect(logo.body.data.companyLogo).toContain(
      'res.cloudinary.com/nimbus-test',
    );
    expect(logo.body.data.companyLogoPublicId).toBeUndefined();

    const header = await upload(cinema.owner, 'image').expect(200);
    expect(header.body.data.emailHeaderImage).toContain(
      'res.cloudinary.com/nimbus-test',
    );

    const socials = await dash(
      'patch',
      '/organization/settings/branding',
      cinema.owner,
    )
      .send({
        instagram: 'https://instagram.com/filmhouse',
        tiktok: 'https://tiktok.com/@filmhouse',
      })
      .expect(200);
    expect(socials.body.data).toMatchObject({
      instagram: 'https://instagram.com/filmhouse',
      tiktok: 'https://tiktok.com/@filmhouse',
      facebook: null,
    });

    const logoUpload = cloudinary.uploads.find((row) => row.name === 'logo')!;
    const headerUpload = cloudinary.uploads.find(
      (row) => row.name === 'header',
    )!;

    // Test mode: the email is rendered and previewable instead of sent.
    await bookAndPay(cinema, 'chidi@example.com');
    let delivery: { id: string; type: string } | undefined;
    await eventually(async () => {
      const rows = (
        await dash('get', '/emails/deliveries', cinema.owner, 'test')
          .query({ limit: 20 })
          .expect(200)
      ).body.data as { id: string; type: string }[];
      delivery = rows.find((row) => row.type === 'confirmation');
      expect(delivery).toBeDefined();
    });

    const preview = (
      await dash(
        'get',
        `/emails/deliveries/${delivery!.id}/preview`,
        cinema.owner,
        'test',
      ).expect(200)
    ).body.data as { html: string; text: string };
    expect(preview.html).toContain(headerUpload.publicId);
    expect(preview.html).toContain(logoUpload.publicId);
    expect(preview.html).toContain('https://instagram.com/filmhouse');
    expect(preview.html).toContain('Instagram');
    expect(preview.text).toContain('TikTok: https://tiktok.com/@filmhouse');
  });

  it('replaces and removes assets, deleting the old Cloudinary files', async () => {
    const cinema = await setupCinema();
    const first = await upload(cinema.owner, 'logo').expect(200);
    const firstId = cloudinary.uploads[0].publicId;

    const second = await upload(cinema.owner, 'logo').expect(200);
    expect(second.body.data.companyLogo).not.toBe(first.body.data.companyLogo);
    expect(cloudinary.deleted).toContain(firstId);

    const secondId = cloudinary.uploads[1].publicId;
    const removed = await dash(
      'delete',
      '/organization/settings/branding/logo',
      cinema.owner,
    ).expect(200);
    expect(removed.body.data.companyLogo).toBeNull();
    expect(cloudinary.deleted).toContain(secondId);
  });

  it('rejects non-images and hides branding after a downgrade', async () => {
    const cinema = await setupCinema();
    const bad = await upload(cinema.owner, 'logo', {
      content: Buffer.from('hello'),
      filename: 'notes.txt',
      contentType: 'text/plain',
    }).expect(400);
    expect(bad.body.error.code).toBe('invalid_image');

    const uploaded = await upload(cinema.owner, 'image').expect(200);
    const publicId = cloudinary.uploads[0].publicId;
    void uploaded;

    await ctx.ownerPool.query(
      `update subscriptions set status = 'cancelled' where organization_id = $1`,
      [cinema.owner.orgId],
    );
    await clearCaches(cinema.owner.orgId);

    await bookAndPay(cinema, 'no-brand@example.com');
    let delivery: { id: string } | undefined;
    await eventually(async () => {
      const rows = (
        await dash('get', '/emails/deliveries', cinema.owner, 'test')
          .query({ limit: 20 })
          .expect(200)
      ).body.data as { id: string; type: string }[];
      delivery = rows.find((row) => row.type === 'confirmation');
      expect(delivery).toBeDefined();
    });
    const preview = (
      await dash(
        'get',
        `/emails/deliveries/${delivery!.id}/preview`,
        cinema.owner,
        'test',
      ).expect(200)
    ).body.data as { html: string };
    expect(preview.html).not.toContain(publicId);
  });
});
