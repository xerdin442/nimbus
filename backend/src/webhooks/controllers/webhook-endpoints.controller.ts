import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Dashboard } from '@src/common/decorators/auth.decorators';
import { CurrentTenant } from '@src/common/decorators/request.decorators';
import type { TenantContext } from '@src/common/types';
import { EndpointsService } from '../endpoints.service';
import {
  CreateWebhookEndpointDto,
  UpdateWebhookEndpointDto,
} from '../dto/webhook-endpoint.dto';

@Dashboard('owner')
@Controller('dashboard/webhooks/endpoints')
export class WebhookEndpointsController {
  constructor(private readonly endpoints: EndpointsService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext) {
    return this.endpoints.list(tenant);
  }

  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateWebhookEndpointDto,
  ) {
    return this.endpoints.create(tenant, dto);
  }

  @Post(':id/rotate')
  @HttpCode(HttpStatus.OK)
  rotate(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.endpoints.rotate(tenant, id);
  }

  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebhookEndpointDto,
  ) {
    return this.endpoints.update(tenant, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.endpoints.remove(tenant, id);
  }
}
