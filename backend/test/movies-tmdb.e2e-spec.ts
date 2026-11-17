import { useE2eApp } from './utils/e2e-app';

/** Phase 5: Pro+ orgs import movie metadata from TMDB. */
describe('TMDB import (e2e)', () => {
  const { dash, signup, subscribe } = useE2eApp();

  it('refuses Basic orgs', async () => {
    const session = await signup();

    const search = await dash('get', '/movies/import/tmdb', session)
      .query({ query: 'fight' })
      .expect(403);
    expect(search.body.error.code).toBe('feature_not_in_plan');

    const imported = await dash('post', '/movies/import/tmdb', session, 'test')
      .send({ tmdbId: 550 })
      .expect(403);
    expect(imported.body.error.code).toBe('feature_not_in_plan');
  });

  it('searches and imports into the request mode', async () => {
    const session = await signup();
    await subscribe(session);

    const search = await dash('get', '/movies/import/tmdb', session)
      .query({ query: 'fight' })
      .expect(200);
    expect(search.body.data[0]).toMatchObject({
      tmdbId: 550,
      title: 'Fight Club',
      releaseDate: '1999-10-15',
      posterUrl: 'https://image.tmdb.org/t/p/w500/fight-club.jpg',
    });

    const imported = await dash('post', '/movies/import/tmdb', session, 'test')
      .send({ tmdbId: 550 })
      .expect(201);
    expect(imported.body.data).toMatchObject({
      tmdbId: 550,
      title: 'Fight Club',
      runtimeMinutes: 139,
      language: 'en',
      genres: ['Drama', 'Thriller'],
      posterUrl: 'https://image.tmdb.org/t/p/w500/fight-club.jpg',
      trailerUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      livemode: false,
    });

    const listed = await dash('get', '/movies', session, 'test').expect(200);
    expect(
      listed.body.data.some(
        (movie: { tmdbId: number }) => movie.tmdbId === 550,
      ),
    ).toBe(true);

    const duplicate = await dash('post', '/movies/import/tmdb', session, 'test')
      .send({ tmdbId: 550 })
      .expect(409);
    expect(duplicate.body.error.code).toBe('movie_already_imported');

    // Movies are per mode, so the same TMDB id can be imported into live separately.
    await dash('post', '/movies/import/tmdb', session, 'live')
      .send({ tmdbId: 550 })
      .expect(201);
  });
});
