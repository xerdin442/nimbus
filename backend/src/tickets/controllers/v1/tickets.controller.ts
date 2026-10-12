import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { PublicApi } from '@src/common/decorators/auth.decorators';
import { ApiKeyType } from '@src/common/decorators/api-key-type.decorator';
import { CurrentTenant } from '@src/common/decorators/request.decorators';
import type { TenantContext } from '@src/common/types';
import { TicketsService } from '../../tickets.service';

@Controller({ path: 'tickets', version: '1' })
@PublicApi()
@ApiKeyType('secret')
export class V1TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get(':id/qr')
  qr(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tickets.qrPng(tenant, id);
  }
}
