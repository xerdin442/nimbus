import { HttpStatus, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { organizations } from '@src/db/schema';
import { CodedException } from '@src/common/errors';
import type {
  EntitlementKey,
  Entitlements,
  LimitKey,
  TestModeLimitKey,
  Transaction,
} from '@src/common/types';
import { BASIC_ENTITLEMENTS, TEST_MODE_LIMITS } from './entitlements.constants';

@Injectable()
export class EntitlementsService {
  /**
   * Effective entitlements for an org. Phase 1: Basic for everyone (no billing yet).
   * Phase 4 reads the org's plan + overrides here (cached in Redis, 60s TTL).
   */
  // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
  async getAll(orgId: string): Promise<Entitlements> {
    return { ...BASIC_ENTITLEMENTS };
  }

  async get<K extends EntitlementKey>(
    orgId: string,
    key: K,
  ): Promise<Entitlements[K]> {
    return (await this.getAll(orgId))[key];
  }

  /**
   * Throws `403 plan_limit_reached` if creating one more resource would exceed the limit.
   *
   * Must run inside the transaction that inserts the resource. It first locks the org row,
   * so concurrent creates for the same org queue up behind each other
   */
  async assertWithinLimit(
    tx: Transaction,
    orgId: string,
    key: LimitKey | TestModeLimitKey,
    count: (tx: Transaction) => Promise<number>,
  ): Promise<void> {
    await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .for('update');

    const limit =
      key in TEST_MODE_LIMITS
        ? TEST_MODE_LIMITS[key as TestModeLimitKey]
        : await this.get(orgId, key as LimitKey);
    const current = await count(tx);

    if (current >= limit) {
      throw new CodedException(
        HttpStatus.FORBIDDEN,
        'plan_limit_reached',
        `Your plan allows ${limit} for ${key}`,
        { key, limit, current },
      );
    }
  }
}
