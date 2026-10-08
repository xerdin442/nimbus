export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

/**
 * Which tenant and which mode a database transaction runs as.
 * Set by `DbService.withTenant()` and enforced by RLS policies.
 */
export interface TenantContext {
  orgId: string;
  livemode: boolean;
}
