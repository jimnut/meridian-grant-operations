import type { Request } from 'express';

import { config } from '../config';

/** Demo mode can still be deployed over HTTPS behind a reverse proxy. */
export function secureMeasurementCookie(
  req: Pick<Request, 'secure'>,
  settings: Pick<typeof config, 'isProduction' | 'appUrl'> = config,
): boolean {
  if (settings.isProduction || req.secure) return true;
  try { return new URL(settings.appUrl).protocol === 'https:'; } catch { return false; }
}
