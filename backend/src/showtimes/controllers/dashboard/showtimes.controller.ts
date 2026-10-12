import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Dashboard } from '@src/common/decorators/auth.decorators';
import {
  CurrentMembership,
  CurrentTenant,
} from '@src/common/decorators/request.decorators';
import type { MembershipContext, TenantContext } from '@src/common/types';
import { ShowtimesService } from '../../showtimes.service';
import {
  CreateShowtimeDto,
  ListShowtimesQueryDto,
  UpdateShowtimeDto,
} from '../../dto/showtime.dto';

@Controller('dashboard/showtimes')
export class DashboardShowtimesController {
  constructor(private readonly showtimes: ShowtimesService) {}

  /** GET /dashboard/showtimes?locationId=&date=YYYY-MM-DD (location's local day, default today). */
  @Get()
  @Dashboard()
  list(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Query() query: ListShowtimesQueryDto,
  ) {
    return this.showtimes.list(tenant, membership, query);
  }

  @Post()
  @Dashboard('owner', 'manager')
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Body() dto: CreateShowtimeDto,
  ) {
    return this.showtimes.create(tenant, membership, dto);
  }

  @Get(':id')
  @Dashboard()
  get(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.showtimes.get(tenant, membership, id);
  }

  @Patch(':id')
  @Dashboard('owner', 'manager')
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShowtimeDto,
  ) {
    return this.showtimes.update(tenant, membership, id, dto);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @Dashboard('owner', 'manager')
  publish(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.showtimes.publish(tenant, membership, id);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @Dashboard('owner', 'manager')
  unpublish(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.showtimes.unpublish(tenant, membership, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Dashboard('owner', 'manager')
  cancel(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.showtimes.cancel(tenant, membership, id);
  }

  /** The box office's seat picker, in the dashboard's current mode. */
  @Get(':id/seats')
  @Dashboard()
  seats(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.showtimes.seatMap(tenant, id, membership);
  }
}
