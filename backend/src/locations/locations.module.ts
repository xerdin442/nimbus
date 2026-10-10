import { Module } from '@nestjs/common';
import { DashboardLocationsController } from './controllers/dashboard/locations.controller';
import { V1LocationsController } from './controllers/v1/locations.controller';
import { LocationsService } from './locations.service';

@Module({
  controllers: [DashboardLocationsController, V1LocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
