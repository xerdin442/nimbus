import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Dashboard } from '@src/common/decorators/auth.decorators';
import {
  CurrentMembership,
  CurrentTenant,
} from '@src/common/decorators/request.decorators';
import type { MembershipContext, TenantContext } from '@src/common/types';
import { MoviesService } from '../../movies.service';
import {
  CreateMovieDto,
  ListMoviesQueryDto,
  UpdateMovieDto,
} from '../../dto/movie.dto';

@Controller('dashboard/movies')
export class DashboardMoviesController {
  constructor(private readonly movies: MoviesService) {}

  @Get()
  @Dashboard()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: ListMoviesQueryDto,
  ) {
    return this.movies.list(tenant, query);
  }

  @Post()
  @Dashboard('owner', 'manager')
  create(@CurrentTenant() tenant: TenantContext, @Body() dto: CreateMovieDto) {
    return this.movies.create(tenant, dto);
  }

  @Get(':id')
  @Dashboard()
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.movies.get(tenant, id);
  }

  @Patch(':id')
  @Dashboard('owner', 'manager')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMovieDto,
  ) {
    return this.movies.update(tenant, id, dto);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @Dashboard('owner', 'manager')
  archive(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.movies.setArchived(tenant, membership, id, true);
  }

  @Post(':id/unarchive')
  @HttpCode(HttpStatus.OK)
  @Dashboard('owner', 'manager')
  unarchive(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.movies.setArchived(tenant, membership, id, false);
  }
}
