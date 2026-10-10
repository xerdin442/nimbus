import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '@src/common/decorators/roles.decorator';
import { CodedException } from '@src/common/errors';
import type { DashboardRequest } from '@src/common/types';
import type { Role } from '@src/db/schema/types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!roles?.length) {
      return true;
    }

    const { membership } = context
      .switchToHttp()
      .getRequest<DashboardRequest>();

    if (!roles.includes(membership.role)) {
      throw new CodedException(
        HttpStatus.FORBIDDEN,
        'insufficient_role',
        `This action requires one of: ${roles.join(', ')}`,
      );
    }

    return true;
  }
}
