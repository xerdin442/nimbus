import {
  BadRequestException,
  Injectable,
  NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { DashboardRequest } from '@src/common/types';

export const MODE_HEADER = 'x-nimbus-mode';

@Injectable()
export class DashboardModeMiddleware implements NestMiddleware {
  use(req: DashboardRequest, _res: Response, next: NextFunction) {
    const mode = req.headers[MODE_HEADER];

    if (mode !== undefined && mode !== 'test' && mode !== 'live') {
      throw new BadRequestException('X-Nimbus-Mode must be "test" or "live"');
    }

    req.livemode = mode !== 'test';
    next();
  }
}
