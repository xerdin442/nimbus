import { useE2eApp } from './utils/e2e-app';

/** Phase 5: live-only reports per location, with CSV export behind `reports.export`. */
describe('Reports (e2e)', () => {
  const { dash, signup, verify, location, subscribe } = useE2eApp();

  const localDate = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(date);

  interface Cinema {
    owner: Awaited<ReturnType<typeof signup>>;
    locationId: string;
    showtimeId: string;
    showDate: string;
  }

  const setupCinema = async (): Promise<Cinema> => {
    const owner = await signup();
    await verify(owner);
    await subscribe(owner);

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
      await dash('post', '/movies', owner, 'live')
        .send({ title: 'Anikulapo', runtimeMinutes: 100 })
        .expect(201)
    ).body.data.id as string;
    const startsAt = new Date(Date.now() + 30 * 60_000);
    const showtimeId = (
      await dash('post', '/showtimes', owner, 'live')
        .send({
          screenId,
          movieId,
          startsAt: startsAt.toISOString(),
          prices: { standard: 300000 },
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
      locationId,
      showtimeId,
      showDate: localDate(startsAt),
    };
  };

  const seatsOf = async (cinema: Cinema) =>
    (
      await dash(
        'get',
        `/showtimes/${cinema.showtimeId}/seats`,
        cinema.owner,
        'live',
      ).expect(200)
    ).body.data.seats as { id: string }[];

  const sell = (cinema: Cinema, seatIds: string[]) =>
    dash('post', '/reservations/box-office', cinema.owner, 'live')
      .send({ showtimeId: cinema.showtimeId, seatIds, method: 'cash' })
      .expect(201);

  const range = (cinema: Cinema) => ({
    locationId: cinema.locationId,
    startDate: cinema.showDate,
    endDate: cinema.showDate,
  });

  it('summarises tickets, revenue, occupancy, days and top movies', async () => {
    const cinema = await setupCinema();
    const seats = await seatsOf(cinema);
    await sell(cinema, [seats[0].id, seats[1].id]);
    const refunded = await sell(cinema, [seats[2].id]);
    await dash(
      'post',
      `/reservations/${refunded.body.data.id}/refund`,
      cinema.owner,
      'live',
    )
      .send({ note: 'customer changed their mind' })
      .expect(200);

    const summary = await dash('get', '/reports/summary', cinema.owner)
      .query(range(cinema))
      .expect(200);
    expect(summary.body.data.totals).toMatchObject({
      reservations: 1,
      ticketsSold: 2,
      revenue: 600_000,
      refunds: 300_000,
      netRevenue: 300_000,
      seatsSold: 2,
      capacity: 3,
      occupancyPct: 66.7,
      currency: 'NGN',
    });
    expect(summary.body.data.byDay).toHaveLength(1);
    expect(summary.body.data.byDay[0]).toMatchObject({
      date: cinema.showDate,
      ticketsSold: 2,
      revenue: 600_000,
      refunds: 300_000,
    });
    expect(summary.body.data.topMovies[0]).toMatchObject({
      title: 'Anikulapo',
      ticketsSold: 2,
      revenue: 600_000,
    });

    const showtimes = await dash('get', '/reports/showtimes', cinema.owner)
      .query(range(cinema))
      .expect(200);
    expect(showtimes.body.data).toHaveLength(1);
    expect(showtimes.body.data[0]).toMatchObject({
      movieTitle: 'Anikulapo',
      screenName: 'Screen 1',
      capacity: 3,
      seatsSold: 2,
      occupancyPct: 66.7,
      ticketsSold: 2,
      revenue: 600_000,
    });
  });

  it('exports CSV for Pro, refuses Basic and enforces history', async () => {
    const cinema = await setupCinema();
    const seats = await seatsOf(cinema);
    await sell(cinema, [seats[0].id]);

    const csv = await dash('get', '/reports/export', cinema.owner)
      .query(range(cinema))
      .buffer(true)
      .parse((response, callback) => {
        let body = '';
        response.on('data', (chunk: Buffer) => (body += chunk.toString()));
        response.on('end', () => callback(null, body));
      })
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('attachment');
    expect(String(csv.body)).toContain('"Anikulapo"');
    expect(String(csv.body)).toContain('"3000.00"');
    expect(String(csv.body)).toContain('"Total"');

    const basic = await signup();
    const denied = await dash('get', '/reports/export', basic)
      .query({
        locationId: '00000000-0000-4000-8000-000000000001',
        startDate: cinema.showDate,
        endDate: cinema.showDate,
      })
      .expect(403);
    expect(denied.body.error.code).toBe('feature_not_in_plan');

    const basicLocation = (
      await dash('post', '/locations', basic)
        .send(location('Basic Cinema'))
        .expect(201)
    ).body.data.id as string;
    const tooOld = await dash('get', '/reports/summary', basic)
      .query({
        locationId: basicLocation,
        startDate: '2020-01-01',
        endDate: cinema.showDate,
      })
      .expect(403);
    expect(tooOld.body.error.code).toBe('report_history_limited');

    const testMode = await dash('get', '/reports/summary', cinema.owner, 'test')
      .query(range(cinema))
      .expect(403);
    expect(testMode.body.error.code).toBe('reports_live_only');
  });
});
