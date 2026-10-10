import { Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { DbService } from '@src/db/db.service';
import { movies } from '@src/db/schema';
import type { Movie } from '@src/db/schema/types';
import type {
  MembershipContext,
  PaginatedResult,
  TenantContext,
} from '@src/common/types';
import { canAccessAllLocations } from '@src/locations/location-access';
import {
  CreateMovieDto,
  ListMoviesQueryDto,
  UpdateMovieDto,
} from './dto/movie.dto';

@Injectable()
export class MoviesService {
  constructor(private readonly db: DbService) {}

  async list(
    ctx: TenantContext,
    options: ListMoviesQueryDto,
  ): Promise<PaginatedResult<Movie>> {
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;

    const where = options.archived
      ? isNotNull(movies.archivedAt)
      : isNull(movies.archivedAt);

    const [data, [{ total }]] = await this.db.withTenant(ctx, (tx) =>
      Promise.all([
        tx
          .select()
          .from(movies)
          .where(where)
          // id breaks ties so rows created in the same instant keep a stable page order
          .orderBy(desc(movies.createdAt), desc(movies.id))
          .limit(limit)
          .offset((page - 1) * limit),
        tx.select({ total: count() }).from(movies).where(where),
      ]),
    );

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      },
    };
  }

  async get(ctx: TenantContext, id: string): Promise<Movie> {
    const [movie] = await this.db.withTenant(ctx, (tx) =>
      tx.select().from(movies).where(eq(movies.id, id)),
    );

    if (!movie) {
      throw new NotFoundException('Movie not found');
    }

    return movie;
  }

  async create(ctx: TenantContext, dto: CreateMovieDto): Promise<Movie> {
    const [movie] = await this.db.withTenant(ctx, (tx) =>
      tx
        .insert(movies)
        .values({ organizationId: ctx.orgId, ...dto })
        .returning(),
    );
    return movie;
  }

  async update(
    ctx: TenantContext,
    id: string,
    dto: UpdateMovieDto,
  ): Promise<Movie> {
    const [movie] = await this.db.withTenant(ctx, (tx) =>
      tx.update(movies).set(dto).where(eq(movies.id, id)).returning(),
    );

    if (!movie) {
      throw new NotFoundException('Movie not found');
    }

    return movie;
  }

  /** Movies are org-wide, so only owners and general managers can (un)archive them. */
  async setArchived(
    ctx: TenantContext,
    membership: MembershipContext,
    id: string,
    archived: boolean,
  ): Promise<Movie> {
    canAccessAllLocations(
      membership,
      archived ? 'archive' : 'unarchive',
      'movie',
    );

    const [movie] = await this.db.withTenant(ctx, (tx) =>
      tx
        .update(movies)
        .set({ archivedAt: archived ? new Date() : null })
        .where(
          and(
            eq(movies.id, id),
            archived ? isNull(movies.archivedAt) : isNotNull(movies.archivedAt),
          ),
        )
        .returning(),
    );

    if (!movie) {
      throw new NotFoundException(
        archived ? 'Active movie not found' : 'Archived movie not found',
      );
    }

    return movie;
  }
}
