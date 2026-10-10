import { HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '@src/db/db.service';
import { memberships, organizations, users } from '@src/db/schema';
import type { User } from '@src/db/schema/types';
import { PasswordService } from '@src/common/helpers';
import { CodedException } from '@src/common/errors';
import { OrganizationsService } from '@src/organizations/organizations.service';
import { MembersService } from '@src/organizations/members.service';
import type { ClientInfo } from '@src/common/types';
import { SessionsService } from './sessions.service';
import { AcceptInvitationDto, LoginDto, SignupDto } from './dto/auth.dto';

const isUniqueViolation = (error: unknown) =>
  (error as { cause?: { code?: string } })?.cause?.code === '23505';

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly sessions: SessionsService,
    private readonly passwords: PasswordService,
    private readonly organizations: OrganizationsService,
    private readonly members: MembersService,
  ) {}

  async signup(dto: SignupDto, client: ClientInfo) {
    const email = dto.email.toLowerCase();
    const passwordHash = await this.passwords.hash(dto.password);

    try {
      const { user, organization } = await this.db.client.transaction(
        async (tx) => {
          const [user] = await tx
            .insert(users)
            .values({ email, name: dto.name, passwordHash })
            .returning();
          const organization = await this.organizations.createWithOwner(
            tx,
            dto.organization,
            user,
          );
          return { user, organization };
        },
      );

      return {
        user: this.toUserView(user),
        organization,
        tokens: await this.sessions.start(user.id, client),
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new CodedException(
          HttpStatus.CONFLICT,
          'email_already_exists',
          'An account with this email already exists',
        );
      }
      throw error;
    }
  }

  async login(dto: LoginDto, client: ClientInfo) {
    const [user] = await this.db.client
      .select()
      .from(users)
      .where(eq(users.email, dto.email.toLowerCase()));

    const valid = await this.passwords.verify(dto.password, user?.passwordHash);

    if (!user || !valid) {
      throw new CodedException(
        HttpStatus.UNAUTHORIZED,
        'invalid_credentials',
        'Invalid email or password',
      );
    }

    return {
      tokens: await this.sessions.start(user.id, client),
      ...(await this.me(user.id)),
    };
  }

  async acceptInvitation(dto: AcceptInvitationDto, client: ClientInfo) {
    const userId = await this.members.acceptInvitation(dto);
    return {
      tokens: await this.sessions.start(userId, client),
      ...(await this.me(userId)),
    };
  }

  async me(userId: string) {
    const [user] = await this.db.client
      .select()
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const [organization] = await this.db.client
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        isVerified: organizations.isVerified,
        role: memberships.role,
        locationIds: memberships.locationIds,
      })
      .from(memberships)
      .innerJoin(
        organizations,
        eq(organizations.id, memberships.organizationId),
      )
      .where(eq(memberships.userId, userId));

    return {
      user: this.toUserView(user),
      organization: organization ?? null,
    };
  }

  private toUserView(user: User) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...view } = user;
    return view;
  }
}
