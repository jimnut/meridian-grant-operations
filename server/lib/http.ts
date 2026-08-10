import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type output, type ZodTypeAny } from 'zod';

import { config } from '../config';
import { ApiError, validationError } from './errors';
import type { ApiErrorBody } from '../../shared/types';

/** Wraps an async handler so rejected promises reach the error middleware. */
export function handler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Parse and validate a request body, converting Zod issues to field errors.
 * Generic over the schema so transformed output types (money → cents, '' → null)
 * flow through to callers instead of the raw input type.
 */
export function parseBody<S extends ZodTypeAny>(schema: S, body: unknown): output<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data as output<S>;
  throw toValidationError(result.error);
}

export function parseQuery<S extends ZodTypeAny>(schema: S, query: unknown): output<S> {
  const result = schema.safeParse(query);
  if (result.success) return result.data as output<S>;
  throw toValidationError(result.error);
}

function toValidationError(error: ZodError): ApiError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    if (!fields[key]) fields[key] = issue.message;
  }
  const first = error.issues[0];
  const message = first ? first.message : 'Some fields need attention.';
  return validationError(message, fields);
}

/** Terminal error middleware — the only place that formats an error for the client. */
export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    const body: ApiErrorBody = {
      error: { message: err.message, code: err.code, ...(err.fields ? { fields: err.fields } : {}) },
    };
    res.status(err.status).json(body);
    return;
  }

  if (err instanceof ZodError) {
    const apiError = toValidationError(err);
    res.status(apiError.status).json({
      error: { message: apiError.message, code: apiError.code, fields: apiError.fields },
    } satisfies ApiErrorBody);
    return;
  }

  const code = (err as { code?: string } | null)?.code;
  const type = (err as { type?: string } | null)?.type;
  const status = (err as { status?: number; statusCode?: number } | null) ?? {};

  // Body parser: malformed JSON is the caller's mistake, not a server fault.
  if (err instanceof SyntaxError && (type === 'entity.parse.failed' || (status.status ?? status.statusCode) === 400)) {
    respond(res, 400, 'BAD_REQUEST', 'That request body is not valid JSON.');
    return;
  }
  if (type === 'entity.too.large' || code === 'LIMIT_FIELD_VALUE' || code === 'LIMIT_FIELD_COUNT') {
    respond(res, 413, 'PAYLOAD_TOO_LARGE', 'That request is larger than the server accepts.');
    return;
  }
  if (type === 'encoding.unsupported') {
    respond(res, 415, 'UNSUPPORTED_MEDIA', 'That content encoding is not supported.');
    return;
  }

  // Multer limits. The size copy is derived from config so it can never drift
  // from the limit actually enforced.
  if (code === 'LIMIT_FILE_SIZE') {
    respond(res, 413, 'PAYLOAD_TOO_LARGE', `That file is larger than the ${config.maxUploadMb} MB limit.`);
    return;
  }
  if (code === 'LIMIT_FILE_COUNT') {
    respond(res, 400, 'BAD_REQUEST', 'Upload one file at a time.');
    return;
  }
  if (code === 'LIMIT_UNEXPECTED_FILE') {
    respond(res, 400, 'BAD_REQUEST', 'Unexpected file field. Attach the file as “file”.');
    return;
  }
  if (code === 'LIMIT_PART_COUNT') {
    respond(res, 400, 'BAD_REQUEST', 'That upload contains too many parts.');
    return;
  }

  // Anything unrecognised is a bug: log it in full, tell the user nothing specific.
  console.error('[unhandled]', err);
  res.status(500).json({
    error: { message: 'Something went wrong on our side. Please try again.', code: 'INTERNAL' },
  } satisfies ApiErrorBody);
}

function respond(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { message, code } } satisfies ApiErrorBody);
}

export function notFoundMiddleware(_req: Request, res: Response): void {
  res.status(404).json({
    error: { message: 'That endpoint does not exist.', code: 'NOT_FOUND' },
  } satisfies ApiErrorBody);
}
