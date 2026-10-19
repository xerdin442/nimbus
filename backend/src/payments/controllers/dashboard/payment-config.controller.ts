import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
} from '@nestjs/common';
import { Dashboard } from '@src/common/decorators/auth.decorators';
import { CurrentTenant } from '@src/common/decorators/request.decorators';
import type { TenantContext } from '@src/common/types';
import { PaymentConfigService } from '../../payment-config.service';
import { ConnectPaymentConfigDto } from '../../dto/payment-config.dto';

@Dashboard('owner')
@Controller('dashboard/payment-config')
export class DashboardPaymentConfigController {
  constructor(private readonly paymentConfig: PaymentConfigService) {}

  @Get()
  get(@CurrentTenant() tenant: TenantContext) {
    return this.paymentConfig.get(tenant);
  }

  @Put()
  connect(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: ConnectPaymentConfigDto,
  ) {
    return this.paymentConfig.connect(tenant, dto.secretKey);
  }

  @Post('webhooks/verify')
  @HttpCode(HttpStatus.OK)
  verifyWebhook(@CurrentTenant() tenant: TenantContext) {
    return this.paymentConfig.verifyWebhook(tenant);
  }
}
