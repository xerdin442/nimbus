import {
  BadRequestException,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, PoolConfig } from 'pg';
import { isUUID } from 'class-validator';
import * as schema from './schema';
import type { Database, TenantContext, Transaction } from '@src/common/types';

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly pool: Pool;

  /**
   * Plain client, no tenant context. Use only for global tables (organizations, users, api_keys...).
   * Queries on tenant tables through it return zero rows: RLS fails closed.
   */
  readonly client: Database;

  constructor(
    connectionString: string,
    poolConfig: Omit<PoolConfig, 'connectionString'> = {},
  ) {
    this.pool = new Pool({ ...poolConfig, connectionString });
    this.client = drizzle(this.pool, { schema });
  }

  /**
   * Runs `fn` in a transaction scoped to one org and one mode. Every RLS policy reads these settings.
   * `set_config(..., true)` is transaction-local, so the context can't leak to the next query on a
   * pooled connection.
   */
  async withTenant<T>(
    ctx: TenantContext,
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    if (!isUUID(ctx.orgId)) {
      throw new BadRequestException('Invalid organization id');
    }

    return this.client.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.org_id', ${ctx.orgId}, true), set_config('app.livemode', ${String(ctx.livemode)}, true)`,
      );

      return fn(tx);
    });
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
