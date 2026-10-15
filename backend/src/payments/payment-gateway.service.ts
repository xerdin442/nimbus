import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { RedisClientType } from 'redis';
import { DbService } from '@src/db/db.service';
import { paymentConfigs } from '@src/db/schema';
import type { ConfigStatus } from '@src/db/schema/types';
import { REDIS_CLIENT } from '@src/common/cache';
import { EncryptionService } from '@src/common/helpers';
import { CodedException } from '@src/common/errors';
import { Logger } from '@src/common/logger';
import type { TenantContext } from '@src/common/types';
import { PaystackProvider } from './providers/paystack.provider';
import {
  PaymentProvider,
  PaymentProviderError,
} from './providers/payment-provider.interface';

const STATUS_CACHE_SECONDS = 5;

const statusKey = (ctx: TenantContext) =>
  `payment-config-status:${ctx.orgId}:${ctx.livemode ? 'live' : 'test'}`;

const unavailable = (message: string) =>
  new CodedException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'payment_provider_unavailable',
    message,
  );

/**
 * Every call to the provider with an org's key goes through here, in the request's mode. A key
 * the provider rejects (401/403) marks that mode's config `broken`: online payments in that mode
 * stop until the org reconnects, and the other mode is unaffected.
 */
@Injectable()
export class PaymentGatewayService {
  private readonly logger = Logger(PaymentGatewayService.name);

  constructor(
    private readonly db: DbService,
    private readonly encryption: EncryptionService,
    private readonly paystack: PaystackProvider,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
  ) {}

  /** Paystack is the only provider for now. */
  get provider(): PaymentProvider {
    return this.paystack;
  }

  /** The config's status for the mode (`null`: not connected), cached for a few seconds. */
  async status(ctx: TenantContext): Promise<ConfigStatus | null> {
    const cached = await this.redis.get(statusKey(ctx));
    if (cached) {
      return cached === 'none' ? null : (cached as ConfigStatus);
    }

    const [config] = await this.db.withTenant(ctx, (tx) =>
      tx.select({ status: paymentConfigs.status }).from(paymentConfigs),
    );
    const status = config?.status ?? null;

    await this.redis.set(statusKey(ctx), status ?? 'none', {
      expiration: { type: 'EX', value: STATUS_CACHE_SECONDS },
    });
    return status;
  }

  /** 503 payment_provider_unavailable unless online payments can be taken in this mode. */
  async assertAvailable(ctx: TenantContext): Promise<void> {
    const status = await this.status(ctx);

    if (!status) {
      throw unavailable(
        `Online payments are not set up in ${ctx.livemode ? 'live' : 'test'} mode`,
      );
    }
    if (status === 'broken') {
      throw unavailable('Online booking is temporarily unavailable');
    }
  }

  async withSecret<T>(
    ctx: TenantContext,
    fn: (provider: PaymentProvider, secretKey: string) => Promise<T>,
  ): Promise<T> {
    const [config] = await this.db.withTenant(ctx, (tx) =>
      tx
        .select({
          status: paymentConfigs.status,
          encryptedSecret: paymentConfigs.encryptedSecret,
        })
        .from(paymentConfigs),
    );

    if (!config) {
      throw unavailable(
        `Online payments aren't set up in ${ctx.livemode ? 'live' : 'test'} mode`,
      );
    }
    if (config.status === 'broken') {
      throw unavailable('Online booking is temporarily unavailable');
    }

    try {
      return await fn(
        this.provider,
        this.encryption.decrypt(config.encryptedSecret),
      );
    } catch (error) {
      if (!(error instanceof PaymentProviderError)) throw error;

      if (error.kind === 'auth') {
        await this.markBroken(ctx, error.message);
        throw unavailable('Online booking is temporarily unavailable');
      }
      if (error.kind === 'unavailable') {
        throw new CodedException(
          HttpStatus.BAD_GATEWAY,
          'payment_provider_unavailable',
          `${error.message}. Try again shortly.`,
        );
      }
      throw new CodedException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'payment_provider_rejected',
        error.message,
      );
    }
  }

  /** The mode's secret key for checking webhook signatures, whatever the config's status. */
  async webhookSecret(ctx: TenantContext): Promise<string | null> {
    const [config] = await this.db.withTenant(ctx, (tx) =>
      tx
        .select({ encryptedSecret: paymentConfigs.encryptedSecret })
        .from(paymentConfigs),
    );
    return config ? this.encryption.decrypt(config.encryptedSecret) : null;
  }

  async markBroken(ctx: TenantContext, message: string): Promise<void> {
    await this.db.withTenant(ctx, (tx) =>
      tx
        .update(paymentConfigs)
        .set({ status: 'broken', lastError: message, brokenAt: new Date() })
        .where(eq(paymentConfigs.status, 'verified')),
    );
    await this.invalidate(ctx);
    this.logger.warn(
      `Payment config broken for org ${ctx.orgId} (${ctx.livemode ? 'live' : 'test'}): ${message}`,
    );
  }

  async invalidate(ctx: TenantContext): Promise<void> {
    await this.redis.del(statusKey(ctx));
  }
}
