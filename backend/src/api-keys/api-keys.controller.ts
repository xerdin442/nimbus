import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Dashboard } from '@src/common/decorators/auth.decorators';
import {
  CurrentTenant,
  CurrentUser,
} from '@src/common/decorators/request.decorators';
import { VerifiedOrgForLive } from '@src/common/decorators/verified-org.decorator';
import type { TenantContext } from '@src/common/types';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/api-key.dto';

@Dashboard('owner')
@Controller('dashboard/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext) {
    return this.apiKeys.list(tenant);
  }

  @Post()
  @VerifiedOrgForLive()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.apiKeys.create(tenant, user.id, dto.type);
  }

  @Post(':id/roll')
  @HttpCode(HttpStatus.OK)
  @VerifiedOrgForLive()
  roll(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.apiKeys.roll(tenant, user.id, id);
  }

  @Delete(':id')
  revoke(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.apiKeys.revoke(tenant, id);
  }
}
