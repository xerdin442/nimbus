import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OrganizationsModule } from '@src/organizations/organizations.module';
import { ShowtimesModule } from '@src/showtimes/showtimes.module';
import { TicketsModule } from '@src/tickets/tickets.module';
import { PaymentsModule } from '@src/payments/payments.module';
import { DashboardReservationsController } from './controllers/dashboard/reservations.controller';
import { V1ReservationsController } from './controllers/v1/reservations.controller';
import {
  RESERVATIONS_QUEUE,
  ReservationsService,
} from './reservations.service';
import { ReservationExpiryProcessor } from './expiry.processor';

@Module({
  imports: [
    OrganizationsModule,
    ShowtimesModule,
    TicketsModule,
    PaymentsModule,
    BullModule.registerQueue({ name: RESERVATIONS_QUEUE }),
  ],
  controllers: [DashboardReservationsController, V1ReservationsController],
  providers: [ReservationsService, ReservationExpiryProcessor],
  exports: [ReservationsService],
})
export class ReservationsModule {}
