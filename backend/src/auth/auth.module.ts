import { Global, Module, OnModuleInit } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Secrets } from '@src/common/secrets';
import { OrganizationsModule } from '@src/organizations/organizations.module';
import { NotificationsModule } from '@src/notifications/notifications.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ACCESS_TOKEN_TTL_SECONDS, SessionsService } from './sessions.service';
import { SessionCleanupProcessor } from './session-cleanup.processor';
import { PasswordResetService } from './password-reset.service';

const DAY_MS = 24 * 60 * 60 * 1000;

@Global()
@Module({
  imports: [
    OrganizationsModule,
    NotificationsModule,
    JwtModule.register({
      secret: Secrets.JWT_SECRET,
      signOptions: { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    }),
    BullModule.registerQueue({ name: 'auth' }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionsService,
    PasswordResetService,
    SessionCleanupProcessor,
  ],
  exports: [JwtModule],
})
export class AuthModule implements OnModuleInit {
  constructor(@InjectQueue('auth') private readonly authQueue: Queue) {}

  async onModuleInit() {
    await this.authQueue.upsertJobScheduler(
      'session-cleanup',
      { every: DAY_MS },
      {
        name: 'session-cleanup',
        data: {},
        opts: { removeOnComplete: true },
      },
    );
  }
}
