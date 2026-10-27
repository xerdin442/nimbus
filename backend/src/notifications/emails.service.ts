import {
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  type SQL,
} from 'drizzle-orm';
import { UnrecoverableError, type Queue } from 'bullmq';
import type { RedisClientType } from 'redis';
import * as QRCode from 'qrcode';
import { REDIS_CLIENT } from '@src/common/cache';
import { CodedException } from '@src/common/errors';
import { DbService } from '@src/db/db.service';
import { EncryptionService } from '@src/common/helpers';
import { Logger } from '@src/common/logger';
import {
  EMAILS_QUEUE,
  SEND_ALERT_JOB,
  SEND_EMAIL_JOB,
} from '@src/common/types/constants';
import type { SendAlertJob, SendEmailJob } from '@src/common/types/job';
import type {
  EmailDeliveryView,
  OrgAlertKind,
  PaginatedResult,
  RenderedEmail,
  TenantContext,
  Transaction,
} from '@src/common/types';
import type { Reservation } from '@src/db/schema/types';
import {
  emailDeliveries,
  locations,
  mailConfigs,
  movies,
  organizations,
  orgSettings,
  refunds,
  reservations,
  screens,
  seats,
  showtimeSeats,
  showtimes,
  tickets,
} from '@src/db/schema';
import type {
  EmailDelivery,
  EmailDeliveryStatus,
  EmailFailureReason,
  EmailType,
} from '@src/db/schema/types';
import { signTicketToken } from '@src/tickets/ticket-token';
import type {
  ListEmailDeliveriesQueryDto,
  RetryEmailDeliveriesDto,
} from './dto/email-delivery.dto';
import { MailConfigService } from './mail-config.service';
import { MailProviderFactory } from './providers/mail-provider.factory';
import {
  MailAttachment,
  MailFailureKind,
  MailProviderError,
} from './providers/mail-provider.interface';
import { PlatformMailService } from './platform-mail.service';
import {
  cancellationEmail,
  confirmationEmail,
  refundEmail,
  type ReservationEmailInput,
} from './templates';
import { Secrets } from '@src/common/secrets';

/** Rows the dashboard retry button works for; the other reasons a retry can't fix. */
const RETRYABLE_REASONS: EmailFailureReason[] = [
  'provider_auth',
  'provider_broken',
  'provider_unavailable',
];

const FAILURE_REASONS: Record<MailFailureKind, EmailFailureReason> = {
  auth: 'provider_auth',
  rejected: 'invalid_recipient',
  unavailable: 'provider_unavailable',
};

const FAILURE_LABELS: Record<EmailFailureReason, string> = {
  provider_auth: 'the provider rejected the API key',
  provider_broken: 'the email provider is disconnected',
  provider_unavailable: 'the provider was temporarily unavailable',
  invalid_recipient: 'the recipient address was rejected',
  test_mode: 'test mode: emails are not sent to customers',
  no_longer_relevant: 'the reservation changed and the email no longer applies',
};

@Injectable()
export class EmailsService {
  private readonly logger = Logger(EmailsService.name);

  constructor(
    private readonly db: DbService,
    private readonly encryption: EncryptionService,
    private readonly providers: MailProviderFactory,
    private readonly mailConfig: MailConfigService,
    private readonly platformMail: PlatformMailService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
    @InjectQueue(EMAILS_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Live-mode emails go to the customer; test-mode ones are logged as skipped and
   * previewable from the dashboard, unless the org opted into "send test emails to me",
   * which sends them to the notification email through the org's provider.
   */
  async queueFor(
    ctx: TenantContext,
    reservationId: string,
    type: EmailType,
  ): Promise<void> {
    const deliveryId = await this.db.withTenant(ctx, async (tx) => {
      const [reservation] = await tx
        .select({ customerEmail: reservations.customerEmail })
        .from(reservations)
        .where(eq(reservations.id, reservationId));
      if (!reservation?.customerEmail) return null;

      let to = reservation.customerEmail;
      if (!ctx.livemode) {
        const [settings] = await tx
          .select({ sendTestEmailsToMe: orgSettings.sendTestEmailsToMe })
          .from(orgSettings);
        if (!settings?.sendTestEmailsToMe) {
          await this.insertDelivery(
            tx,
            ctx,
            reservationId,
            type,
            to,
            'skipped',
            'test_mode',
          );
          return null;
        }
        const [org] = await tx
          .select({ notificationEmail: organizations.notificationEmail })
          .from(organizations)
          .where(eq(organizations.id, ctx.orgId));
        to = org?.notificationEmail ?? to;
      }

      return this.insertDelivery(tx, ctx, reservationId, type, to, 'queued');
    });

    if (deliveryId) {
      await this.schedule(ctx, deliveryId);
    }
  }

  /**
   * The `send` job: one attempt at a stored email. Content is re-rendered from the
   * reservation's current state, so a retried email reflects the latest details and
   * the current sender. Temporary provider failures rethrow for BullMQ's single
   * automatic retry; permanent ones are recorded and never retried.
   */
  async send(ctx: TenantContext, deliveryId: string): Promise<void> {
    const [delivery] = await this.db.withTenant(ctx, (tx) =>
      tx
        .select()
        .from(emailDeliveries)
        .where(eq(emailDeliveries.id, deliveryId)),
    );
    // A re-delivered job for an already-sent row is a no-op.
    if (!delivery || delivery.status === 'sent') return;

    const input = await this.renderInput(ctx, delivery.reservationId);
    if (!input || !this.isRelevant(delivery.type, input)) {
      await this.skip(ctx, delivery.id, 'no_longer_relevant');
      return;
    }

    const [config] = await this.db.withTenant(ctx, (tx) =>
      tx.select().from(mailConfigs),
    );
    if (!config || config.status === 'broken') {
      // No API call is made, the email goes straight into the backlog
      await this.fail(
        ctx,
        delivery.id,
        'provider_broken',
        'The email provider is disconnected or broken',
      );
      throw new UnrecoverableError('Email provider is broken');
    }

    const rendered = this.renderTemplate(delivery.type, input);
    const attachments =
      delivery.type === 'confirmation'
        ? await this.qrAttachments(ctx, input.tickets)
        : undefined;

    await this.db.withTenant(ctx, (tx) =>
      tx
        .update(emailDeliveries)
        .set({ attempts: delivery.attempts + 1, lastAttemptedAt: new Date() })
        .where(eq(emailDeliveries.id, delivery.id)),
    );

    try {
      const { messageId } = await this.providers
        .create(
          config.provider,
          this.encryption.decrypt(config.encryptedApiKey),
        )
        .send({
          from: `${config.fromName} <${config.fromEmail}>`,
          to: delivery.to,
          replyTo: config.replyTo ?? undefined,
          ...rendered,
          ...(attachments && { attachments }),
        });
      await this.db.withTenant(ctx, (tx) =>
        tx
          .update(emailDeliveries)
          .set({
            status: 'sent',
            provider: config.provider,
            providerMessageId: messageId,
            sentAt: new Date(),
            failureReason: null,
            lastError: null,
          })
          .where(eq(emailDeliveries.id, delivery.id)),
      );
    } catch (error) {
      if (!(error instanceof MailProviderError)) throw error;
      await this.recordFailure(ctx, delivery.id, error);
      // Temporary errors retry once after 30s (attempts: 2); the others can't succeed.
      if (error.kind === 'unavailable') throw error;
      throw new UnrecoverableError(error.message);
    }
  }

  async list(
    ctx: TenantContext,
    query: ListEmailDeliveriesQueryDto,
  ): Promise<PaginatedResult<EmailDeliveryView>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filters: (SQL | undefined)[] = [
      query.status ? eq(emailDeliveries.status, query.status) : undefined,
      query.type ? eq(emailDeliveries.type, query.type) : undefined,
      query.startDate
        ? gte(emailDeliveries.createdAt, query.startDate)
        : undefined,
      query.endDate ? lte(emailDeliveries.createdAt, query.endDate) : undefined,
    ];
    const where = and(...filters);

    const [rows, [{ total }]] = await this.db.withTenant(ctx, (tx) =>
      Promise.all([
        tx
          .select()
          .from(emailDeliveries)
          .where(where)
          .orderBy(desc(emailDeliveries.createdAt), desc(emailDeliveries.id))
          .limit(limit)
          .offset((page - 1) * limit),
        tx.select({ total: count() }).from(emailDeliveries).where(where),
      ]),
    );

    return {
      data: rows.map((row) => this.toView(row)),
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

  async preview(
    ctx: TenantContext,
    deliveryId: string,
  ): Promise<RenderedEmail> {
    const [delivery] = await this.db.withTenant(ctx, (tx) =>
      tx
        .select()
        .from(emailDeliveries)
        .where(eq(emailDeliveries.id, deliveryId)),
    );
    if (!delivery) {
      throw new NotFoundException('Email not found');
    }

    const input = await this.renderInput(ctx, delivery.reservationId);
    if (!input) {
      throw new NotFoundException('Email not found');
    }
    return this.renderTemplate(delivery.type, input);
  }

  async retry(
    ctx: TenantContext,
    dto: RetryEmailDeliveriesDto,
    options: { single?: boolean } = {},
  ): Promise<{ retried: number }> {
    const [config] = await this.db.withTenant(ctx, (tx) =>
      tx.select().from(mailConfigs),
    );
    if (!config || config.status !== 'verified') {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'email_provider_broken',
        'Connect a working email provider before retrying failed emails',
      );
    }
    if (!dto.ids?.length && !dto.status) {
      throw new CodedException(
        HttpStatus.BAD_REQUEST,
        'retry_target_missing',
        'Send ids or status: failed (optionally, since a date)',
      );
    }

    const claimed = await this.db.withTenant(ctx, (tx) => {
      const filters: (SQL | undefined)[] = [
        eq(emailDeliveries.status, 'failed'),
        inArray(emailDeliveries.failureReason, RETRYABLE_REASONS),
        dto.ids?.length ? inArray(emailDeliveries.id, dto.ids) : undefined,
        dto.since ? gte(emailDeliveries.createdAt, dto.since) : undefined,
      ];

      return tx
        .update(emailDeliveries)
        .set({ status: 'queued' })
        .where(and(...filters))
        .returning({ id: emailDeliveries.id });
    });

    if (!claimed.length && options.single) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'email_not_retryable',
        'This email is not a failed send that a retry can fix',
      );
    }

    for (const { id } of claimed) {
      await this.schedule(ctx, id);
    }
    return { retried: claimed.length };
  }

  /** The processor calls this on a job's final attempt (its one automatic retry spent) */
  async alertDeliveryFailure(
    ctx: TenantContext,
    deliveryId: string,
  ): Promise<void> {
    const info = await this.db.withTenant(ctx, async (tx) => {
      const [row] = await tx
        .select({ failureReason: emailDeliveries.failureReason })
        .from(emailDeliveries)
        .where(eq(emailDeliveries.id, deliveryId));
      if (!row) return null;

      const [org] = await tx
        .select({
          name: organizations.name,
          notificationEmail: organizations.notificationEmail,
        })
        .from(organizations)
        .where(eq(organizations.id, ctx.orgId));

      return org ? { ...org, reason: row.failureReason } : null;
    });
    if (!info) return;

    const kind: OrgAlertKind = 'email-delivery-failure';
    await this.recordAlert({
      key: `alerts:${kind}:${ctx.orgId}`,
      kind,
      orgName: info.name,
      to: info.notificationEmail,
      since: new Date(new Date().getTime() - Secrets.EMAIL_ALERT_DELAY_MS),
      failureReason: info.reason
        ? FAILURE_LABELS[info.reason]
        : 'unknown reason',
    });
  }

  /** `refund.failed`: the money didn't move — the org must retry from the dashboard. */
  async alertRefundFailed(ctx: TenantContext, refundId: string): Promise<void> {
    const info = await this.db.withTenant(ctx, async (tx) => {
      const [row] = await tx
        .select({
          amount: refunds.amount,
          currency: refunds.currency,
          code: reservations.code,
        })
        .from(refunds)
        .innerJoin(reservations, eq(reservations.id, refunds.reservationId))
        .where(eq(refunds.id, refundId));
      if (!row) return null;

      const [org] = await tx
        .select({
          name: organizations.name,
          notificationEmail: organizations.notificationEmail,
        })
        .from(organizations)
        .where(eq(organizations.id, ctx.orgId));

      return org ? { ...row, ...org } : null;
    });
    if (!info) return;

    const kind: OrgAlertKind = 'refund-failure';
    await this.recordAlert({
      key: `alerts:${kind}:${ctx.orgId}`,
      kind,
      orgName: info.name,
      reservationCode: info.code,
      amount: info.amount,
      currency: info.currency,
      to: info.notificationEmail,
    });
  }

  /** Throttled to one alert per org per kind per hour: a busy night can't flood the inbox. */
  private async recordAlert(job: SendAlertJob): Promise<void> {
    try {
      const failed = await this.redis.incr(job.key);
      if (failed === 1) {
        await this.queue.add(SEND_ALERT_JOB, job, {
          delay: Secrets.EMAIL_ALERT_DELAY_MS,
          attempts: 8,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: true,
          removeOnFail: 1000,
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to record ${job.kind} alert for org ${job.orgName}: ${String(error)}`,
      );
    }
  }

  private async insertDelivery(
    tx: Transaction,
    ctx: TenantContext,
    reservationId: string,
    type: EmailType,
    to: string,
    status: EmailDeliveryStatus,
    failureReason: EmailFailureReason | null = null,
  ): Promise<string | null> {
    const [inserted] = await tx
      .insert(emailDeliveries)
      .values({
        organizationId: ctx.orgId,
        livemode: ctx.livemode,
        reservationId,
        type,
        to,
        status,
        failureReason,
      })
      .onConflictDoNothing()
      .returning({ id: emailDeliveries.id });
    return inserted?.id ?? null;
  }

  private async schedule(
    ctx: TenantContext,
    deliveryId: string,
  ): Promise<void> {
    const job: SendEmailJob = { ...ctx, deliveryId };
    try {
      await this.queue.add(SEND_EMAIL_JOB, job, {
        jobId: `email-${deliveryId}-${Date.now()}`,
        attempts: 2,
        backoff: { type: 'fixed', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: 1000,
      });
    } catch (error) {
      this.logger.error(
        `Failed to schedule email ${deliveryId}: ${String(error)}`,
      );
    }
  }

  /**
   * What the email says, re-rendered at send time. Seats come from the reservation's
   * `seat_ids` snapshot (the seats are back on sale by refund time); ticket codes are
   * looked up per ticket so a QR image can be attached for each.
   */
  private async renderInput(
    ctx: TenantContext,
    reservationId: string,
  ): Promise<
    | (ReservationEmailInput & {
        status: Reservation['status'];
        endsAt: Date;
        customerEmail: string | null;
        tickets: (ReservationEmailInput['tickets'][number] & { id: string })[];
      })
    | null
  > {
    return this.db.withTenant(ctx, async (tx) => {
      const [row] = await tx
        .select({
          reservation: reservations,
          startsAt: showtimes.startsAt,
          endsAt: showtimes.endsAt,
          movieTitle: movies.title,
          screenName: screens.name,
          locationName: locations.name,
          timezone: locations.timezone,
          orgName: organizations.name,
        })
        .from(reservations)
        .innerJoin(showtimes, eq(showtimes.id, reservations.showtimeId))
        .innerJoin(movies, eq(movies.id, showtimes.movieId))
        .innerJoin(screens, eq(screens.id, showtimes.screenId))
        .innerJoin(locations, eq(locations.id, showtimes.locationId))
        .innerJoin(
          organizations,
          eq(organizations.id, reservations.organizationId),
        )
        .where(eq(reservations.id, reservationId));
      if (!row) return null;

      const seatRows = await tx
        .select({
          id: showtimeSeats.id,
          rowLabel: seats.rowLabel,
          number: seats.number,
        })
        .from(showtimeSeats)
        .innerJoin(seats, eq(seats.id, showtimeSeats.seatId))
        .where(inArray(showtimeSeats.id, row.reservation.seatIds))
        .orderBy(asc(seats.gridRow), asc(seats.gridColumn));

      const ticketRows = await tx
        .select({
          id: tickets.id,
          code: tickets.code,
          rowLabel: seats.rowLabel,
          number: seats.number,
        })
        .from(tickets)
        .innerJoin(showtimeSeats, eq(showtimeSeats.id, tickets.showtimeSeatId))
        .innerJoin(seats, eq(seats.id, showtimeSeats.seatId))
        .where(eq(tickets.reservationId, reservationId))
        .orderBy(asc(seats.gridRow), asc(seats.gridColumn));

      let refund: ReservationEmailInput['refund'] = null;
      if (row.reservation.paymentId) {
        const [recorded] = await tx
          .select({
            amount: refunds.amount,
            currency: refunds.currency,
            reason: refunds.reason,
          })
          .from(refunds)
          .where(eq(refunds.paymentId, row.reservation.paymentId));
        refund = recorded ?? null;
      }

      return {
        orgName: row.orgName,
        code: row.reservation.code,
        customerName: row.reservation.customerName,
        customerEmail: row.reservation.customerEmail,
        status: row.reservation.status,
        endsAt: row.endsAt,
        movieTitle: row.movieTitle,
        screenName: row.screenName,
        locationName: row.locationName,
        startsAt: row.startsAt,
        timezone: row.timezone,
        seats: seatRows.map(({ rowLabel, number }) => ({ rowLabel, number })),
        tickets: ticketRows,
        total: row.reservation.total,
        currency: row.reservation.currency,
        refund,
      };
    });
  }

  private isRelevant(
    type: EmailType,
    input: { status: string; endsAt: Date },
  ): boolean {
    switch (type) {
      case 'confirmation':
        return (
          input.status === 'confirmed' && input.endsAt.getTime() > Date.now()
        );
      case 'cancellation':
        return input.status === 'cancelled';
      case 'refund':
        return input.status === 'refunded';
    }
  }

  private renderTemplate(
    type: EmailType,
    input: ReservationEmailInput,
  ): RenderedEmail {
    switch (type) {
      case 'confirmation':
        return confirmationEmail(input);
      case 'cancellation':
        return cancellationEmail(input);
      case 'refund':
        return refundEmail(input);
    }
  }

  /** One QR PNG per ticket, named by its typed code, attached to the confirmation email. */
  private async qrAttachments(
    ctx: TenantContext,
    ticketRows: { id: string; code: string }[],
  ): Promise<MailAttachment[]> {
    const attachments: MailAttachment[] = [];
    for (const ticket of ticketRows) {
      const png = await QRCode.toBuffer(
        signTicketToken(ticket.id, ctx.livemode),
        { type: 'png', errorCorrectionLevel: 'M', margin: 2, width: 320 },
      );
      attachments.push({ filename: `ticket-${ticket.code}.png`, content: png });
    }
    return attachments;
  }

  private async recordFailure(
    ctx: TenantContext,
    deliveryId: string,
    error: MailProviderError,
  ): Promise<void> {
    if (error.kind === 'auth') {
      await this.mailConfig.markBroken(ctx.orgId, error.message);
    }
    await this.fail(
      ctx,
      deliveryId,
      FAILURE_REASONS[error.kind],
      error.message,
    );
  }

  private async fail(
    ctx: TenantContext,
    deliveryId: string,
    failureReason: EmailFailureReason,
    lastError: string,
  ): Promise<void> {
    await this.db.withTenant(ctx, (tx) =>
      tx
        .update(emailDeliveries)
        .set({ status: 'failed', failureReason, lastError })
        .where(eq(emailDeliveries.id, deliveryId)),
    );
  }

  private async skip(
    ctx: TenantContext,
    deliveryId: string,
    failureReason: EmailFailureReason,
  ): Promise<void> {
    await this.db.withTenant(ctx, (tx) =>
      tx
        .update(emailDeliveries)
        .set({ status: 'skipped', failureReason })
        .where(eq(emailDeliveries.id, deliveryId)),
    );
  }

  private toView(row: EmailDelivery): EmailDeliveryView {
    return { ...row };
  }
}
