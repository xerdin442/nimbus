import { HttpStatus, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '@src/db/db.service';
import { mailConfigs, organizations, users } from '@src/db/schema';
import type { MailConfig } from '@src/db/schema/types';
import type { MailConfigView } from '@src/common/types';
import { EncryptionService } from '@src/common/helpers';
import { CodedException } from '@src/common/errors';
import { OrgVerificationService } from '@src/organizations/org-verification.service';
import { MailProviderFactory } from './providers/mail-provider.factory';
import { MailProviderError } from './providers/mail-provider.interface';
import { mailConnectionTestEmail } from './templates';
import { ConnectMailConfigDto } from './dto/mail-config.dto';

@Injectable()
export class MailConfigService {
  constructor(
    private readonly db: DbService,
    private readonly encryption: EncryptionService,
    private readonly providers: MailProviderFactory,
    private readonly verification: OrgVerificationService,
  ) {}

  async get(orgId: string): Promise<MailConfigView | null> {
    const [config] = await this.db.withTenant({ orgId, livemode: true }, (tx) =>
      tx.select().from(mailConfigs),
    );

    return config ? this.toView(config) : null;
  }

  async connect(
    orgId: string,
    userId: string,
    dto: ConnectMailConfigDto,
  ): Promise<{ config: MailConfigView; isVerified: boolean }> {
    const [context] = await this.db.client
      .select({ email: users.email, orgName: organizations.name })
      .from(users)
      .innerJoin(organizations, eq(organizations.id, orgId))
      .where(eq(users.id, userId));

    try {
      await this.providers.create(dto.provider, dto.apiKey).send({
        from: `${dto.fromName} <${dto.fromEmail}>`,
        to: context.email,
        replyTo: dto.replyTo,
        ...mailConnectionTestEmail({
          orgName: context.orgName,
          provider: dto.provider,
        }),
      });
    } catch (error) {
      if (error instanceof MailProviderError) {
        throw new CodedException(
          error.kind === 'unavailable'
            ? HttpStatus.BAD_GATEWAY
            : HttpStatus.UNPROCESSABLE_ENTITY,
          'mail_connection_failed',
          `${dto.provider} rejected the test email: ${error.message}`,
          { reason: error.kind },
        );
      }
      throw error;
    }

    const values = {
      provider: dto.provider,
      encryptedApiKey: this.encryption.encrypt(dto.apiKey),
      fromEmail: dto.fromEmail,
      fromName: dto.fromName,
      replyTo: dto.replyTo ?? null,
      status: 'verified' as const,
      lastError: null,
      verifiedAt: new Date(),
    };

    return this.db.withTenant({ orgId, livemode: true }, async (tx) => {
      const [config] = await tx
        .insert(mailConfigs)
        .values({ organizationId: orgId, ...values })
        .onConflictDoUpdate({ target: mailConfigs.organizationId, set: values })
        .returning();

      const isVerified = await this.verification.refresh(tx, orgId);

      return { config: this.toView(config), isVerified };
    });
  }

  private toView(config: MailConfig): MailConfigView {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { encryptedApiKey, organizationId, ...view } = config;
    return view;
  }
}
