import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { isUUID } from 'class-validator';
import { Secrets } from '@src/common/secrets';
import { CodedException } from '@src/common/errors';
import { DbService } from '@src/db/db.service';
import { memberships, organizations, sessions } from '@src/db/schema';
import type { AuthenticatedRequest, JwtPayload } from '@src/common/types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly db: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(token, {
        secret: Secrets.JWT_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (!isUUID(payload.sid) || !isUUID(payload.sub)) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const [row] = await this.db.client
      .select({
        orgId: memberships.organizationId,
        role: memberships.role,
        locationIds: memberships.locationIds,
        isVerified: organizations.isVerified,
      })
      .from(sessions)
      .leftJoin(memberships, eq(memberships.userId, sessions.userId))
      .leftJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(
        and(
          eq(sessions.id, payload.sid),
          eq(sessions.userId, payload.sub),
          isNull(sessions.revokedAt),
        ),
      );

    if (!row) {
      throw new CodedException(
        HttpStatus.UNAUTHORIZED,
        'session_revoked',
        'This session was signed out',
      );
    }

    request.user = { id: payload.sub, sessionId: payload.sid };

    if (row.orgId && row.role) {
      request.membership = {
        orgId: row.orgId,
        role: row.role,
        locationIds: row.role === 'owner' ? [] : (row.locationIds ?? []),
        isVerified: row.isVerified ?? false,
      };
    }

    return true;
  }

  private extractToken(request: Request): string | null {
    const header = request.headers.authorization;

    if (header) {
      const [type, token] = header.split(' ');

      if (type === 'Bearer' && token) {
        return token;
      }
    }

    return null;
  }
}
