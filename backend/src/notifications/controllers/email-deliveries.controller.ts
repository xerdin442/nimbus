import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Dashboard } from '@src/common/decorators/auth.decorators';
import { CurrentTenant } from '@src/common/decorators/request.decorators';
import type { TenantContext } from '@src/common/types';
import { EmailsService } from '../emails.service';
import {
  ListEmailDeliveriesQueryDto,
  RetryEmailDeliveriesDto,
} from '../dto/email-delivery.dto';

@Dashboard('owner', 'manager')
@Controller('dashboard/emails/deliveries')
export class EmailDeliveriesController {
  constructor(private readonly emails: EmailsService) {}

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: ListEmailDeliveriesQueryDto,
  ) {
    return this.emails.list(tenant, query);
  }

  @Get(':id/preview')
  preview(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.emails.preview(tenant, id);
  }

  @Post('retry')
  retryMany(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: RetryEmailDeliveriesDto,
  ) {
    return this.emails.retry(tenant, dto);
  }

  @Post(':id/retry')
  retryOne(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.emails.retry(tenant, { ids: [id] }, { single: true });
  }
}
