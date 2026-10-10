import { applyDecorators, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@src/common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '@src/common/guards/org-member.guard';
import { RolesGuard } from '@src/common/guards/roles.guard';
import { ApiKeyGuard } from '@src/common/guards/api-key.guard';
import { OrgVerifiedGuard } from '@src/common/guards/org-verified.guard';
import { Roles } from './roles.decorator';
import type { Role } from '@src/db/schema/types';

export const Dashboard = (...roles: Role[]) =>
  applyDecorators(
    UseGuards(JwtAuthGuard, OrgMemberGuard, RolesGuard, OrgVerifiedGuard),
    Roles(...roles),
  );

export const PublicApi = () => applyDecorators(UseGuards(ApiKeyGuard));
