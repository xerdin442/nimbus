import { Global, Module, OnModuleInit } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Secrets } from '@src/common/secrets';
import { AUTH_QUEUE, SESSION_CLEANUP_JOB } from '@src/common/types/constants';
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
    BullModule.registerQueue({ name: AUTH_QUEUE }),
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
  constructor(@InjectQueue(AUTH_QUEUE) private readonly authQueue: Queue) {}

  async onModuleInit() {
    await this.authQueue.upsertJobScheduler(
      SESSION_CLEANUP_JOB,
      { every: DAY_MS },
      {
        name: SESSION_CLEANUP_JOB,
        data: {},
        opts: { removeOnComplete: true },
      },
    );
  }
}
