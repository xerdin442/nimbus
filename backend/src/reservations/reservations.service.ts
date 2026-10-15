import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Queue } from 'bullmq';
import { and, count, desc, eq, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { DbService } from '@src/db/db.service';
import { movies, organizations, reservations, showtimes } from '@src/db/schema';
import type {
  NewReservation,
  RefundReason,
  Reservation,
  SeatPrices,
} from '@src/db/schema/types';
import { CodedException } from '@src/common/errors';
import { Logger } from '@src/common/logger';
import { randomCode } from '@src/common/util';
import type {
  CheckoutView,
  InventorySeat,
  MembershipContext,
  PaginatedResult,
  PaymentSettlement,
  RefundView,
  ReservationSummary,
  ReservationView,
  TenantContext,
  TicketView,
  Transaction,
} from '@src/common/types';
import type { ReservationEvent } from '@src/common/types/events';
import type {
  ExpireReservationJob,
  RefundReservationJob,
} from '@src/common/types/job';
import { assertLocationAccess } from '@src/locations/location-access';
import { OrgSettingsService } from '@src/organizations/org-settings.service';
import { ShowtimesService } from '@src/showtimes/showtimes.service';
import { SeatInventoryService } from '@src/showtimes/seat-inventory.service';
import { TicketsService } from '@src/tickets/tickets.service';
import { PaymentsService } from '@src/payments/payments.service';
import {
  BoxOfficeSaleDto,
  CheckoutDto,
  CreateReservationDto,
  ListReservationsQueryDto,
} from './dto/reservation.dto';
import {
  EXPIRE_JOB,
  REFUND_JOB,
  RESERVATIONS_QUEUE,
  RESERVATION_CONFIRMED,
  RESERVATION_PAYMENT_CONFLICT,
  RESERVATION_REFUNDED,
} from '@src/common/types/constants';

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
    private readonly events: EventEmitter2,
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
        seatIds: dto.seatIds,
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
        null,
      );
    });

    await this.scheduleExpiry(ctx, view.id, view.expiresAt!);
    return view;
  }

  /**
   * Starts paying for a pending reservation: a Paystack transaction
   * with the org's key for the request's mode.
   */
  async checkout(
    ctx: TenantContext,
    id: string,
    dto: CheckoutDto,
  ): Promise<CheckoutView> {
    const [reservation] = await this.db.withTenant(ctx, (tx) =>
      tx.select().from(reservations).where(eq(reservations.id, id)),
    );

    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }
    if (
      reservation.status !== 'pending' ||
      reservation.expiresAt!.getTime() <= Date.now()
    ) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'reservation_not_payable',
        reservation.status === 'pending'
          ? 'The hold on these seats has expired; create a new reservation'
          : `This reservation is ${reservation.status}`,
      );
    }

    return this.payments.startCheckout(ctx, {
      reservationId: reservation.id,
      amount: reservation.total,
      currency: reservation.currency,
      email: reservation.customerEmail!,
      callbackUrl: dto.callbackUrl,
      metadata: {
        orgId: ctx.orgId,
        livemode: ctx.livemode,
        reservationId: reservation.id,
        reservationCode: reservation.code,
      },
    });
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
        seatIds: dto.seatIds,
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
      const priced = await this.setTotal(tx, reservation, seats);

      const payment = await this.payments.recordOffline(tx, ctx, {
        reservationId: priced.id,
        method: dto.method,
        amount: priced.total,
        currency: priced.currency,
      });
      const [confirmed] = await tx
        .update(reservations)
        .set({ paymentId: payment.id })
        .where(eq(reservations.id, priced.id))
        .returning();
      const tickets = await this.tickets.issue(tx, ctx, confirmed.id, claimed);

      return this.toView(confirmed, seats, tickets, null);
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
        await this.payments.refundFor(tx, row.reservation),
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
   * Expiry job: `pending` → `expired` and the hold is released. A no-op if the
   * reservation was paid or cancelled first, or (defensively) if it isn't due yet.
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

  /**
   * Full refund of a confirmed reservation: the payment is refunded;
   * Paystack for online, recorded for cash/POS, the reservation becomes
   * `refunded` (its tickets scan `void`) and its seats go back on sale.
   */
  async refund(
    ctx: TenantContext,
    id: string,
    options: {
      reason: RefundReason;
      membership?: MembershipContext;
      userId?: string;
      note?: string;
    },
  ): Promise<ReservationView> {
    const refunded = await this.db.withTenant(ctx, async (tx) => {
      const [row] = await tx
        .select({ reservation: reservations, locationId: showtimes.locationId })
        .from(reservations)
        .innerJoin(showtimes, eq(showtimes.id, reservations.showtimeId))
        .where(eq(reservations.id, id))
        .for('update', { of: reservations });

      if (!row) {
        throw new NotFoundException('Reservation not found');
      }
      if (options.membership) {
        assertLocationAccess(options.membership, row.locationId);
      }

      const { reservation } = row;
      const retry =
        reservation.status === 'refunded' &&
        (await this.payments.refundFor(tx, reservation))?.status === 'failed';

      if (
        (reservation.status !== 'confirmed' && !retry) ||
        !reservation.paymentId
      ) {
        throw new CodedException(
          HttpStatus.CONFLICT,
          'reservation_not_refundable',
          reservation.status === 'refunded'
            ? 'This reservation is already refunded'
            : `Only confirmed reservations can be refunded; this one is ${reservation.status}`,
        );
      }

      await this.payments.refund(
        ctx,
        {
          paymentId: reservation.paymentId,
          reason: options.reason,
          note: options.note,
          userId: options.userId,
        },
        tx,
      );

      if (retry) return false;

      await this.inventory.release(tx, id, { sold: true });
      await tx
        .update(reservations)
        .set({ status: 'refunded', refundedAt: new Date() })
        .where(eq(reservations.id, id));
      return true;
    });

    if (refunded) {
      await this.emit(RESERVATION_REFUNDED, ctx, id);
    }
    return this.get(ctx, id);
  }

  async refundAutomatically(
    ctx: TenantContext,
    id: string,
    reason: RefundReason,
  ): Promise<void> {
    const [reservation] = await this.db.withTenant(ctx, (tx) =>
      tx
        .select({ status: reservations.status })
        .from(reservations)
        .where(eq(reservations.id, id)),
    );
    if (reservation?.status !== 'confirmed') return;

    await this.refund(ctx, id, { reason });
  }

  /**
   * A payment succeeded (webhook or reconciliation). `pending` → `confirmed`: held seats
   * become sold and tickets are issued. A late payment (expired or cancelled) is confirmed too
   * if its seats can still be claimed and the showtime hasn't ended; otherwise, it is refunded.
   * Idempotent: a payment already applied is a no-op, so the webhook job can retry.
   */
  async settlePayment(
    ctx: TenantContext,
    reservationId: string,
    paymentId: string,
  ): Promise<void> {
    const settlement = await this.db.withTenant(
      ctx,
      async (tx): Promise<PaymentSettlement> => {
        const [reservation] = await tx
          .select()
          .from(reservations)
          .where(eq(reservations.id, reservationId))
          .for('update');

        if (!reservation || reservation.paymentId === paymentId) {
          return 'no_op';
        }
        if (
          reservation.status === 'confirmed' ||
          reservation.status === 'refunded'
        ) {
          return 'duplicate';
        }

        const showtime = await this.showtimes.loadForBooking(
          tx,
          reservation.showtimeId,
        );
        if (
          showtime.status !== 'published' ||
          showtime.endsAt.getTime() <= Date.now()
        ) {
          return 'conflict';
        }

        // A savepoint: a failed claim rolls back only itself.
        const claimed = await tx
          .transaction((sp) =>
            this.inventory.claim(sp, {
              showtimeId: reservation.showtimeId,
              seatIds: reservation.seatIds,
              reservationId: reservation.id,
              status: 'sold',
            }),
          )
          .catch((error: unknown) => {
            if (
              error instanceof CodedException &&
              error.code === 'seats_unavailable'
            ) {
              return null;
            }
            throw error;
          });

        if (!claimed) {
          return 'conflict';
        }

        await tx
          .update(reservations)
          .set({
            status: 'confirmed',
            confirmedAt: new Date(),
            paymentId: paymentId,
          })
          .where(eq(reservations.id, reservation.id));
        await this.tickets.issue(tx, ctx, reservation.id, claimed);
        return 'confirmed';
      },
    );

    switch (settlement) {
      case 'confirmed':
        await this.emit(RESERVATION_CONFIRMED, ctx, reservationId);
        break;
      case 'conflict':
      case 'duplicate': {
        const { created } = await this.payments.refund(ctx, {
          paymentId: paymentId,
          reason:
            settlement === 'conflict'
              ? 'payment_conflict'
              : 'duplicate_payment',
        });
        if (created && settlement === 'conflict') {
          await this.emit(RESERVATION_PAYMENT_CONFLICT, ctx, reservationId);
        }
        break;
      }
    }
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
        const { organizationId, createdByUserId, seatIds, paymentId, ...rest } =
          row.reservation;
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

  /**
   * A cancelled showtime sells nothing: its pending holds are cancelled, and online
   * sales are refunded automatically after Paystack confirmation. Box-office sales
   * stay confirmed, their tickets void, for staff to refund at the counter.
   */
  async closeCancelledShowtime(
    ctx: TenantContext,
    showtimeId: string,
  ): Promise<void> {
    const paid = await this.db.withTenant(ctx, async (tx) => {
      const cancelled = await tx
        .update(reservations)
        .set({ status: 'cancelled', cancelledAt: new Date() })
        .where(
          and(
            eq(reservations.showtimeId, showtimeId),
            eq(reservations.status, 'pending'),
          ),
        )
        .returning({ id: reservations.id });

      for (const { id } of cancelled) {
        await this.inventory.release(tx, id);
      }

      return tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.showtimeId, showtimeId),
            eq(reservations.status, 'confirmed'),
            eq(reservations.channel, 'api'),
          ),
        );
    });

    for (const { id } of paid) {
      const job: RefundReservationJob = {
        ...ctx,
        reservationId: id,
        reason: 'showtime_cancelled',
      };
      await this.queue.add(REFUND_JOB, job, {
        jobId: `refund-${id}`,
        attempts: 8,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: 1000,
      });
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

  private async emit(name: string, ctx: TenantContext, reservationId: string) {
    const event: ReservationEvent = { ...ctx, reservationId };
    await this.events.emitAsync(name, event);
  }

  private toView(
    reservation: Reservation,
    seats: (InventorySeat & { price: number })[],
    tickets: TicketView[],
    refund: RefundView | null,
  ): ReservationView {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { organizationId, createdByUserId, seatIds, paymentId, ...rest } =
      reservation;
    return { ...rest, seats, tickets, refund };
  }

  private priced(seats: InventorySeat[], prices: SeatPrices) {
    return seats.map((seat) => ({ ...seat, price: prices[seat.type] ?? 0 }));
  }
}
