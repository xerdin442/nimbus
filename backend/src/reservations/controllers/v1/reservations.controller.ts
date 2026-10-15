import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { PublicApi } from '@src/common/decorators/auth.decorators';
import { ApiKeyType } from '@src/common/decorators/api-key-type.decorator';
import { CurrentTenant } from '@src/common/decorators/request.decorators';
import { IdempotencyInterceptor } from '@src/common/interceptors/idempotency.interceptor';
import { PaymentProviderAvailableGuard } from '@src/common/guards/payment-provider-available.guard';
import type { TenantContext } from '@src/common/types';
import { ReservationsService } from '../../reservations.service';
import { CheckoutDto, CreateReservationDto } from '../../dto/reservation.dto';

/** Storefront booking: secret key only, called from the org's server. */
@Controller({ path: 'reservations', version: '1' })
@PublicApi()
@ApiKeyType('secret')
export class V1ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Post()
  @UseGuards(PaymentProviderAvailableGuard)
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

  @Post(':id/checkout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PaymentProviderAvailableGuard)
  @UseInterceptors(IdempotencyInterceptor)
  checkout(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CheckoutDto,
  ) {
    return this.reservations.checkout(tenant, id, dto);
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
