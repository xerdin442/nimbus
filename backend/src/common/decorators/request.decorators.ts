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

export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const request = ctx
      .switchToHttp()
      .getRequest<Partial<DashboardRequest & ApiKeyRequest>>();

    if (request.apiKey) {
      return { orgId: request.apiKey.orgId, livemode: request.apiKey.livemode };
    }

    return {
      orgId: request.membership!.orgId,
      livemode: request.livemode ?? true,
    };
  },
);
