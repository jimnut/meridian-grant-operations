/**
 * Error taxonomy.
 *
 * Only `ApiError` messages ever reach the client. Anything else is logged
 * server-side and reported as a generic message, so stack traces, SQL text and
 * filesystem paths cannot leak into the UI.
 */

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA'
  | 'RATE_LIMITED'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields: Record<string, string> | undefined;

  constructor(code: ErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
    this.fields = fields;
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new ApiError('BAD_REQUEST', message, fields);

export const validationError = (message: string, fields?: Record<string, string>) =>
  new ApiError('VALIDATION', message, fields);

export const unauthenticated = (message = 'Sign in to continue.') => new ApiError('UNAUTHENTICATED', message);

export const forbidden = (message = 'Your role does not allow this action.') => new ApiError('FORBIDDEN', message);

/**
 * Used for records that either do not exist or belong to another tenant.
 * The message is identical in both cases so a probe cannot distinguish them.
 */
export const notFound = (what = 'Record') => new ApiError('NOT_FOUND', `${what} not found.`);

export const conflict = (message: string) => new ApiError('CONFLICT', message);
