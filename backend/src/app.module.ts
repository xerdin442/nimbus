import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import type { RedisClientType } from 'redis';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';
import { DashboardModeMiddleware } from './common/middleware/dashboard-mode.middleware';
import { applyThrottlerConfig } from './common/util';
import { REDIS_CLIENT, RedisModule } from './common/cache';
import { HelpersModule } from './common/helpers';
import { DbModule } from './db/db.module';
import { EntitlementsModule } from './entitlements/entitlements.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { LocationsModule } from './locations/locations.module';
import { ScreensModule } from './screens/screens.module';
import { MoviesModule } from './movies/movies.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot(applyThrottlerConfig()),
    BullModule.forRootAsync({
      imports: [RedisModule],
      inject: [REDIS_CLIENT],
      useFactory: (redis: RedisClientType) => ({ connection: redis }),
    }),
    DbModule,
    RedisModule,
    HelpersModule,
    EntitlementsModule,
    AuthModule,
    OrganizationsModule,
    NotificationsModule,
    PaymentsModule,
    ApiKeysModule,
    LocationsModule,
    ScreensModule,
    MoviesModule,
  ],

  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('{*path}');
    consumer.apply(DashboardModeMiddleware).forRoutes('dashboard/{*path}');
  }
}
