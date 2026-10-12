import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import type { Queue } from 'bullmq';
import { and, count, desc, eq, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { DbService } from '@src/db/db.service';
import { movies, organizations, reservations, showtimes } from '@src/db/schema';
import type {
  NewReservation,
  Reservation,
  SeatPrices,
} from '@src/db/schema/types';
import { CodedException } from '@src/common/errors';
import { Logger } from '@src/common/logger';
import { randomCode } from '@src/common/util';
import type {
  ExpireReservationJob,
  InventorySeat,
  MembershipContext,
  PaginatedResult,
  ReservationSummary,
  ReservationView,
  ShowtimeCancelledEvent,
  TenantContext,
  TicketView,
  Transaction,
} from '@src/common/types';
import { assertLocationAccess } from '@src/locations/location-access';
import { OrgSettingsService } from '@src/organizations/org-settings.service';
import {
  SHOWTIME_CANCELLED,
  ShowtimesService,
} from '@src/showtimes/showtimes.service';
import { SeatInventoryService } from '@src/showtimes/seat-inventory.service';
import { TicketsService } from '@src/tickets/tickets.service';
import { PaymentsService } from '@src/payments/payments.service';
import {
  BoxOfficeSaleDto,
  CreateReservationDto,
  ListReservationsQueryDto,
} from './dto/reservation.dto';

export const RESERVATIONS_QUEUE = 'reservations';
export const EXPIRE_JOB = 'expire';

const MINUTE_MS = 60_000;
const RESERVATION_CODE_LENGTH = 8;

@Injectable()
export class ReservationsService {
  private readonly logger = Logger(ReservationsService.name);

  constructor(
    private readonly db: DbService,
    private readonly showtimes: ShowtimesService,
    private readonly inventory: SeatInventoryService,
    private readonly tickets: TicketsService,
    private readonly payments: PaymentsService,
    private readonly settings: OrgSettingsService,
    @InjectQueue(RESERVATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  /** Online booking: seats are held for `holdMinutes` (from org settings) while the customer pays. */
  async create(
    ctx: TenantContext,
    dto: CreateReservationDto,
  ): Promise<ReservationView> {
    const view = await this.db.withTenant(ctx, async (tx) => {
      const showtime = await this.showtimes.loadForBooking(tx, dto.showtimeId);
      this.showtimes.assertBookable(showtime, 'start'); // Online reservations must be made before the showtime starts

      const { holdMinutes } = await this.settings.read(tx);
      const expiresAt = new Date(Date.now() + holdMinutes * MINUTE_MS);

      const reservation = await this.insert(tx, ctx, {
        showtimeId: showtime.id,
        status: 'pending',
        channel: 'api',
        customerName: dto.customer.name,
        customerEmail: dto.customer.email,
        customerPhone: dto.customer.phone,
        externalCustomerId: dto.externalCustomerId,
        expiresAt,
      });

      const claimed = await this.inventory.claim(tx, {
        showtimeId: showtime.id,
        seatIds: dto.seatIds,
        reservationId: reservation.id,
        status: 'held',
        heldUntil: expiresAt,
      });
      const seats = this.priced(claimed, showtime.prices);

      return this.toView(
        await this.setTotal(tx, reservation, seats),
        seats,
        [],
      );
    });

    await this.scheduleExpiry(ctx, view.id, view.expiresAt!);
    return view;
  }

  /**
   * Dashboard box office: seats are paid for in cash or by POS. Reservation, sold seats, payment
   * and tickets are written in one transaction, so the customer leaves with scannable tickets.
   */
  async sell(
    ctx: TenantContext,
    membership: MembershipContext,
    userId: string,
    dto: BoxOfficeSaleDto,
  ): Promise<ReservationView> {
    return this.db.withTenant(ctx, async (tx) => {
      const showtime = await this.showtimes.loadForBooking(tx, dto.showtimeId);
      assertLocationAccess(membership, showtime.locationId);

      // Sales stay open until the showtime ends (late arrivals buy at the counter)
      this.showtimes.assertBookable(showtime, 'end');

      const reservation = await this.insert(tx, ctx, {
        showtimeId: showtime.id,
        status: 'confirmed',
        channel: 'box_office',
        customerName: dto.customer?.name,
        customerEmail: dto.customer?.email,
        customerPhone: dto.customer?.phone,
        createdByUserId: userId,
        confirmedAt: new Date(),
      });

      const claimed = await this.inventory.claim(tx, {
        showtimeId: showtime.id,
        seatIds: dto.seatIds,
        reservationId: reservation.id,
        status: 'sold',
      });
      const seats = this.priced(claimed, showtime.prices);
      const confirmed = await this.setTotal(tx, reservation, seats);

      await this.payments.recordOffline(tx, ctx, {
        reservationId: confirmed.id,
        method: dto.method,
        amount: confirmed.total,
        currency: confirmed.currency,
      });
      const tickets = await this.tickets.issue(tx, ctx, confirmed.id, claimed);

      return this.toView(confirmed, seats, tickets);
    });
  }

  async get(
    ctx: TenantContext,
    id: string,
    membership?: MembershipContext,
  ): Promise<ReservationView> {
    return this.db.withTenant(ctx, async (tx) => {
      const [row] = await tx
        .select({
          reservation: reservations,
          prices: showtimes.prices,
          locationId: showtimes.locationId,
        })
        .from(reservations)
        .innerJoin(showtimes, eq(showtimes.id, reservations.showtimeId))
        .where(eq(reservations.id, id));

      if (!row) {
        throw new NotFoundException('Reservation not found');
      }
      if (membership) {
        assertLocationAccess(membership, row.locationId);
      }

      return this.toView(
        row.reservation,
        this.priced(await this.inventory.forReservation(tx, id), row.prices),
        await this.tickets.forReservation(tx, id),
      );
    });
  }

  /** Releases hold on pending reservations, confirmed ones are refunded. */
  async cancel(ctx: TenantContext, id: string): Promise<ReservationView> {
    await this.db.withTenant(ctx, async (tx) => {
      const [reservation] = await tx
        .select({ status: reservations.status })
        .from(reservations)
        .where(eq(reservations.id, id))
        .for('update');

      if (!reservation) {
        throw new NotFoundException('Reservation not found');
      }
      if (reservation.status !== 'pending') {
        throw new CodedException(
          HttpStatus.CONFLICT,
          'reservation_not_cancellable',
          reservation.status === 'confirmed'
            ? 'Confirmed reservations are refunded, not cancelled'
            : `This reservation is already ${reservation.status}`,
        );
      }

      await this.inventory.release(tx, id);
      await tx
        .update(reservations)
        .set({ status: 'cancelled', cancelledAt: new Date() })
        .where(eq(reservations.id, id));
    });

    return this.get(ctx, id);
  }

  /**
   * Expiry job: `pending` → `expired` and the hold is released. A no-op if the reservation
   * was paid or cancelled first, or (defensively) if it isn't due yet.
   */
  async expire(ctx: TenantContext, id: string): Promise<boolean> {
    return this.db.withTenant(ctx, async (tx) => {
      const [expired] = await tx
        .update(reservations)
        .set({ status: 'expired', expiredAt: new Date() })
        .where(
          and(
            eq(reservations.id, id),
            eq(reservations.status, 'pending'),
            lte(reservations.expiresAt, sql`now()`),
          ),
        )
        .returning({ id: reservations.id });

      if (expired) {
        await this.inventory.release(tx, id);
      }
      return Boolean(expired);
    });
  }

  async list(
    ctx: TenantContext,
    membership: MembershipContext,
    query: ListReservationsQueryDto,
  ): Promise<PaginatedResult<ReservationSummary>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filters: (SQL | undefined)[] = [
      query.code ? eq(reservations.code, query.code) : undefined,
      query.email ? eq(reservations.customerEmail, query.email) : undefined,
      query.phone ? eq(reservations.customerPhone, query.phone) : undefined,
      query.showtimeId
        ? eq(reservations.showtimeId, query.showtimeId)
        : undefined,
      query.status ? eq(reservations.status, query.status) : undefined,
      membership.locationIds.length
        ? inArray(showtimes.locationId, membership.locationIds)
        : undefined,
    ];
    const where = and(...filters);

    const [rows, [{ total }]] = await this.db.withTenant(ctx, (tx) =>
      Promise.all([
        tx
          .select({
            reservation: reservations,
            showtime: {
              id: showtimes.id,
              startsAt: showtimes.startsAt,
              locationId: showtimes.locationId,
            },
            movieTitle: movies.title,
          })
          .from(reservations)
          .innerJoin(showtimes, eq(showtimes.id, reservations.showtimeId))
          .innerJoin(movies, eq(movies.id, showtimes.movieId))
          .where(where)
          .orderBy(desc(reservations.createdAt), desc(reservations.id))
          .limit(limit)
          .offset((page - 1) * limit),
        tx
          .select({ total: count() })
          .from(reservations)
          .innerJoin(showtimes, eq(showtimes.id, reservations.showtimeId))
          .where(where),
      ]),
    );

    return {
      data: rows.map((row) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { organizationId, createdByUserId, ...rest } = row.reservation;
        return { ...rest, showtime: row.showtime, movieTitle: row.movieTitle };
      }),
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

  /** A cancelled showtime sells nothing: its pending holds are cancelled. */
  @OnEvent(SHOWTIME_CANCELLED)
  async onShowtimeCancelled(event: ShowtimeCancelledEvent): Promise<void> {
    const ctx = { orgId: event.orgId, livemode: event.livemode };
    try {
      await this.db.withTenant(ctx, async (tx) => {
        const cancelled = await tx
          .update(reservations)
          .set({ status: 'cancelled', cancelledAt: new Date() })
          .where(
            and(
              eq(reservations.showtimeId, event.showtimeId),
              eq(reservations.status, 'pending'),
            ),
          )
          .returning({ id: reservations.id });

        for (const { id } of cancelled) {
          await this.inventory.release(tx, id);
        }
      });
    } catch (error) {
      // Leftover holds still lapse at their expiry; nothing can be booked on a cancelled showtime.
      this.logger.error(
        `Failed to cancel holds for showtime ${event.showtimeId}: ${String(error)}`,
      );
    }
  }

  private async insert(
    tx: Transaction,
    ctx: TenantContext,
    values: Omit<
      NewReservation,
      'organizationId' | 'livemode' | 'code' | 'total' | 'currency'
    >,
  ): Promise<Reservation> {
    const [org] = await tx
      .select({ currency: organizations.currency })
      .from(organizations)
      .where(eq(organizations.id, ctx.orgId));

    const [reservation] = await tx
      .insert(reservations)
      .values({
        organizationId: ctx.orgId,
        livemode: ctx.livemode,
        code: randomCode(RESERVATION_CODE_LENGTH),
        total: 0,
        currency: org.currency,
        ...values,
      })
      .returning();
    return reservation;
  }

  private async setTotal(
    tx: Transaction,
    reservation: Reservation,
    seats: { price: number }[],
  ): Promise<Reservation> {
    const [updated] = await tx
      .update(reservations)
      .set({ total: seats.reduce((sum, seat) => sum + seat.price, 0) })
      .where(eq(reservations.id, reservation.id))
      .returning();
    return updated;
  }

  /**
   * After commit. If this fails, the hold still lapses at `expiresAt` (seat inventory
   * claims treat lapsed holds as free); only the reservation's status would stay `pending`.
   */
  private async scheduleExpiry(
    ctx: TenantContext,
    reservationId: string,
    expiresAt: Date,
  ) {
    const job: ExpireReservationJob = {
      orgId: ctx.orgId,
      livemode: ctx.livemode,
      reservationId,
    };
    try {
      await this.queue.add(EXPIRE_JOB, job, {
        jobId: `expire-${reservationId}`,
        delay: Math.max(0, expiresAt.getTime() - Date.now()),
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: 1000,
      });
    } catch (error) {
      this.logger.error(
        `Failed to schedule expiry for reservation ${reservationId}: ${String(error)}`,
      );
    }
  }

  private toView(
    reservation: Reservation,
    seats: (InventorySeat & { price: number })[],
    tickets: TicketView[],
  ): ReservationView {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { organizationId, createdByUserId, ...rest } = reservation;
    return { ...rest, seats, tickets };
  }

  private priced(seats: InventorySeat[], prices: SeatPrices) {
    return seats.map((seat) => ({ ...seat, price: prices[seat.type] ?? 0 }));
  }
}
