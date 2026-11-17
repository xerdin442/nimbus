import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { Dashboard } from '@src/common/decorators/auth.decorators';
import {
  CurrentMembership,
  CurrentTenant,
} from '@src/common/decorators/request.decorators';
import { RequiresFeature } from '@src/common/decorators/requires-feature.decorator';
import type { MembershipContext, TenantContext } from '@src/common/types';
import { ReportsService } from './reports.service';
import { ListReportShowtimesQueryDto, ReportRangeDto } from './dto/report.dto';

@Controller('dashboard/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  @Dashboard('owner', 'manager')
  summary(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Query() query: ReportRangeDto,
  ) {
    return this.reports.summary(tenant, membership, query);
  }

  @Get('showtimes')
  @Dashboard('owner', 'manager')
  showtimes(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Query() query: ListReportShowtimesQueryDto,
  ) {
    return this.reports.showtimes(tenant, membership, query);
  }

  @Get('export')
  @Dashboard('owner', 'manager')
  @RequiresFeature('reports.export')
  async export(
    @CurrentTenant() tenant: TenantContext,
    @CurrentMembership() membership: MembershipContext,
    @Query() query: ReportRangeDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { filename, csv } = await this.reports.exportCsv(
      tenant,
      membership,
      query,
    );
    response.set({
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(Buffer.from(csv, 'utf8'));
  }
}
