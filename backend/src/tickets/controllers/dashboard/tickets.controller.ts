import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Dashboard } from '@src/common/decorators/auth.decorators';
import {
  CurrentMembership,
  CurrentTenant,
  CurrentUser,
} from '@src/common/decorators/request.decorators';
import type {
  AuthenticatedUser,
  MembershipContext,
  TenantContext,
} from '@src/common/types';
import { TicketsService } from '../../tickets.service';
import { ScanTicketDto } from '../../dto/scan.dto';

@Controller('dashboard/tickets')
export class DashboardTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Post('scan')
  @HttpCode(HttpStatus.OK)
  @Dashboard()
  scan(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ScanTicketDto,
  ) {
    return this.tickets.scan(tenant, membership, user.id, dto);
  }

  @Get(':id/qr')
  @Dashboard()
  qr(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tickets.qrPng(tenant, id, membership);
  }
}
