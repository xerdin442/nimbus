import { Injectable, NotFoundException } from '@nestjs/common';
import { and, count, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { DbService } from '@src/db/db.service';
import { locations } from '@src/db/schema';
import type { Location } from '@src/db/schema/types';
import type {
  MembershipContext,
  TenantContext,
  Transaction,
} from '@src/common/types';
import { EntitlementsService } from '@src/entitlements/entitlements.service';
import { assertLocationAccess, canAccessAllLocations } from './location-access';
import { CreateLocationDto, UpdateLocationDto } from './dto/location.dto';

const countActiveLocations = async (tx: Transaction) => {
  const [{ total }] = await tx
    .select({ total: count() })
    .from(locations)
    .where(isNull(locations.archivedAt));
  return total;
};

@Injectable()
export class LocationsService {
  constructor(
    private readonly db: DbService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async list(
    ctx: TenantContext,
    membership: MembershipContext,
    archived = false,
  ): Promise<Location[]> {
    return this.db.withTenant(ctx, (tx) =>
      tx
        .select()
        .from(locations)
        .where(
          and(
            archived
              ? isNotNull(locations.archivedAt)
              : isNull(locations.archivedAt),
            membership.locationIds.length
              ? inArray(locations.id, membership.locationIds)
              : undefined,
          ),
        )
        .orderBy(locations.name),
    );
  }

  /** Public API: active locations only. */
  async listActive(ctx: TenantContext): Promise<Location[]> {
    return this.db.withTenant(ctx, (tx) =>
      tx
        .select()
        .from(locations)
        .where(isNull(locations.archivedAt))
        .orderBy(locations.name),
    );
  }

  async get(
    ctx: TenantContext,
    membership: MembershipContext,
    id: string,
  ): Promise<Location> {
    assertLocationAccess(membership, id);
    const [location] = await this.db.withTenant(ctx, (tx) =>
      tx.select().from(locations).where(eq(locations.id, id)),
    );

    if (!location) {
      throw new NotFoundException('Location not found');
    }

    return location;
  }

  async create(
    ctx: TenantContext,
    membership: MembershipContext,
    dto: CreateLocationDto,
  ): Promise<Location> {
    canAccessAllLocations(membership, 'create');

    return this.db.withTenant(ctx, async (tx) => {
      await this.entitlements.assertWithinLimit(
        tx,
        ctx.orgId,
        'locations.max',
        countActiveLocations,
      );

      const [location] = await tx
        .insert(locations)
        .values({ organizationId: ctx.orgId, ...dto })
        .returning();

      return location;
    });
  }

  async update(
    ctx: TenantContext,
    membership: MembershipContext,
    id: string,
    dto: UpdateLocationDto,
  ): Promise<Location> {
    assertLocationAccess(membership, id);
    const [location] = await this.db.withTenant(ctx, (tx) =>
      tx.update(locations).set(dto).where(eq(locations.id, id)).returning(),
    );

    if (!location) {
      throw new NotFoundException('Location not found');
    }

    return location;
  }

  /** Archived locations stop counting toward `locations.max`; their data is kept for reference. */
  async archive(
    ctx: TenantContext,
    membership: MembershipContext,
    id: string,
  ): Promise<Location> {
    canAccessAllLocations(membership, 'archive');

    const [location] = await this.db.withTenant(ctx, (tx) =>
      tx
        .update(locations)
        .set({ archivedAt: new Date() })
        .where(and(eq(locations.id, id), isNull(locations.archivedAt)))
        .returning(),
    );

    if (!location) {
      throw new NotFoundException('Active location not found');
    }

    return location;
  }

  /** Re-checks the limit: unarchiving brings a location back into the count. */
  async unarchive(
    ctx: TenantContext,
    membership: MembershipContext,
    id: string,
  ): Promise<Location> {
    canAccessAllLocations(membership, 'unarchive');

    return this.db.withTenant(ctx, async (tx) => {
      await this.entitlements.assertWithinLimit(
        tx,
        ctx.orgId,
        'locations.max',
        countActiveLocations,
      );

      const [location] = await tx
        .update(locations)
        .set({ archivedAt: null })
        .where(and(eq(locations.id, id), isNotNull(locations.archivedAt)))
        .returning();

      if (!location) {
        throw new NotFoundException('Archived location not found');
      }

      return location;
    });
  }
}
