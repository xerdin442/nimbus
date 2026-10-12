import { HttpStatus, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { seats, showtimeSeats } from '@src/db/schema';
import { CodedException } from '@src/common/errors';
import type { InventorySeat, Transaction } from '@src/common/types';

/** Free, or held by a hold that has lapsed (its expiry job may not have run yet). */
export const isClaimable = sql`(${showtimeSeats.status} = 'available' or (${showtimeSeats.status} = 'held' and ${showtimeSeats.heldUntil} < now()))`;

export const inventorySeatColumns = {
  id: showtimeSeats.id,
  gridRow: seats.gridRow,
  gridColumn: seats.gridColumn,
  rowLabel: seats.rowLabel,
  number: seats.number,
  type: seats.type,
};

interface ClaimOptions {
  showtimeId: string;
  seatIds: string[];
  reservationId: string;
  /** `held` until `heldUntil` for online checkout; `sold` straight away at the box office. */
  status: 'held' | 'sold';
  heldUntil?: Date;
}

/**
 * The only writer of `showtime_seats` after publish. Every method runs inside the caller's tenant
 * transaction, so RLS scopes it to the request's mode: a test hold never touches live inventory.
 */
@Injectable()
export class SeatInventoryService {
  /**
   * Claims every seat or none. One conditional UPDATE: Postgres locks each row, and a concurrent
   * claim re-checks the condition after the first commits, so two requests can't take one seat.
   * Throws 409 seats_unavailable (rolling back the caller's transaction) if any seat isn't free.
   */
  async claim(
    tx: Transaction,
    options: ClaimOptions,
  ): Promise<InventorySeat[]> {
    const claimed = await tx
      .update(showtimeSeats)
      .set({
        status: options.status,
        reservationId: options.reservationId,
        heldUntil: options.heldUntil ?? null,
      })
      .where(
        and(
          eq(showtimeSeats.showtimeId, options.showtimeId),
          inArray(showtimeSeats.id, options.seatIds),
          isClaimable,
        ),
      )
      .returning({ id: showtimeSeats.id });

    if (claimed.length !== options.seatIds.length) {
      const taken = new Set(claimed.map((seat) => seat.id));
      throw new CodedException(
        HttpStatus.CONFLICT,
        'seats_unavailable',
        'One or more seats are no longer available',
        { seatIds: options.seatIds.filter((id) => !taken.has(id)) },
      );
    }

    return this.describe(tx, options.seatIds);
  }

  /** Frees a reservation's held seats. Sold seats stay sold. */
  async release(tx: Transaction, reservationId: string): Promise<void> {
    await tx
      .update(showtimeSeats)
      .set({ status: 'available', reservationId: null, heldUntil: null })
      .where(
        and(
          eq(showtimeSeats.reservationId, reservationId),
          eq(showtimeSeats.status, 'held'),
        ),
      );
  }

  /** Labels for showtime seats, ordered as they appear in the auditorium. */
  async describe(
    tx: Transaction,
    showtimeSeatIds: string[],
  ): Promise<InventorySeat[]> {
    if (!showtimeSeatIds.length) return [];

    return tx
      .select(inventorySeatColumns)
      .from(showtimeSeats)
      .innerJoin(seats, eq(seats.id, showtimeSeats.seatId))
      .where(inArray(showtimeSeats.id, showtimeSeatIds))
      .orderBy(asc(seats.gridRow), asc(seats.gridColumn));
  }

  /** The seats a reservation holds or bought. */
  async forReservation(
    tx: Transaction,
    reservationId: string,
  ): Promise<InventorySeat[]> {
    return tx
      .select(inventorySeatColumns)
      .from(showtimeSeats)
      .innerJoin(seats, eq(seats.id, showtimeSeats.seatId))
      .where(eq(showtimeSeats.reservationId, reservationId))
      .orderBy(asc(seats.gridRow), asc(seats.gridColumn));
  }
}
