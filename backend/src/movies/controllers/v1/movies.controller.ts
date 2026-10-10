import { Controller, Get, Query } from '@nestjs/common';
import { PublicApi } from '@src/common/decorators/auth.decorators';
import { CurrentTenant } from '@src/common/decorators/request.decorators';
import { PaginationDto } from '@src/common/dto/pagination.dto';
import type { TenantContext } from '@src/common/types';
import { MoviesService } from '../../movies.service';

/** GET /api/v1/movies — publishable or secret key. */
@Controller({ path: 'movies', version: '1' })
@PublicApi()
export class V1MoviesController {
  constructor(private readonly movies: MoviesService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext, @Query() query: PaginationDto) {
    return this.movies.list(tenant, query);
  }
}
