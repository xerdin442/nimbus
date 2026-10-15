import { HttpException, HttpStatus } from '@nestjs/common';

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_EXCLUSION_VIOLATION = '23P01';

/** Wrapper for Postgres SQLSTATE codes the app handles. */
export const isPgError = (error: unknown, code: string): boolean =>
  (error as { cause?: { code?: string } })?.cause?.code === code;

export class CodedException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super({ error: code, message, details }, status);
  }
}
