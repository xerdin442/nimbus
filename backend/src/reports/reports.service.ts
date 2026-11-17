import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { DbService } from '@src/db/db.service';
import {
  locations,
  movies,
  organizations,
  refunds,
  reservations,
  screens,
  showtimes,
} from '@src/db/schema';
import { CodedException } from '@src/common/errors';
import type {
  LoadedReport,
  MembershipContext,
  PaginatedResult,
  ReportDay,
  ReportSummary,
  ReportTotals,
  ShowtimeReport,
  TenantContext,
  TopMovieReport,
} from '@src/common/types';
import { EntitlementsService } from '@src/entitlements/entitlements.service';
import { assertLocationAccess } from '@src/locations/location-access';
import { ListReportShowtimesQueryDto, ReportRangeDto } from './dto/report.dto';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const isValidDate = (value: string): boolean => {
  const match = DATE_ONLY.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const addDays = (date: string, days: number): string => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
};

const localDate = (instant: Date, timezone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(instant);

const localTime = (instant: Date, timezone: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);

const occupancy = (sold: number, capacity: number): number =>
  capacity > 0 ? Math.round((sold / capacity) * 1000) / 10 : 0;

const emptyTotals = (currency: string): ReportTotals => ({
  reservations: 0,
  ticketsSold: 0,
  revenue: 0,
  refunds: 0,
  netRevenue: 0,
  seatsSold: 0,
  capacity: 0,
  occupancyPct: 0,
  currency,
});

@Injectable()
export class ReportsService {
  constructor(
    private readonly db: DbService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async summary(
    ctx: TenantContext,
    membership: MembershipContext,
    query: ReportRangeDto,
  ): Promise<ReportSummary> {
    const report = await this.load(ctx, membership, query);
    return {
      location: report.location,
      range: report.range,
      totals: report.totals,
      byDay: report.byDay,
      topMovies: report.topMovies,
    };
  }

  async showtimes(
    ctx: TenantContext,
    membership: MembershipContext,
    query: ListReportShowtimesQueryDto,
  ): Promise<PaginatedResult<ShowtimeReport>> {
    const report = await this.load(ctx, membership, query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const total = report.rows.length;

    return {
      data: report.rows.slice((page - 1) * limit, page * limit),
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

  async exportCsv(
    ctx: TenantContext,
    membership: MembershipContext,
    query: ReportRangeDto,
  ): Promise<{ filename: string; csv: string }> {
    const report = await this.load(ctx, membership, query);
    const { timezone } = report.location;
    const money = (minor: number) => (minor / 100).toFixed(2);
    const cell = (value: string | number) => {
      const text = String(value);
      const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };

    const lines: string[] = [
      [
        'Date',
        'Start time',
        'Movie',
        'Screen',
        'Capacity',
        'Seats sold',
        'Occupancy %',
        'Reservations',
        'Tickets sold',
        'Revenue',
        'Refunds',
        'Net revenue',
        'Currency',
      ]
        .map(cell)
        .join(','),
    ];

    for (const row of report.rows) {
      lines.push(
        [
          cell(localDate(row.startsAt, timezone)),
          cell(localTime(row.startsAt, timezone)),
          cell(row.movieTitle),
          cell(row.screenName),
          cell(row.capacity),
          cell(row.seatsSold),
          cell(row.occupancyPct),
          cell(row.reservations),
          cell(row.ticketsSold),
          cell(money(row.revenue)),
          cell(money(row.refunds)),
          cell(money(row.netRevenue)),
          cell(report.totals.currency),
        ].join(','),
      );
    }

    const totals = report.totals;
    lines.push(
      [
        cell('Total'),
        cell(''),
        cell(''),
        cell(''),
        cell(totals.capacity),
        cell(totals.seatsSold),
        cell(totals.occupancyPct),
        cell(totals.reservations),
        cell(totals.ticketsSold),
        cell(money(totals.revenue)),
        cell(money(totals.refunds)),
        cell(money(totals.netRevenue)),
        cell(totals.currency),
      ].join(','),
    );

    const slug = report.location.name
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
    return {
      filename: `report-${slug || 'location'}-${report.range.startDate}-${report.range.endDate}.csv`,
      csv: lines.join('\n'),
    };
  }

  private async load(
    ctx: TenantContext,
    membership: MembershipContext,
    query: ReportRangeDto,
  ): Promise<LoadedReport> {
    if (!ctx.livemode) {
      throw new CodedException(
        HttpStatus.FORBIDDEN,
        'reports_live_only',
        'Reports are available in live mode only',
      );
    }
    this.assertRange(query);
    assertLocationAccess(membership, query.locationId);

    return this.db.withTenant(ctx, async (tx) => {
      const [location] = await tx
        .select({
          id: locations.id,
          name: locations.name,
          timezone: locations.timezone,
        })
        .from(locations)
        .where(eq(locations.id, query.locationId));
      if (!location) {
        throw new NotFoundException('Location not found');
      }

      await this.assertHistory(ctx.orgId, location.timezone, query);

      const [org] = await tx
        .select({ currency: organizations.currency })
        .from(organizations)
        .where(eq(organizations.id, ctx.orgId));
      const currency = org?.currency ?? 'NGN';

      const rangeStart = sql`(${query.startDate}::date::timestamp AT TIME ZONE ${location.timezone})`;
      const rangeEnd = sql`((${query.endDate}::date + 1)::timestamp AT TIME ZONE ${location.timezone})`;

      const showtimeRows = await tx
        .select({
          id: showtimes.id,
          startsAt: showtimes.startsAt,
          movieId: showtimes.movieId,
          movieTitle: movies.title,
          screenName: screens.name,
          capacity: sql<number>`(select count(*) from showtime_seats ss where ss.showtime_id = ${showtimes.id})::int`,
          seatsSold: sql<number>`(select count(*) from showtime_seats ss where ss.showtime_id = ${showtimes.id} and ss.status = 'sold')::int`,
        })
        .from(showtimes)
        .innerJoin(movies, eq(movies.id, showtimes.movieId))
        .innerJoin(screens, eq(screens.id, showtimes.screenId))
        .where(
          and(
            eq(showtimes.locationId, location.id),
            gte(showtimes.startsAt, rangeStart),
            lt(showtimes.startsAt, rangeEnd),
            inArray(showtimes.status, ['published', 'cancelled']),
          ),
        )
        .orderBy(asc(showtimes.startsAt));

      const ids = showtimeRows.map((row) => row.id);
      const [salesRows, refundRows] = ids.length
        ? await Promise.all([
            tx
              .select({
                showtimeId: reservations.showtimeId,
                reservations: sql<number>`count(*)::int`,
                tickets: sql<number>`coalesce(sum(cardinality(${reservations.seatIds})), 0)::int`,
                revenue: sql<number>`coalesce(sum(${reservations.total}), 0)::int`,
              })
              .from(reservations)
              .where(
                and(
                  eq(reservations.status, 'confirmed'),
                  inArray(reservations.showtimeId, ids),
                ),
              )
              .groupBy(reservations.showtimeId),
            tx
              .select({
                showtimeId: reservations.showtimeId,
                refunded: sql<number>`coalesce(sum(${refunds.amount}), 0)::int`,
              })
              .from(refunds)
              .innerJoin(
                reservations,
                eq(reservations.id, refunds.reservationId),
              )
              .where(
                and(
                  inArray(reservations.showtimeId, ids),
                  ne(refunds.status, 'failed'),
                ),
              )
              .groupBy(reservations.showtimeId),
          ])
        : [[], []];

      const sales = new Map(salesRows.map((row) => [row.showtimeId, row]));
      const refundedByShowtime = new Map(
        refundRows.map((row) => [row.showtimeId, row.refunded]),
      );

      const rows: ShowtimeReport[] = showtimeRows.map((row) => {
        const sale = sales.get(row.id);
        const revenue = sale?.revenue ?? 0;
        const refunded = refundedByShowtime.get(row.id) ?? 0;
        return {
          showtimeId: row.id,
          startsAt: row.startsAt,
          movieId: row.movieId,
          movieTitle: row.movieTitle,
          screenName: row.screenName,
          capacity: row.capacity,
          seatsSold: row.seatsSold,
          occupancyPct: occupancy(row.seatsSold, row.capacity),
          reservations: sale?.reservations ?? 0,
          ticketsSold: sale?.tickets ?? 0,
          revenue,
          refunds: refunded,
          netRevenue: revenue - refunded,
        };
      });

      return {
        location,
        range: { startDate: query.startDate, endDate: query.endDate },
        rows,
        ...this.aggregate(rows, currency, location.timezone),
      };
    });
  }

  private aggregate(
    rows: ShowtimeReport[],
    currency: string,
    timezone: string,
  ): Pick<LoadedReport, 'totals' | 'byDay' | 'topMovies'> {
    const totals = emptyTotals(currency);
    const days = new Map<string, ReportDay>();
    const moviesById = new Map<string, TopMovieReport>();

    for (const row of rows) {
      totals.reservations += row.reservations;
      totals.ticketsSold += row.ticketsSold;
      totals.revenue += row.revenue;
      totals.refunds += row.refunds;
      totals.netRevenue += row.netRevenue;
      totals.seatsSold += row.seatsSold;
      totals.capacity += row.capacity;

      const date = localDate(row.startsAt, timezone);
      const day = days.get(date) ?? {
        date,
        reservations: 0,
        ticketsSold: 0,
        revenue: 0,
        refunds: 0,
        netRevenue: 0,
      };
      day.reservations += row.reservations;
      day.ticketsSold += row.ticketsSold;
      day.revenue += row.revenue;
      day.refunds += row.refunds;
      day.netRevenue += row.netRevenue;
      days.set(date, day);

      const movie = moviesById.get(row.movieId) ?? {
        movieId: row.movieId,
        title: row.movieTitle,
        ticketsSold: 0,
        revenue: 0,
      };
      movie.ticketsSold += row.ticketsSold;
      movie.revenue += row.revenue;
      moviesById.set(row.movieId, movie);
    }

    totals.occupancyPct = occupancy(totals.seatsSold, totals.capacity);

    return {
      totals,
      byDay: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
      topMovies: [...moviesById.values()]
        .sort((a, b) => b.revenue - a.revenue || b.ticketsSold - a.ticketsSold)
        .slice(0, 10),
    };
  }

  private assertRange(query: ReportRangeDto): void {
    if (
      !isValidDate(query.startDate) ||
      !isValidDate(query.endDate) ||
      query.startDate > query.endDate
    ) {
      throw new CodedException(
        HttpStatus.BAD_REQUEST,
        'invalid_date_range',
        'Use valid YYYY-MM-DD dates with startDate on or before endDate',
      );
    }
  }

  private async assertHistory(
    orgId: string,
    timezone: string,
    query: ReportRangeDto,
  ): Promise<void> {
    const days = await this.entitlements.get(orgId, 'reports.history_days');
    const earliest = addDays(localDate(new Date(), timezone), -days);
    if (query.startDate < earliest) {
      throw new CodedException(
        HttpStatus.FORBIDDEN,
        'report_history_limited',
        `Your plan keeps ${days} days of report history`,
        { days, earliest },
      );
    }
  }
}
