import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { CodedException } from '@src/common/errors';
import type { AuthenticatedRequest } from '@src/common/types';

@Injectable()
export class OrgMemberGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.membership) {
      throw new CodedException(
        HttpStatus.FORBIDDEN,
        'no_organization',
        'You are not a member of any organization',
      );
    }

    return true;
  }
}
