import { Module } from '@nestjs/common';
import { DashboardTicketsController } from './controllers/dashboard/tickets.controller';
import { V1TicketsController } from './controllers/v1/tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  controllers: [DashboardTicketsController, V1TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
