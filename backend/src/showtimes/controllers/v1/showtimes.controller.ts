import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { PublicApi } from '@src/common/decorators/auth.decorators';
import { CurrentTenant } from '@src/common/decorators/request.decorators';
import type { TenantContext } from '@src/common/types';
import { ShowtimesService } from '../../showtimes.service';
import { LocalDateQueryDto } from '../../dto/showtime.dto';

/** Catalog reads for storefronts — publishable or secret key. */
@Controller({ version: '1' })
@PublicApi()
export class V1ShowtimesController {
  constructor(private readonly showtimes: ShowtimesService) {}

  /** GET /api/v1/locations/:locationId/showtimes?date=YYYY-MM-DD (local day, default today). */
  @Get('locations/:locationId/showtimes')
  listForLocation(
    @CurrentTenant() tenant: TenantContext,
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Query() query: LocalDateQueryDto,
  ) {
    return this.showtimes.listPublished(tenant, locationId, query.date);
  }

  /** GET /api/v1/locations/:locationId/movies — movies with upcoming showtimes. */
  @Get('locations/:locationId/movies')
  listMovies(
    @CurrentTenant() tenant: TenantContext,
    @Param('locationId', ParseUUIDPipe) locationId: string,
  ) {
    return this.showtimes.listLocationMovies(tenant, locationId);
  }

  @Get('showtimes/:id')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.showtimes.getPublished(tenant, id);
  }

  @Get('showtimes/:id/seats')
  seats(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.showtimes.seatMap(tenant, id);
  }
}
