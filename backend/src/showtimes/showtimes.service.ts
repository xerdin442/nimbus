import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  and,
  asc,
  count,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  sql,
  type SQL,
} from 'drizzle-orm';
import { DbService } from '@src/db/db.service';
import {
  locations,
  movies,
  organizations,
  reservations,
  screens,
  seatLayouts,
  seats,
  showtimes,
  showtimeSeats,
} from '@src/db/schema';
import type { NewShowtime, SeatPrices, Showtime } from '@src/db/schema/types';
import {
  CodedException,
  isPgError,
  PG_EXCLUSION_VIOLATION,
} from '@src/common/errors';
import type {
  MembershipContext,
  OrgSettingsView,
  SeatCounts,
  SeatMapView,
  ShowtimeCancelledEvent,
  ShowtimeView,
  TenantContext,
  Transaction,
} from '@src/common/types';
import { assertLocationAccess } from '@src/locations/location-access';
import { OrgSettingsService } from '@src/organizations/org-settings.service';
import { inventorySeatColumns, isClaimable } from './seat-inventory.service';
import {
  CreateShowtimeDto,
  ListShowtimesQueryDto,
  SeatPricesDto,
  UpdateShowtimeDto,
} from './dto/showtime.dto';

export const SHOWTIME_CANCELLED = 'showtime.cancelled';

const MINUTE_MS = 60_000;

const showtimeColumns = {
  id: showtimes.id,
  livemode: showtimes.livemode,
  locationId: showtimes.locationId,
  screenId: showtimes.screenId,
  movieId: showtimes.movieId,
  layoutId: showtimes.layoutId,
  startsAt: showtimes.startsAt,
  endsAt: showtimes.endsAt,
  cleanupEndsAt: showtimes.cleanupEndsAt,
  status: showtimes.status,
  prices: showtimes.prices,
  publishedAt: showtimes.publishedAt,
  cancelledAt: showtimes.cancelledAt,
  createdAt: showtimes.createdAt,
  updatedAt: showtimes.updatedAt,
};

/** Showtimes starting on a calendar day in `timezone`: `date` (YYYY-MM-DD), or the present day. */
const startsOnLocalDay = (timezone: string, date?: string): SQL => {
  const day = date
    ? sql`${date}::date`
    : sql`(now() at time zone ${timezone})::date`;

  return and(
    gte(showtimes.startsAt, sql`(${day})::timestamp at time zone ${timezone}`),
    lt(
      showtimes.startsAt,
      sql`((${day}) + 1)::timestamp at time zone ${timezone}`,
    ),
  )!;
};

const assertFutureDate = (startsAt: Date) => {
  if (startsAt.getTime() <= Date.now()) {
    throw new CodedException(
      HttpStatus.BAD_REQUEST,
      'showtime_in_past',
      'A showtime must start in the future',
    );
  }
};

/** An insert or update that hits the exclusion constraint → 409 showtime_overlap. */
const toOverlapError = (error: unknown): unknown =>
  isPgError(error, PG_EXCLUSION_VIOLATION)
    ? new CodedException(
        HttpStatus.CONFLICT,
        'showtime_overlap',
        'This screen already has a showtime at that time (cleanup included)',
      )
    : error;

@Injectable()
export class ShowtimesService {
  constructor(
    private readonly db: DbService,
    private readonly settings: OrgSettingsService,
    private readonly events: EventEmitter2,
  ) {}

  // ── Dashboard ───────────────────────────────────────────────────────────────────────────────

  async create(
    ctx: TenantContext,
    membership: MembershipContext,
    dto: CreateShowtimeDto,
  ): Promise<Showtime> {
    assertFutureDate(dto.startsAt);

    try {
      return await this.db.withTenant(ctx, async (tx) => {
        const screen = await this.loadScreen(tx, membership, dto.screenId);
        const [layout] = await tx
          .select({ id: seatLayouts.id })
          .from(seatLayouts)
          .where(
            and(
              eq(seatLayouts.screenId, screen.id),
              eq(seatLayouts.isCurrent, true),
            ),
          );

        if (!layout) {
          throw new CodedException(
            HttpStatus.CONFLICT,
            'layout_required',
            'Save a seat layout for this screen before scheduling showtimes',
          );
        }

        const movie = await this.loadMovie(tx, dto.movieId);
        const prices = await this.pricesForLayout(tx, layout.id, dto.prices);
        const times = this.schedule(
          dto.startsAt,
          movie.runtimeMinutes,
          await this.settings.read(tx),
        );

        const [showtime] = await tx
          .insert(showtimes)
          .values({
            organizationId: ctx.orgId,
            livemode: ctx.livemode,
            locationId: screen.locationId,
            screenId: screen.id,
            movieId: movie.id,
            layoutId: layout.id,
            prices,
            ...times,
          })
          .returning();

        return showtime;
      });
    } catch (error) {
      throw toOverlapError(error);
    }
  }

  /** Drafts only. Moving the start keeps the length the showtime was scheduled with. */
  async update(
    ctx: TenantContext,
    membership: MembershipContext,
    id: string,
    dto: UpdateShowtimeDto,
  ): Promise<Showtime> {
    try {
      return await this.db.withTenant(ctx, async (tx) => {
        const showtime = await this.lock(tx, membership, id);
        this.assertStatus(showtime, 'draft');

        const changes: Partial<NewShowtime> = {};

        if (dto.startsAt) {
          assertFutureDate(dto.startsAt);
          const shift = dto.startsAt.getTime() - showtime.startsAt.getTime();
          changes.startsAt = dto.startsAt;
          changes.endsAt = new Date(showtime.endsAt.getTime() + shift);
          changes.cleanupEndsAt = new Date(
            showtime.cleanupEndsAt.getTime() + shift,
          );
        }
        if (dto.prices) {
          changes.prices = await this.pricesForLayout(
            tx,
            showtime.layoutId,
            dto.prices,
          );
        }
        if (!Object.keys(changes).length) {
          return showtime;
        }

        const [updated] = await tx
          .update(showtimes)
          .set(changes)
          .where(eq(showtimes.id, id))
          .returning();
        return updated;
      });
    } catch (error) {
      throw toOverlapError(error);
    }
  }

  /** A location's showtimes on one local day, any status. */
  async list(
    ctx: TenantContext,
    membership: MembershipContext,
    query: ListShowtimesQueryDto,
  ): Promise<ShowtimeView[]> {
    assertLocationAccess(membership, query.locationId);

    return this.db.withTenant(ctx, async (tx) => {
      const timezone = await this.locationTimezone(tx, query.locationId);
      return this.views(
        tx,
        ctx,
        and(
          eq(showtimes.locationId, query.locationId),
          startsOnLocalDay(timezone, query.date),
        )!,
      );
    });
  }

  async get(
    ctx: TenantContext,
    membership: MembershipContext,
    id: string,
  ): Promise<ShowtimeView> {
    const [showtime] = await this.db.withTenant(ctx, (tx) =>
      this.views(tx, ctx, eq(showtimes.id, id)),
    );

    if (!showtime) {
      throw new NotFoundException('Showtime not found');
    }

    assertLocationAccess(membership, showtime.locationId);
    return showtime;
  }

  /** `draft` → `published`: Takes a snapshot of the layout's seats into seat inventory. */
  async publish(
    ctx: TenantContext,
    membership: MembershipContext,
    id: string,
  ): Promise<Showtime> {
    return this.db.withTenant(ctx, async (tx) => {
      const showtime = await this.lock(tx, membership, id);
      this.assertStatus(showtime, 'draft');
      assertFutureDate(showtime.startsAt);

      const layoutSeats = await tx
        .select({ id: seats.id })
        .from(seats)
        .where(eq(seats.layoutId, showtime.layoutId));

      await tx.insert(showtimeSeats).values(
        layoutSeats.map((seat) => ({
          organizationId: ctx.orgId,
          livemode: ctx.livemode,
          showtimeId: id,
          seatId: seat.id,
        })),
      );

      const [published] = await tx
        .update(showtimes)
        .set({ status: 'published', publishedAt: new Date() })
        .where(eq(showtimes.id, id))
        .returning();
      return published;
    });
  }

  /** `published` → `draft`, only while nobody has reserved a seat. */
  async unpublish(
    ctx: TenantContext,
    membership: MembershipContext,
    id: string,
  ): Promise<Showtime> {
    return this.db.withTenant(ctx, async (tx) => {
      const showtime = await this.lock(tx, membership, id);
      this.assertStatus(showtime, 'published');

      const [{ reserved }] = await tx
        .select({ reserved: count() })
        .from(reservations)
        .where(eq(reservations.showtimeId, id));

      if (reserved) {
        throw new CodedException(
          HttpStatus.CONFLICT,
          'showtime_has_reservations',
          'Showtimes with reservations can be cancelled, not unpublished',
        );
      }

      await tx.delete(showtimeSeats).where(eq(showtimeSeats.showtimeId, id));

      const [draft] = await tx
        .update(showtimes)
        .set({ status: 'draft', publishedAt: null })
        .where(eq(showtimes.id, id))
        .returning();
      return draft;
    });
  }

  /**
   * Stops all sales and frees the screen's time slot.
   * Reservations react to the event: pending holds are cancelled; confirmed ones are refunded.
   */
  async cancel(
    ctx: TenantContext,
    membership: MembershipContext,
    id: string,
  ): Promise<Showtime> {
    const cancelled = await this.db.withTenant(ctx, async (tx) => {
      const showtime = await this.lock(tx, membership, id);
      if (showtime.status === 'cancelled') {
        throw new CodedException(
          HttpStatus.CONFLICT,
          'showtime_cancelled',
          'This showtime is already cancelled',
        );
      }

      const [updated] = await tx
        .update(showtimes)
        .set({ status: 'cancelled', cancelledAt: new Date() })
        .where(eq(showtimes.id, id))
        .returning();
      return updated;
    });

    const event: ShowtimeCancelledEvent = { ...ctx, showtimeId: id };
    await this.events.emitAsync(SHOWTIME_CANCELLED, event);

    return cancelled;
  }

  // ── Public API (and the box office's seat picker) ───────────────────────────────────────────

  /** Published showtimes at an active location on one local day. */
  async listPublished(
    ctx: TenantContext,
    locationId: string,
    date?: string,
  ): Promise<ShowtimeView[]> {
    return this.db.withTenant(ctx, async (tx) => {
      const timezone = await this.locationTimezone(tx, locationId, true);
      return this.views(
        tx,
        ctx,
        and(
          eq(showtimes.locationId, locationId),
          eq(showtimes.status, 'published'),
          startsOnLocalDay(timezone, date),
        )!,
      );
    });
  }

  /** A location's "Now Showing" list: movies with upcoming published showtimes. */
  async listLocationMovies(ctx: TenantContext, locationId: string) {
    return this.db.withTenant(ctx, async (tx) => {
      await this.locationTimezone(tx, locationId, true);

      return tx
        .selectDistinct({
          id: movies.id,
          title: movies.title,
          synopsis: movies.synopsis,
          runtimeMinutes: movies.runtimeMinutes,
          rating: movies.rating,
          language: movies.language,
          genres: movies.genres,
          posterUrl: movies.posterUrl,
          trailerUrl: movies.trailerUrl,
        })
        .from(movies)
        .innerJoin(showtimes, eq(showtimes.movieId, movies.id))
        .where(
          and(
            eq(showtimes.locationId, locationId),
            eq(showtimes.status, 'published'),
            gt(showtimes.startsAt, sql`now()`),
          ),
        )
        .orderBy(asc(movies.title));
    });
  }

  async getPublished(ctx: TenantContext, id: string): Promise<ShowtimeView> {
    const [showtime] = await this.db.withTenant(ctx, (tx) =>
      this.views(
        tx,
        ctx,
        and(eq(showtimes.id, id), eq(showtimes.status, 'published'))!,
      ),
    );

    if (!showtime) {
      throw new NotFoundException('Showtime not found');
    }

    return showtime;
  }

  /**
   * Seat map with availability in the request's mode. Seat ids are showtime seat ids: what a
   * reservation or box-office sale sends back. `membership` scopes dashboard callers.
   */
  async seatMap(
    ctx: TenantContext,
    id: string,
    membership?: MembershipContext,
  ): Promise<SeatMapView> {
    return this.db.withTenant(ctx, async (tx) => {
      const [showtime] = await tx
        .select({
          locationId: showtimes.locationId,
          prices: showtimes.prices,
          rows: seatLayouts.rows,
          columns: seatLayouts.columns,
        })
        .from(showtimes)
        .innerJoin(seatLayouts, eq(seatLayouts.id, showtimes.layoutId))
        .where(and(eq(showtimes.id, id), eq(showtimes.status, 'published')));

      if (!showtime) {
        throw new NotFoundException('Showtime not found');
      }
      if (membership) {
        assertLocationAccess(membership, showtime.locationId);
      }

      const inventory = await tx
        .select({
          ...inventorySeatColumns,
          available: sql<boolean>`${isClaimable}`,
        })
        .from(showtimeSeats)
        .innerJoin(seats, eq(seats.id, showtimeSeats.seatId))
        .where(eq(showtimeSeats.showtimeId, id))
        .orderBy(asc(seats.gridRow), asc(seats.gridColumn));

      return {
        showtimeId: id,
        rows: showtime.rows,
        columns: showtime.columns,
        currency: await this.currency(tx, ctx),
        seats: inventory.map((seat) => ({
          ...seat,
          price: showtime.prices[seat.type] ?? 0,
        })),
      };
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────────────────────

  /** Reject bookings unless tickets for this showtime can still be sold. */
  assertBookable(
    showtime: Pick<Showtime, 'status' | 'startsAt' | 'endsAt'>,
    until: 'start' | 'end',
  ) {
    const cutoff = until === 'start' ? showtime.startsAt : showtime.endsAt;
    if (showtime.status !== 'published' || cutoff.getTime() <= Date.now()) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'showtime_not_bookable',
        showtime.status === 'published'
          ? 'Ticket sales for this showtime has closed'
          : `This showtime is ${showtime.status}`,
      );
    }
  }

  /** Locks the showtime row for a sale, so cancelling it waits for in-flight sales. */
  async loadForBooking(tx: Transaction, id: string): Promise<Showtime> {
    const [showtime] = await tx
      .select()
      .from(showtimes)
      .where(eq(showtimes.id, id))
      .for('share');

    if (!showtime) {
      throw new NotFoundException('Showtime not found');
    }

    return showtime;
  }

  private schedule(
    startsAt: Date,
    runtimeMinutes: number,
    settings: OrgSettingsView,
  ) {
    const endsAt = new Date(
      startsAt.getTime() + (settings.adsMinutes + runtimeMinutes) * MINUTE_MS,
    );
    const cleanupEndsAt = new Date(
      endsAt.getTime() + settings.cleanupMinutes * MINUTE_MS,
    );
    return { startsAt, endsAt, cleanupEndsAt };
  }

  /** Keeps prices for the seat types the layout uses; every one of them needs a price. */
  private async pricesForLayout(
    tx: Transaction,
    layoutId: string,
    given: SeatPricesDto,
  ): Promise<SeatPrices> {
    const types = (
      await tx
        .selectDistinct({ type: seats.type })
        .from(seats)
        .where(eq(seats.layoutId, layoutId))
    ).map((row) => row.type);

    const missing = types.filter((type) => given[type] === undefined);
    if (missing.length) {
      throw new CodedException(
        HttpStatus.BAD_REQUEST,
        'missing_prices',
        `Set a price for every seat type in the layout: ${missing.join(', ')}`,
        { seatTypes: missing },
      );
    }

    return Object.fromEntries(types.map((type) => [type, given[type]]));
  }

  private async loadScreen(
    tx: Transaction,
    membership: MembershipContext,
    screenId: string,
  ) {
    const [screen] = await tx
      .select({
        id: screens.id,
        locationId: screens.locationId,
        archivedAt: screens.archivedAt,
        locationArchivedAt: locations.archivedAt,
      })
      .from(screens)
      .innerJoin(locations, eq(locations.id, screens.locationId))
      .where(eq(screens.id, screenId));

    if (!screen) {
      throw new NotFoundException('Screen not found');
    }

    assertLocationAccess(membership, screen.locationId);

    if (screen.archivedAt || screen.locationArchivedAt) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'screen_archived',
        'Unarchive the screen or its location before scheduling showtimes',
      );
    }

    return screen;
  }

  private async loadMovie(tx: Transaction, movieId: string) {
    const [movie] = await tx
      .select({
        id: movies.id,
        runtimeMinutes: movies.runtimeMinutes,
        archivedAt: movies.archivedAt,
      })
      .from(movies)
      .where(eq(movies.id, movieId));

    if (!movie) {
      throw new NotFoundException('Movie not found');
    }
    if (movie.archivedAt) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'movie_archived',
        'Unarchive the movie before scheduling it',
      );
    }

    return movie;
  }

  /** Locks the showtime row so status changes on it run one at a time. */
  private async lock(
    tx: Transaction,
    membership: MembershipContext,
    id: string,
  ): Promise<Showtime> {
    const [showtime] = await tx
      .select()
      .from(showtimes)
      .where(eq(showtimes.id, id))
      .for('update');

    if (!showtime) {
      throw new NotFoundException('Showtime not found');
    }

    assertLocationAccess(membership, showtime.locationId);
    return showtime;
  }

  private assertStatus(showtime: Showtime, status: 'draft' | 'published') {
    if (showtime.status !== status) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        `showtime_not_${status}`,
        `This showtime must be ${status} to perform this action; it is currently "${showtime.status}"`,
      );
    }
  }

  private async locationTimezone(
    tx: Transaction,
    locationId: string,
    activeOnly = false,
  ): Promise<string> {
    const [location] = await tx
      .select({ timezone: locations.timezone })
      .from(locations)
      .where(
        and(
          eq(locations.id, locationId),
          activeOnly ? isNull(locations.archivedAt) : undefined,
        ),
      );

    if (!location) {
      throw new NotFoundException('Location not found');
    }

    return location.timezone;
  }

  private async currency(tx: Transaction, ctx: TenantContext) {
    const [org] = await tx
      .select({ currency: organizations.currency })
      .from(organizations)
      .where(eq(organizations.id, ctx.orgId));
    return org.currency;
  }

  private async views(
    tx: Transaction,
    ctx: TenantContext,
    where: SQL,
  ): Promise<ShowtimeView[]> {
    const rows = await tx
      .select({
        ...showtimeColumns,
        movie: {
          id: movies.id,
          title: movies.title,
          runtimeMinutes: movies.runtimeMinutes,
          rating: movies.rating,
          posterUrl: movies.posterUrl,
        },
        screen: { id: screens.id, name: screens.name, format: screens.format },
      })
      .from(showtimes)
      .innerJoin(movies, eq(movies.id, showtimes.movieId))
      .innerJoin(screens, eq(screens.id, showtimes.screenId))
      .where(where)
      .orderBy(asc(showtimes.startsAt));

    if (!rows.length) return [];

    const counts = await tx
      .select({
        showtimeId: showtimeSeats.showtimeId,
        available: sql<number>`count(*) filter (where ${isClaimable})`.mapWith(
          Number,
        ),
        sold: sql<number>`count(*) filter (where ${showtimeSeats.status} = 'sold')`.mapWith(
          Number,
        ),
        total: count(),
      })
      .from(showtimeSeats)
      .where(
        inArray(
          showtimeSeats.showtimeId,
          rows.map((row) => row.id),
        ),
      )
      .groupBy(showtimeSeats.showtimeId);

    const byShowtime = new Map(counts.map((c) => [c.showtimeId, c]));
    const currency = await this.currency(tx, ctx);

    return rows.map((row) => {
      const c = byShowtime.get(row.id);
      const seatCounts: SeatCounts = c
        ? {
            available: c.available,
            held: c.total - c.available - c.sold,
            sold: c.sold,
          }
        : { available: 0, held: 0, sold: 0 };
      return { ...row, currency, seats: seatCounts };
    });
  }
}
