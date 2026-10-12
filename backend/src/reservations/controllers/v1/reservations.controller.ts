import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { PublicApi } from '@src/common/decorators/auth.decorators';
import { ApiKeyType } from '@src/common/decorators/api-key-type.decorator';
import { CurrentTenant } from '@src/common/decorators/request.decorators';
import { IdempotencyInterceptor } from '@src/common/interceptors/idempotency.interceptor';
import type { TenantContext } from '@src/common/types';
import { ReservationsService } from '../../reservations.service';
import { CreateReservationDto } from '../../dto/reservation.dto';

/** Storefront booking: secret key only, called from the org's server. */
@Controller({ path: 'reservations', version: '1' })
@PublicApi()
@ApiKeyType('secret')
export class V1ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateReservationDto,
  ) {
    return this.reservations.create(tenant, dto);
  }

  @Get(':id')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reservations.get(tenant, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reservations.cancel(tenant, id);
  }
}
