import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '@src/db/db.service';
import {
  mailConfigs,
  memberships,
  organizations,
  paymentConfigs,
} from '@src/db/schema';
import type { Organization } from '@src/db/schema/types';
import type {
  Database,
  Transaction,
  VerificationChecklist,
} from '@src/common/types';
import { randomAlphanumeric } from '@src/common/util';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
} from './dto/organization.dto';

export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'org';

@Injectable()
export class OrganizationsService {
  constructor(private readonly db: DbService) {}

  async createWithOwner(
    tx: Database | Transaction,
    dto: CreateOrganizationDto,
    owner: { id: string; email: string },
  ): Promise<Organization> {
    const base = slugify(dto.name);
    let org: Organization | undefined;

    for (const slug of [base, `${base}-${randomAlphanumeric(6)}`]) {
      [org] = await tx
        .insert(organizations)
        .values({
          name: dto.name,
          slug,
          country: dto.country.toUpperCase(),
          currency: dto.currency,
          notificationEmail: owner.email,
        })
        .onConflictDoNothing({ target: organizations.slug })
        .returning();

      if (org) break;
    }

    if (!org) {
      throw new Error(`Could not allocate a slug for "${dto.name}"`);
    }

    await tx.insert(memberships).values({
      userId: owner.id,
      organizationId: org.id,
      role: 'owner',
    });

    return org;
  }

  async get(
    orgId: string,
  ): Promise<Organization & { verification: VerificationChecklist }> {
    const [org] = await this.db.client
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId));

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const [live, test] = await Promise.all(
      [true, false].map((livemode) =>
        this.db.withTenant({ orgId, livemode }, (tx) =>
          tx.select({ status: paymentConfigs.status }).from(paymentConfigs),
        ),
      ),
    );
    const [mail] = await this.db.withTenant({ orgId, livemode: true }, (tx) =>
      tx.select({ status: mailConfigs.status }).from(mailConfigs),
    );

    return {
      ...org,
      verification: {
        isVerified: org.isVerified,
        verifiedAt: org.verifiedAt,
        paymentConfig: {
          test: test[0]?.status ?? null,
          live: live[0]?.status ?? null,
        },
        mailConfig: mail?.status ?? null,
      },
    };
  }

  async update(
    orgId: string,
    dto: UpdateOrganizationDto,
  ): Promise<Organization> {
    const [org] = await this.db.client
      .update(organizations)
      .set({
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.notificationEmail !== undefined && {
          notificationEmail: dto.notificationEmail.toLowerCase(),
        }),
      })
      .where(eq(organizations.id, orgId))
      .returning();

    return org;
  }
}
