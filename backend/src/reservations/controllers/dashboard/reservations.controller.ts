import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Dashboard } from '@src/common/decorators/auth.decorators';
import {
  CurrentMembership,
  CurrentTenant,
  CurrentUser,
} from '@src/common/decorators/request.decorators';
import { VerifiedOrgForLive } from '@src/common/decorators/verified-org.decorator';
import type {
  AuthenticatedUser,
  MembershipContext,
  TenantContext,
} from '@src/common/types';
import { ReservationsService } from '../../reservations.service';
import {
  BoxOfficeSaleDto,
  ListReservationsQueryDto,
  RefundReservationDto,
} from '../../dto/reservation.dto';

@Controller('dashboard/reservations')
export class DashboardReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get()
  @Dashboard()
  list(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Query() query: ListReservationsQueryDto,
  ) {
    return this.reservations.list(tenant, membership, query);
  }

  /** Box-office sale (cash/POS): confirmed at once, tickets issued. */
  @Post('box-office')
  @Dashboard()
  @VerifiedOrgForLive()
  sell(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BoxOfficeSaleDto,
  ) {
    return this.reservations.sell(tenant, membership, user.id, dto);
  }

  @Get(':id')
  @Dashboard()
  get(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reservations.get(tenant, id, membership);
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  @Dashboard('owner', 'manager')
  refund(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundReservationDto,
  ) {
    return this.reservations.refund(tenant, id, {
      reason: 'requested',
      membership,
      userId: user.id,
      note: dto.note,
    });
  }
}
