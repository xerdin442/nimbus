import {
  BadRequestException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, asc, eq, isNull, type SQL } from 'drizzle-orm';
import * as QRCode from 'qrcode';
import { DbService } from '@src/db/db.service';
import {
  locations,
  movies,
  reservations,
  screens,
  seats,
  showtimes,
  showtimeSeats,
  tickets,
} from '@src/db/schema';
import type { Ticket } from '@src/db/schema/types';
import type {
  InventorySeat,
  MembershipContext,
  ScannedTicket,
  ScanOutcome,
  TenantContext,
  TicketView,
  Transaction,
} from '@src/common/types';
import { randomCode } from '@src/common/util';
import { Logger } from '@src/common/logger';
import { assertLocationAccess } from '@src/locations/location-access';
import { TICKET_CHECKED_IN } from '@src/common/types/constants';
import type { TicketCheckedInEvent } from '@src/common/types/events';
import { signTicketToken, verifyTicketToken } from './ticket-token';
import { scanTiming } from './scan-window';
import { ScanTicketDto } from './dto/scan.dto';

const TICKET_CODE_LENGTH = 10;

@Injectable()
export class TicketsService {
  private readonly logger = Logger(TicketsService.name);

  constructor(
    private readonly db: DbService,
    private readonly events: EventEmitter2,
  ) {}

  /** Inside the transaction that confirms reservations: one ticket per seat. */
  async issue(
    tx: Transaction,
    ctx: TenantContext,
    reservationId: string,
    seatsSold: InventorySeat[],
  ): Promise<TicketView[]> {
    const issued = await tx
      .insert(tickets)
      .values(
        seatsSold.map((seat) => ({
          organizationId: ctx.orgId,
          livemode: ctx.livemode,
          reservationId,
          showtimeSeatId: seat.id,
          code: randomCode(TICKET_CODE_LENGTH),
        })),
      )
      .returning();

    const seatById = new Map(seatsSold.map((seat) => [seat.id, seat]));
    return issued.map((ticket) =>
      this.toView(ticket, seatById.get(ticket.showtimeSeatId)!),
    );
  }

  async forReservation(
    tx: Transaction,
    reservationId: string,
  ): Promise<TicketView[]> {
    const rows = await tx
      .select({ ticket: tickets, seat: seats })
      .from(tickets)
      .innerJoin(showtimeSeats, eq(showtimeSeats.id, tickets.showtimeSeatId))
      .innerJoin(seats, eq(seats.id, showtimeSeats.seatId))
      .where(eq(tickets.reservationId, reservationId))
      .orderBy(asc(seats.gridRow), asc(seats.gridColumn));

    return rows.map((row) => this.toView(row.ticket, row.seat));
  }

  async qrPng(
    ctx: TenantContext,
    ticketId: string,
    membership?: MembershipContext,
  ): Promise<StreamableFile> {
    const [ticket] = await this.db.withTenant(ctx, (tx) =>
      tx
        .select({ id: tickets.id, locationId: showtimes.locationId })
        .from(tickets)
        .innerJoin(reservations, eq(reservations.id, tickets.reservationId))
        .innerJoin(showtimes, eq(showtimes.id, reservations.showtimeId))
        .where(eq(tickets.id, ticketId)),
    );

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    if (membership) {
      assertLocationAccess(membership, ticket.locationId);
    }

    const png = await QRCode.toBuffer(
      signTicketToken(ticket.id, ctx.livemode),
      {
        type: 'png',
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 320,
      },
    );
    return new StreamableFile(png, { type: 'image/png' });
  }

  async scan(
    ctx: TenantContext,
    membership: MembershipContext,
    userId: string,
    dto: ScanTicketDto,
  ): Promise<ScanOutcome> {
    assertLocationAccess(membership, dto.locationId);

    if (!dto.token === !dto.code) {
      throw new BadRequestException('Send either token or code');
    }

    let where: SQL;
    if (dto.token) {
      const payload = verifyTicketToken(dto.token);
      if (!payload) {
        return { result: 'invalid' };
      }
      if (payload.livemode !== ctx.livemode) {
        return { result: 'wrong_mode' };
      }
      where = eq(tickets.id, payload.ticketId);
    } else {
      where = eq(tickets.code, this.normalizeCode(dto.code!));
    }

    const outcome = await this.db.withTenant(ctx, (tx) =>
      this.checkIn(tx, userId, dto.locationId, where),
    );

    // Typed codes don't carry their mode: a code from the other mode is wrong_mode, not invalid.
    if (outcome.result === 'invalid' && dto.code) {
      const [other] = await this.db.withTenant(
        { orgId: ctx.orgId, livemode: !ctx.livemode },
        (tx) => tx.select({ id: tickets.id }).from(tickets).where(where),
      );
      if (other) {
        return { result: 'wrong_mode' };
      }
    }

    if (outcome.result === 'valid') {
      // After commit. A delivery failure never fails a scan; the delivery job retries.
      const event: TicketCheckedInEvent = {
        ...ctx,
        ticketId: outcome.ticket!.id,
        checkedInByUserId: userId,
      };
      await this.events
        .emitAsync(TICKET_CHECKED_IN, event)
        .catch((error: unknown) =>
          this.logger.error(
            `Failed to dispatch ticket.checked_in for ${outcome.ticket!.id}: ${String(error)}`,
          ),
        );
    }

    return outcome;
  }

  private async checkIn(
    tx: Transaction,
    userId: string,
    locationId: string,
    where: SQL,
  ): Promise<ScanOutcome> {
    const [row] = await tx
      .select({
        id: tickets.id,
        code: tickets.code,
        checkedInAt: tickets.checkedInAt,
        reservationStatus: reservations.status,
        reservationCode: reservations.code,
        customerName: reservations.customerName,
        showtimeStatus: showtimes.status,
        locationId: showtimes.locationId,
        startsAt: showtimes.startsAt,
        endsAt: showtimes.endsAt,
        timezone: locations.timezone,
        movieTitle: movies.title,
        screenName: screens.name,
        rowLabel: seats.rowLabel,
        number: seats.number,
        type: seats.type,
      })
      .from(tickets)
      .innerJoin(reservations, eq(reservations.id, tickets.reservationId))
      .innerJoin(showtimes, eq(showtimes.id, reservations.showtimeId))
      .innerJoin(locations, eq(locations.id, showtimes.locationId))
      .innerJoin(movies, eq(movies.id, showtimes.movieId))
      .innerJoin(screens, eq(screens.id, showtimes.screenId))
      .innerJoin(showtimeSeats, eq(showtimeSeats.id, tickets.showtimeSeatId))
      .innerJoin(seats, eq(seats.id, showtimeSeats.seatId))
      .where(where);

    if (!row) {
      return { result: 'invalid' };
    }

    const ticket: ScannedTicket = {
      id: row.id,
      code: row.code,
      seat: { rowLabel: row.rowLabel, number: row.number, type: row.type },
      reservationCode: row.reservationCode,
      customerName: row.customerName,
      movieTitle: row.movieTitle,
      screenName: row.screenName,
      startsAt: row.startsAt,
      checkedInAt: row.checkedInAt,
    };

    if (
      row.reservationStatus !== 'confirmed' ||
      row.showtimeStatus === 'cancelled'
    ) {
      return { result: 'void', ticket };
    }
    if (row.locationId !== locationId) {
      return { result: 'wrong_location', ticket };
    }

    const timing = scanTiming(
      new Date(),
      row.startsAt,
      row.endsAt,
      row.timezone,
    );
    if (timing !== 'open') {
      return { result: timing, ticket };
    }
    if (row.checkedInAt) {
      return { result: 'already_used', ticket };
    }

    const [checkedIn] = await tx
      .update(tickets)
      .set({ checkedInAt: new Date(), checkedInByUserId: userId })
      .where(and(eq(tickets.id, row.id), isNull(tickets.checkedInAt)))
      .returning({ checkedInAt: tickets.checkedInAt });

    if (!checkedIn) {
      const [current] = await tx
        .select({ checkedInAt: tickets.checkedInAt })
        .from(tickets)
        .where(eq(tickets.id, row.id));
      return {
        result: 'already_used',
        ticket: { ...ticket, checkedInAt: current.checkedInAt },
      };
    }

    return {
      result: 'valid',
      ticket: { ...ticket, checkedInAt: checkedIn.checkedInAt },
    };
  }

  private normalizeCode(code: string) {
    return code.replace(/[\s-]/g, '').toUpperCase();
  }

  private toView(
    ticket: Pick<
      Ticket,
      'id' | 'code' | 'checkedInAt' | 'showtimeSeatId' | 'livemode'
    >,
    seat: Pick<InventorySeat, 'rowLabel' | 'number' | 'type'>,
  ): TicketView {
    return {
      id: ticket.id,
      code: ticket.code,
      checkedInAt: ticket.checkedInAt,
      showtimeSeatId: ticket.showtimeSeatId,
      seat: { rowLabel: seat.rowLabel, number: seat.number, type: seat.type },
      qrToken: signTicketToken(ticket.id, ticket.livemode),
    };
  }
}
