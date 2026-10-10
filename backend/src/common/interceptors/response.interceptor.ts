import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      map<unknown, unknown>((data) => {
        if (isStreamOrBuffer(data)) {
          return data;
        }

        if (typeof data === 'object' && data !== null) {
          if ('data' in data && 'meta' in data) {
            return data;
          }
        }

        return { data };
      }),
    );
  }
}

function isStreamOrBuffer(data: unknown): boolean {
  if (Buffer.isBuffer(data)) {
    return true;
  }

  return typeof data === 'object' && data !== null && 'pipe' in data;
}
