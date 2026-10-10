import {
  BadRequestException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { DbService } from '@src/db/db.service';
import {
  invitations,
  locations,
  memberships,
  organizations,
  users,
} from '@src/db/schema';
import type { Invitation, Role } from '@src/db/schema/types';
import type {
  InvitationView,
  MembershipContext,
  Transaction,
} from '@src/common/types';
import { EncryptionService, PasswordService } from '@src/common/helpers';
import { CodedException } from '@src/common/errors';
import { Secrets } from '@src/common/secrets';
import { Logger } from '@src/common/logger';
import { EntitlementsService } from '@src/entitlements/entitlements.service';
import { PlatformMailService } from '@src/notifications/platform-mail.service';
import { invitationEmail } from '@src/notifications/templates';
import { InviteMemberDto, UpdateMemberDto } from './dto/member.dto';
import { assertCanManage, isWithinLocationScope } from './member-access';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const openInvitation = (now: Date) =>
  and(
    isNull(invitations.acceptedAt),
    isNull(invitations.revokedAt),
    gt(invitations.expiresAt, now),
  );

@Injectable()
export class MembersService {
  private readonly logger = Logger(MembersService.name);

  constructor(
    private readonly db: DbService,
    private readonly encryption: EncryptionService,
    private readonly passwords: PasswordService,
    private readonly entitlements: EntitlementsService,
    private readonly platformMail: PlatformMailService,
  ) {}

  async list(actor: MembershipContext) {
    const orgId = actor.orgId;
    const members = await this.db.client
      .select({
        userId: users.id,
        email: users.email,
        name: users.name,
        role: memberships.role,
        locationIds: memberships.locationIds,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, orgId))
      .orderBy(memberships.createdAt);

    const pending = await this.db.client
      .select()
      .from(invitations)
      .where(
        and(eq(invitations.organizationId, orgId), openInvitation(new Date())),
      )
      .orderBy(invitations.createdAt);

    const visible = <T extends { locationIds: string[] }>(rows: T[]) =>
      actor.role === 'owner'
        ? rows
        : rows.filter((row) => isWithinLocationScope(actor, row.locationIds));

    return {
      members: visible(members),
      invitations: visible(pending).map((i) => this.toView(i)),
    };
  }

  /**
   * Owners invite anyone invitable; general managers invite scoped managers and staff; scoped
   * managers invite staff to their own locations.
   */
  async invite(
    actor: MembershipContext,
    inviterUserId: string,
    dto: InviteMemberDto,
  ) {
    const orgId = actor.orgId;
    const email = dto.email.toLowerCase();
    const locationIds = dto.locationIds ?? [];
    assertCanManage(actor, { role: dto.role, locationIds });
    const token = randomBytes(32).toString('base64url');
    const now = new Date();

    const invitation = await this.db.withTenant(
      { orgId, livemode: true },
      async (tx) => {
        await this.assertLocationsExist(tx, locationIds);

        // Check that the org is within its member limit before creating the invitation.
        await this.entitlements.assertWithinLimit(
          tx,
          orgId,
          'members.max',
          async (t) => {
            const [{ members }] = await t
              .select({ members: count() })
              .from(memberships)
              .where(eq(memberships.organizationId, orgId));
            const [{ invites }] = await t
              .select({ invites: count() })
              .from(invitations)
              .where(
                and(eq(invitations.organizationId, orgId), openInvitation(now)),
              );
            return members + invites;
          },
        );

        // A user belongs to at most one org.
        const [existingMember] = await tx
          .select({ organizationId: memberships.organizationId })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(eq(users.email, email));

        if (existingMember) {
          throw existingMember.organizationId === orgId
            ? new CodedException(
                HttpStatus.CONFLICT,
                'already_member',
                `${email} is already a member`,
              )
            : this.belongsToAnotherOrg(email);
        }

        // Revoke any expired invite sent to this email.
        await tx
          .update(invitations)
          .set({ revokedAt: now })
          .where(
            and(
              eq(invitations.organizationId, orgId),
              eq(invitations.email, email),
              isNull(invitations.acceptedAt),
              isNull(invitations.revokedAt),
              lte(invitations.expiresAt, now),
            ),
          );

        const [created] = await tx
          .insert(invitations)
          .values({
            organizationId: orgId,
            email,
            role: dto.role,
            locationIds,
            tokenHash: this.encryption.hash(token),
            invitedByUserId: inviterUserId,
            expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
          })
          .onConflictDoNothing()
          .returning();

        if (!created) {
          throw new CodedException(
            HttpStatus.CONFLICT,
            'invitation_exists',
            `${email} already has a pending invitation`,
          );
        }

        return created;
      },
    );

    const emailSent = await this.sendInvitationEmail(
      invitation,
      inviterUserId,
      token,
    );

    return { invitation: this.toView(invitation), emailSent };
  }

  async resendInvitation(
    actor: MembershipContext,
    inviterUserId: string,
    id: string,
  ) {
    const orgId = actor.orgId;
    await this.findManageableInvitation(actor, id);
    const token = randomBytes(32).toString('base64url');

    const [invitation] = await this.db.client
      .update(invitations)
      .set({
        tokenHash: this.encryption.hash(token),
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      })
      .where(
        and(
          eq(invitations.id, id),
          eq(invitations.organizationId, orgId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      )
      .returning();

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    const emailSent = await this.sendInvitationEmail(
      invitation,
      inviterUserId,
      token,
    );

    return { invitation: this.toView(invitation), emailSent };
  }

  async revokeInvitation(actor: MembershipContext, id: string): Promise<void> {
    const orgId = actor.orgId;
    await this.findManageableInvitation(actor, id);
    const [revoked] = await this.db.client
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(invitations.id, id),
          eq(invitations.organizationId, orgId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      )
      .returning({ id: invitations.id });

    if (!revoked) {
      throw new NotFoundException('Invitation not found');
    }
  }

  /**
   * The actor must be allowed to manage the member as they are now AND as they would be after
   * the update, so a manager can't promote staff or move them outside the manager's locations, and
   * only owners can promote a manager to general manager.
   */
  async updateMember(
    actor: MembershipContext,
    userId: string,
    dto: UpdateMemberDto,
  ) {
    const orgId = actor.orgId;
    return this.db.withTenant({ orgId, livemode: true }, async (tx) => {
      if (dto.locationIds) {
        await this.assertLocationsExist(tx, dto.locationIds);
      }

      await this.lockOrg(tx, orgId);

      const target = await this.findMember(tx, orgId, userId);
      assertCanManage(actor, target); // Before update
      assertCanManage(actor, {
        role: dto.role ?? target.role,
        locationIds: dto.locationIds ?? target.locationIds,
      }); // After update

      const [member] = await tx
        .update(memberships)
        .set({
          ...(dto.role && { role: dto.role }),
          ...(dto.locationIds && { locationIds: dto.locationIds }),
        })
        .where(
          and(
            eq(memberships.organizationId, orgId),
            eq(memberships.userId, userId),
          ),
        )
        .returning();

      if (!member) {
        throw new NotFoundException('Member not found');
      }

      await this.assertHasOwner(tx, orgId);

      return member;
    });
  }

  async removeMember(actor: MembershipContext, userId: string): Promise<void> {
    const orgId = actor.orgId;
    await this.db.withTenant({ orgId, livemode: true }, async (tx) => {
      await this.lockOrg(tx, orgId);

      const target = await this.findMember(tx, orgId, userId);
      assertCanManage(actor, target);

      const [removed] = await tx
        .delete(memberships)
        .where(
          and(
            eq(memberships.organizationId, orgId),
            eq(memberships.userId, userId),
          ),
        )
        .returning({ id: memberships.id });

      if (!removed) {
        throw new NotFoundException('Member not found');
      }

      await this.assertHasOwner(tx, orgId);
    });
  }

  async acceptInvitation(input: {
    token: string;
    name?: string;
    password?: string;
  }): Promise<string> {
    return this.db.client.transaction(async (tx) => {
      const [invitation] = await tx
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(
          and(
            eq(invitations.tokenHash, this.encryption.hash(input.token)),
            openInvitation(new Date()),
          ),
        )
        .returning();

      if (!invitation) {
        throw new CodedException(
          HttpStatus.BAD_REQUEST,
          'invalid_invitation',
          'This invitation is invalid, expired, or already used',
        );
      }

      let [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, invitation.email));

      if (!user) {
        if (!input.name || !input.password) {
          throw new BadRequestException(
            'Name and password are required to create your Nimbus account',
          );
        }

        [user] = await tx
          .insert(users)
          .values({
            email: invitation.email,
            name: input.name,
            passwordHash: await this.passwords.hash(input.password),
          })
          .returning({ id: users.id });
      }

      const [joined] = await tx
        .insert(memberships)
        .values({
          userId: user.id,
          organizationId: invitation.organizationId,
          role: invitation.role,
          locationIds: invitation.locationIds,
        })
        .onConflictDoNothing({ target: memberships.userId })
        .returning({ id: memberships.id });

      if (!joined) {
        const [current] = await tx
          .select({ organizationId: memberships.organizationId })
          .from(memberships)
          .where(eq(memberships.userId, user.id));

        if (current?.organizationId !== invitation.organizationId) {
          throw this.belongsToAnotherOrg(invitation.email);
        }
      }

      return user.id;
    });
  }

  private async findMember(tx: Transaction, orgId: string, userId: string) {
    const [member] = await tx
      .select({
        role: memberships.role,
        locationIds: memberships.locationIds,
      })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, orgId),
          eq(memberships.userId, userId),
        ),
      );

    if (!member) {
      throw new NotFoundException('Member not found');
    }

    return member;
  }

  private async findManageableInvitation(actor: MembershipContext, id: string) {
    const [invitation] = await this.db.client
      .select({ role: invitations.role, locationIds: invitations.locationIds })
      .from(invitations)
      .where(
        and(
          eq(invitations.id, id),
          eq(invitations.organizationId, actor.orgId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      );

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    assertCanManage(actor, invitation);
  }

  private belongsToAnotherOrg(email: string) {
    return new CodedException(
      HttpStatus.CONFLICT,
      'email_belongs_to_another_org',
      `${email} already belongs to another organization`,
    );
  }

  private async sendInvitationEmail(
    invitation: Invitation,
    inviterUserId: string,
    token: string,
  ): Promise<boolean> {
    const [context] = await this.db.client
      .select({ orgName: organizations.name, inviterName: users.name })
      .from(organizations)
      .innerJoin(users, eq(users.id, inviterUserId))
      .where(eq(organizations.id, invitation.organizationId));

    try {
      await this.platformMail.send(
        invitation.email,
        invitationEmail({
          orgName: context.orgName,
          inviterName: context.inviterName,
          role: invitation.role,
          acceptUrl: `${Secrets.DASHBOARD_URL}/invitations/accept?token=${token}`,
        }),
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Invitation email to ${invitation.email} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private async assertLocationsExist(tx: Transaction, ids: string[]) {
    if (!ids.length) return;

    const [{ found }] = await tx
      .select({ found: count() })
      .from(locations)
      .where(inArray(locations.id, ids));

    if (found !== ids.length) {
      throw new BadRequestException('Unknown location detected in request');
    }
  }

  private async lockOrg(tx: Transaction, orgId: string) {
    await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .for('update');
  }

  private async assertHasOwner(tx: Transaction, orgId: string) {
    const [{ owners }] = await tx
      .select({ owners: count() })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, orgId),
          eq(memberships.role, 'owner' satisfies Role),
        ),
      );

    if (owners === 0) {
      throw new CodedException(
        HttpStatus.CONFLICT,
        'last_owner',
        'An organization must keep at least one owner',
      );
    }
  }

  private toView(invitation: Invitation): InvitationView {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tokenHash, ...view } = invitation;
    return view;
  }
}
