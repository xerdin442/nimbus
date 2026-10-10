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
import { ListArchivedQueryDto } from '@src/common/dto/archived-query.dto';
import type { MembershipContext, TenantContext } from '@src/common/types';
import { LocationsService } from '../../locations.service';
import { CreateLocationDto, UpdateLocationDto } from '../../dto/location.dto';

@Controller('dashboard/locations')
export class DashboardLocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @Dashboard()
  list(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Query() query: ListArchivedQueryDto,
  ) {
    return this.locations.list(tenant, membership, query.archived);
  }

  @Post()
  @Dashboard('owner', 'manager')
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Body() dto: CreateLocationDto,
  ) {
    return this.locations.create(tenant, membership, dto);
  }

  @Get(':id')
  @Dashboard()
  get(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.locations.get(tenant, membership, id);
  }

  @Patch(':id')
  @Dashboard('owner', 'manager')
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.locations.update(tenant, membership, id, dto);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @Dashboard('owner', 'manager')
  archive(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.locations.archive(tenant, membership, id);
  }

  @Post(':id/unarchive')
  @HttpCode(HttpStatus.OK)
  @Dashboard('owner', 'manager')
  unarchive(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.locations.unarchive(tenant, membership, id);
  }
}
