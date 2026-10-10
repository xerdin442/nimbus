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
  Put,
} from '@nestjs/common';
import { Dashboard } from '@src/common/decorators/auth.decorators';
import {
  CurrentMembership,
  CurrentTenant,
} from '@src/common/decorators/request.decorators';
import type { MembershipContext, TenantContext } from '@src/common/types';
import { ScreensService } from './screens.service';
import {
  CreateScreenDto,
  SaveLayoutDto,
  UpdateScreenDto,
} from './dto/screen.dto';

@Controller('dashboard')
export class ScreensController {
  constructor(private readonly screens: ScreensService) {}

  @Get('locations/:locationId/screens')
  @Dashboard()
  list(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('locationId', ParseUUIDPipe) locationId: string,
  ) {
    return this.screens.listForLocation(tenant, membership, locationId);
  }

  @Post('locations/:locationId/screens')
  @Dashboard('owner', 'manager')
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Body() dto: CreateScreenDto,
  ) {
    return this.screens.create(tenant, membership, locationId, dto);
  }

  @Get('screens/:id')
  @Dashboard()
  get(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.screens.get(tenant, membership, id);
  }

  @Patch('screens/:id')
  @Dashboard('owner', 'manager')
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateScreenDto,
  ) {
    return this.screens.update(tenant, membership, id, dto);
  }

  @Post('screens/:id/archive')
  @HttpCode(HttpStatus.OK)
  @Dashboard('owner', 'manager')
  archive(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.screens.archive(tenant, membership, id);
  }

  @Post('screens/:id/unarchive')
  @HttpCode(HttpStatus.OK)
  @Dashboard('owner', 'manager')
  unarchive(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.screens.unarchive(tenant, membership, id);
  }

  @Get('screens/:id/layout')
  @Dashboard()
  getLayout(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.screens.getCurrentLayout(tenant, membership, id);
  }

  @Put('screens/:id/layout')
  @Dashboard('owner', 'manager')
  saveLayout(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveLayoutDto,
  ) {
    return this.screens.saveLayout(tenant, membership, id, dto);
  }
}
