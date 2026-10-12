import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { eq, lt, sql } from 'drizzle-orm';
import type { Response } from 'express';
import { catchError, from, mergeMap, Observable, of } from 'rxjs';
import { DbService } from '@src/db/db.service';
import { idempotencyKeys } from '@src/db/schema';
import { CodedException } from '@src/common/errors';
import { Logger } from '@src/common/logger';
import type { ApiKeyRequest, TenantContext } from '@src/common/types';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_KEY_LENGTH = 255;

/**
 * `Idempotency-Key` for public API writes: a storefront retrying a request after a timeout gets
 * the first response back instead of creating a second reservation. Keys are per (org, mode)
 * and kept 24h. Only successful responses are stored; a failed request releases its key so the
 * retry runs for real.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = Logger(IdempotencyInterceptor.name);

  constructor(private readonly db: DbService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<ApiKeyRequest>();
    const key = request.headers[IDEMPOTENCY_HEADER];

    if (key === undefined) {
      return next.handle();
    }
    if (typeof key !== 'string' || !key.length || key.length > MAX_KEY_LENGTH) {
      throw new BadRequestException(
        `Idempotency-Key must be 1-${MAX_KEY_LENGTH} characters`,
      );
    }

    const ctx: TenantContext = {
      orgId: request.apiKey.orgId,
      livemode: request.apiKey.livemode,
    };
    const requestHash = createHash('sha256')
      .update(JSON.stringify([request.method, request.path, request.body]))
      .digest('hex');

    if (!(await this.claim(ctx, key, requestHash))) {
      const response = await this.replay(ctx, key, requestHash);
      http.getResponse<Response>().setHeader('Idempotent-Replayed', 'true');
      return of(response);
    }

    return next.handle().pipe(
      mergeMap((body: unknown) =>
        from(this.store(ctx, key, body).then(() => body)),
      ),
      catchError((error: unknown) =>
        from(
          this.release(ctx, key).then(() => {
            throw error;
          }),
        ),
      ),
    );
  }

  /** Inserts the key, or takes over an expired one. False if a live key already exists. */
  private async claim(
    ctx: TenantContext,
    key: string,
    requestHash: string,
  ): Promise<boolean> {
    const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS);
    const claimed = await this.db.withTenant(ctx, (tx) =>
      tx
        .insert(idempotencyKeys)
        .values({
          organizationId: ctx.orgId,
          livemode: ctx.livemode,
          key,
          requestHash,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [
            idempotencyKeys.organizationId,
            idempotencyKeys.livemode,
            idempotencyKeys.key,
          ],
          set: {
            requestHash,
            response: null,
            expiresAt,
            createdAt: new Date(),
          },
          setWhere: lt(idempotencyKeys.expiresAt, sql`now()`),
        })
        .returning({ id: idempotencyKeys.id }),
    );
    return claimed.length > 0;
  }

  private async replay(
    ctx: TenantContext,
    key: string,
    requestHash: string,
  ): Promise<unknown> {
    const [existing] = await this.db.withTenant(ctx, (tx) =>
      tx
        .select({
          requestHash: idempotencyKeys.requestHash,
          response: idempotencyKeys.response,
        })
        .from(idempotencyKeys)
        .where(this.keyIs(key)),
    );

    if (!existing || existing.requestHash !== requestHash) {
      throw new CodedException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'idempotency_key_reused',
        'This Idempotency-Key was used for a different request',
      );
    }
    if (existing.response === null) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'request_in_progress',
        'A request with this Idempotency-Key is still being processed',
      );
    }

    return existing.response;
  }

  /**
   * If this fails the key stays claimed with no response, so retries get 409 until it expires.
   * Releasing it instead could let a retry create a duplicate of a request that succeeded.
   */
  private async store(ctx: TenantContext, key: string, body: unknown) {
    try {
      await this.db.withTenant(ctx, (tx) =>
        tx
          .update(idempotencyKeys)
          .set({ response: body ?? {} })
          .where(this.keyIs(key)),
      );
    } catch (error) {
      this.logger.error(
        `Failed to store idempotent response for key ${key}: ${String(error)}`,
      );
    }
  }

  private async release(ctx: TenantContext, key: string) {
    try {
      await this.db.withTenant(ctx, (tx) =>
        tx.delete(idempotencyKeys).where(this.keyIs(key)),
      );
    } catch (error) {
      this.logger.error(
        `Failed to release idempotency key ${key}: ${String(error)}`,
      );
    }
  }

  private keyIs(key: string) {
    return eq(idempotencyKeys.key, key);
  }
}
