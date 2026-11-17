import { HttpStatus, Injectable } from '@nestjs/common';
import { CodedException } from '@src/common/errors';
import { Secrets } from '@src/common/secrets';
import { REQUEST_TIMEOUT_MS } from '@src/common/util';

const TMDB_API_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_URL = 'https://image.tmdb.org/t/p/w500';
const TMDB_YOUTUBE_URL = 'https://www.youtube.com/watch?v=';

export interface TmdbSearchResult {
  tmdbId: number;
  title: string;
  releaseDate: string | null;
  overview: string | null;
  posterUrl: string | null;
}

export interface TmdbMovieDetails {
  tmdbId: number;
  title: string;
  synopsis: string | null;
  runtimeMinutes: number;
  language: string | null;
  genres: string[];
  posterUrl: string | null;
  trailerUrl: string | null;
}

interface TmdbSearchResponse {
  results?: {
    id: number;
    title?: string;
    release_date?: string;
    overview?: string;
    poster_path?: string | null;
  }[];
}

interface TmdbMovieResponse {
  id: number;
  title?: string;
  overview?: string;
  runtime?: number | null;
  original_language?: string;
  genres?: { name: string }[];
  poster_path?: string | null;
  videos?: {
    results?: { site?: string; type?: string; key?: string }[];
  };
}

@Injectable()
export class TmdbProvider {
  get configured(): boolean {
    return Boolean(Secrets.TMDB_API_KEY);
  }

  async search(query: string): Promise<TmdbSearchResult[]> {
    const data = await this.request<TmdbSearchResponse>('/search/movie', {
      query,
      include_adult: 'false',
      language: 'en-US',
      page: '1',
    });

    return (data.results ?? []).map((movie) => ({
      tmdbId: movie.id,
      title: movie.title ?? '',
      releaseDate: movie.release_date ?? null,
      overview: movie.overview || null,
      posterUrl: movie.poster_path
        ? `${TMDB_IMAGE_URL}${movie.poster_path}`
        : null,
    }));
  }

  async details(tmdbId: number): Promise<TmdbMovieDetails> {
    const movie = await this.request<TmdbMovieResponse>(
      `/movie/${tmdbId}`,
      { append_to_response: 'videos' },
      tmdbId,
    );

    if (!movie.title || !movie.runtime || movie.runtime <= 0) {
      throw new CodedException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'tmdb_movie_incomplete',
        'TMDB returned no title or runtime for this movie',
      );
    }

    return {
      tmdbId: movie.id,
      title: movie.title,
      synopsis: movie.overview || null,
      runtimeMinutes: movie.runtime,
      language: movie.original_language ?? null,
      genres: (movie.genres ?? []).map((genre) => genre.name),
      posterUrl: movie.poster_path
        ? `${TMDB_IMAGE_URL}${movie.poster_path}`
        : null,
      trailerUrl: this.trailer(movie),
    };
  }

  private trailer(movie: TmdbMovieResponse): string | null {
    const videos = movie.videos?.results ?? [];
    const trailer =
      videos.find(
        (video) => video.site === 'YouTube' && video.type === 'Trailer',
      ) ??
      videos.find(
        (video) => video.site === 'YouTube' && video.type === 'Teaser',
      );
    return trailer?.key ? `${TMDB_YOUTUBE_URL}${trailer.key}` : null;
  }

  private async request<T>(
    path: string,
    params: Record<string, string>,
    tmdbId?: number,
  ): Promise<T> {
    const key = Secrets.TMDB_API_KEY;
    if (!key) {
      throw new CodedException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'tmdb_not_configured',
        'TMDB import is not configured on this deployment',
      );
    }

    const url = new URL(`${TMDB_API_URL}${path}`);
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(name, value);
    }
    // v3 keys go in the query string; v4 tokens are JWTs and go in the Authorization header.
    const bearer = key.includes('.');
    if (!bearer) {
      url.searchParams.set('api_key', key);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        headers: bearer ? { authorization: `Bearer ${key}` } : {},
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new CodedException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'tmdb_unavailable',
        `Could not reach TMDB: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (response.status === 404 && tmdbId) {
      throw new CodedException(
        HttpStatus.NOT_FOUND,
        'tmdb_movie_not_found',
        `TMDB has no movie with id ${tmdbId}`,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new CodedException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'tmdb_rejected',
        'TMDB rejected the configured API key',
      );
    }
    if (response.status === 429 || response.status >= 500) {
      throw new CodedException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'tmdb_unavailable',
        'TMDB is temporarily unavailable',
      );
    }
    if (!response.ok) {
      throw new CodedException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'tmdb_rejected',
        'TMDB rejected the request',
      );
    }

    return (await response.json()) as T;
  }
}
