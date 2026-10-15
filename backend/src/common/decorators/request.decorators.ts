import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type {
  ApiKeyContext,
  ApiKeyRequest,
  AuthenticatedRequest,
  AuthenticatedUser,
  DashboardRequest,
  MembershipContext,
  TenantContext,
} from '@src/common/types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);

export const CurrentMembership = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): MembershipContext =>
    ctx.switchToHttp().getRequest<DashboardRequest>().membership,
);

export const CurrentApiKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApiKeyContext =>
    ctx.switchToHttp().getRequest<ApiKeyRequest>().apiKey,
);

/** Org and mode of an API-key or dashboard request, once its auth guard has run. */
export const tenantOf = (
  request: Partial<DashboardRequest & ApiKeyRequest>,
): TenantContext =>
  request.apiKey
    ? { orgId: request.apiKey.orgId, livemode: request.apiKey.livemode }
    : { orgId: request.membership!.orgId, livemode: request.livemode ?? true };

export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext =>
    tenantOf(ctx.switchToHttp().getRequest()),
);
