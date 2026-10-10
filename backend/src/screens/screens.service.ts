import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, eq, isNotNull, isNull, max } from 'drizzle-orm';
import { DbService } from '@src/db/db.service';
import { locations, screens, seatLayouts, seats } from '@src/db/schema';
import type { Screen } from '@src/db/schema/types';
import type {
  LayoutView,
  MembershipContext,
  TenantContext,
  Transaction,
} from '@src/common/types';
import { CodedException } from '@src/common/errors';
import { EntitlementsService } from '@src/entitlements/entitlements.service';
import { assertLocationAccess } from '@src/locations/location-access';
import { labelSeats } from './seat-grid';
import {
  CreateScreenDto,
  SaveLayoutDto,
  UpdateScreenDto,
} from './dto/screen.dto';

const countActiveScreens = async (tx: Transaction) => {
  const [{ total }] = await tx
    .select({ total: count() })
    .from(screens)
    .where(isNull(screens.archivedAt));
  return total;
};

@Injectable()
export class ScreensService {
  constructor(
    private readonly db: DbService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async listForLocation(
    ctx: TenantContext,
    membership: MembershipContext,
    locationId: string,
  ): Promise<Screen[]> {
    assertLocationAccess(membership, locationId);
    return this.db.withTenant(ctx, (tx) =>
      tx
        .select()
        .from(screens)
        .where(eq(screens.locationId, locationId))
        .orderBy(screens.name),
    );
  }

  async create(
    ctx: TenantContext,
    membership: MembershipContext,
    locationId: string,
    dto: CreateScreenDto,
  ): Promise<Screen> {
    assertLocationAccess(membership, locationId);

    return this.db.withTenant(ctx, async (tx) => {
      const [location] = await tx
        .select({ archivedAt: locations.archivedAt })
        .from(locations)
        .where(eq(locations.id, locationId));

      if (!location) {
        throw new NotFoundException('Location not found');
      }
      if (location.archivedAt) {
        throw new CodedException(
          HttpStatus.CONFLICT,
          'location_archived',
          'Unarchive the location before adding screens',
        );
      }

      await this.entitlements.assertWithinLimit(
        tx,
        ctx.orgId,
        'screens.max',
        countActiveScreens,
      );

      const [screen] = await tx
        .insert(screens)
        .values({ organizationId: ctx.orgId, locationId, ...dto })
        .returning();

      return screen;
    });
  }

  async get(
    ctx: TenantContext,
    membership: MembershipContext,
    id: string,
  ): Promise<Screen> {
    const [screen] = await this.db.withTenant(ctx, (tx) =>
      tx.select().from(screens).where(eq(screens.id, id)),
    );

    if (!screen) {
      throw new NotFoundException('Screen not found');
    }

    assertLocationAccess(membership, screen.locationId);
    return screen;
  }

  async update(
    ctx: TenantContext,
    membership: MembershipContext,
    id: string,
    dto: UpdateScreenDto,
  ): Promise<Screen> {
    await this.get(ctx, membership, id);
    const [screen] = await this.db.withTenant(ctx, (tx) =>
      tx.update(screens).set(dto).where(eq(screens.id, id)).returning(),
    );
    return screen;
  }

  async archive(
    ctx: TenantContext,
    membership: MembershipContext,
    id: string,
  ): Promise<Screen> {
    await this.get(ctx, membership, id);
    const [screen] = await this.db.withTenant(ctx, (tx) =>
      tx
        .update(screens)
        .set({ archivedAt: new Date() })
        .where(and(eq(screens.id, id), isNull(screens.archivedAt)))
        .returning(),
    );

    if (!screen) {
      throw new NotFoundException('Active screen not found');
    }

    return screen;
  }

  async unarchive(
    ctx: TenantContext,
    membership: MembershipContext,
    id: string,
  ): Promise<Screen> {
    await this.get(ctx, membership, id);

    return this.db.withTenant(ctx, async (tx) => {
      await this.entitlements.assertWithinLimit(
        tx,
        ctx.orgId,
        'screens.max',
        countActiveScreens,
      );

      const [screen] = await tx
        .update(screens)
        .set({ archivedAt: null })
        .where(and(eq(screens.id, id), isNotNull(screens.archivedAt)))
        .returning();

      if (!screen) {
        throw new NotFoundException('Archived screen not found');
      }

      return screen;
    });
  }

  async getCurrentLayout(
    ctx: TenantContext,
    membership: MembershipContext,
    screenId: string,
  ): Promise<LayoutView | null> {
    await this.get(ctx, membership, screenId);

    return this.db.withTenant(ctx, async (tx) => {
      const [layout] = await tx
        .select()
        .from(seatLayouts)
        .where(
          and(
            eq(seatLayouts.screenId, screenId),
            eq(seatLayouts.isCurrent, true),
          ),
        );

      if (!layout) return null;

      const layoutSeats = await tx
        .select({
          gridRow: seats.gridRow,
          gridColumn: seats.gridColumn,
          rowLabel: seats.rowLabel,
          number: seats.number,
          type: seats.type,
        })
        .from(seats)
        .where(eq(seats.layoutId, layout.id))
        .orderBy(asc(seats.gridRow), asc(seats.gridColumn));

      return { ...layout, capacity: layoutSeats.length, seats: layoutSeats };
    });
  }

  /**
   * Saves a NEW version and makes it current. Old versions stay, so showtimes published
   * on them keep their seat map. The screen row is locked so two saves can't both claim
   * the same next version number.
   */
  async saveLayout(
    ctx: TenantContext,
    membership: MembershipContext,
    screenId: string,
    dto: SaveLayoutDto,
  ): Promise<LayoutView> {
    await this.get(ctx, membership, screenId);
    const labeled = labelSeats(
      dto.rows,
      dto.columns,
      dto.seats,
      dto.skipRowLetters,
    );

    return this.db.withTenant(ctx, async (tx) => {
      await tx
        .select({ id: screens.id })
        .from(screens)
        .where(eq(screens.id, screenId))
        .for('update');

      const [{ latest }] = await tx
        .select({ latest: max(seatLayouts.version) })
        .from(seatLayouts)
        .where(eq(seatLayouts.screenId, screenId));

      await tx
        .update(seatLayouts)
        .set({ isCurrent: false })
        .where(
          and(
            eq(seatLayouts.screenId, screenId),
            eq(seatLayouts.isCurrent, true),
          ),
        );

      const [layout] = await tx
        .insert(seatLayouts)
        .values({
          organizationId: ctx.orgId,
          screenId,
          version: (latest ?? 0) + 1,
          rows: dto.rows,
          columns: dto.columns,
          isCurrent: true,
        })
        .returning();

      await tx.insert(seats).values(
        labeled.map((seat) => ({
          organizationId: ctx.orgId,
          layoutId: layout.id,
          ...seat,
        })),
      );

      return { ...layout, capacity: labeled.length, seats: labeled };
    });
  }
}
