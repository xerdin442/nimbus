import { Module } from '@nestjs/common';
import { OrganizationsModule } from '@src/organizations/organizations.module';
import { DashboardShowtimesController } from './controllers/dashboard/showtimes.controller';
import { V1ShowtimesController } from './controllers/v1/showtimes.controller';
import { ShowtimesService } from './showtimes.service';
import { SeatInventoryService } from './seat-inventory.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [DashboardShowtimesController, V1ShowtimesController],
  providers: [ShowtimesService, SeatInventoryService],
  exports: [ShowtimesService, SeatInventoryService],
})
export class ShowtimesModule {}
