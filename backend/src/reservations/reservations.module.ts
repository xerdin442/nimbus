import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OrganizationsModule } from '@src/organizations/organizations.module';
import { ShowtimesModule } from '@src/showtimes/showtimes.module';
import { TicketsModule } from '@src/tickets/tickets.module';
import { PaymentsModule } from '@src/payments/payments.module';
import { DashboardReservationsController } from './controllers/dashboard/reservations.controller';
import { V1ReservationsController } from './controllers/v1/reservations.controller';
import { ReservationsService } from './reservations.service';
import { ReservationsProcessor } from './reservations.processor';
import { ReservationsListener } from './reservations.listener';
import { RESERVATIONS_QUEUE } from '@src/common/types/constants';

@Module({
  imports: [
    OrganizationsModule,
    ShowtimesModule,
    TicketsModule,
    PaymentsModule,
    BullModule.registerQueue({ name: RESERVATIONS_QUEUE }),
  ],
  controllers: [DashboardReservationsController, V1ReservationsController],
  providers: [ReservationsService, ReservationsProcessor, ReservationsListener],
  exports: [ReservationsService],
})
export class ReservationsModule {}
