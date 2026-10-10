import { Controller, Get } from '@nestjs/common';
import { PublicApi } from '@src/common/decorators/auth.decorators';
import { CurrentTenant } from '@src/common/decorators/request.decorators';
import type { TenantContext } from '@src/common/types';
import { LocationsService } from '../../locations.service';

/** GET /api/v1/locations — publishable or secret key. */
@Controller({ path: 'locations', version: '1' })
@PublicApi()
export class V1LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext) {
    return this.locations.listActive(tenant);
  }
}
