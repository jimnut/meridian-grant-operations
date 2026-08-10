import crypto from 'node:crypto';
import path from 'node:path';

import { loadEnvFile } from './env';

// A `.env` in the working directory is loaded before anything else reads config.
// Real environment variables always win.
loadEnvFile();

function envString(key: string, fallback = ''): string {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envBool(key: string, fallback = false): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

const nodeEnv = envString('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test' || process.env.VITEST === 'true';

/** Minimum entropy we accept for a production signing secret. */
export const MIN_SESSION_SECRET_LENGTH = 32;

/**
 * Obviously-unsafe values that must never reach production, even if they are
 * long enough to pass the length check.
 */
const WEAK_SECRETS = new Set([
  'changeme',
  'change-me',
  'secret',
  'session-secret',
  'development',
  'dev',
  'test',
  'test-session-secret-not-used-in-production',
  'meridian',
  'grantconsole',
  'password',
]);

export function sessionSecretProblem(secret: string): string | null {
  const trimmed = secret.trim();
  if (trimmed === '') return 'SESSION_SECRET is required.';
  if (trimmed.length < MIN_SESSION_SECRET_LENGTH) {
    return `SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters.`;
  }
  if (WEAK_SECRETS.has(trimmed.toLowerCase())) return 'SESSION_SECRET is a known placeholder value.';
  if (/^(.)\1+$/.test(trimmed)) return 'SESSION_SECRET must not be a single repeated character.';
  return null;
}

function resolveSessionSecret(): string {
  const provided = envString('SESSION_SECRET');

  if (isProduction) {
    // Fail closed: a production deployment must supply a strong secret.
    const problem = sessionSecretProblem(provided);
    if (problem) {
      throw new Error(
        `${problem} Set SESSION_SECRET when NODE_ENV=production. Generate one with: openssl rand -hex 32`,
      );
    }
    return provided;
  }

  if (provided) return provided;

  const generated = crypto.randomBytes(32).toString('hex');
  if (!isTest) {
    console.warn(
      '[config] SESSION_SECRET not set — generated an ephemeral development secret. Sessions reset when the server restarts.',
    );
  }
  return generated;
}

const dataDir = path.resolve(process.cwd(), envString('DATA_DIR', './data'));

/**
 * Demo mode is opt-in and never inferred. It exposes the seeded account list and
 * the shared demo password on the sign-in screen, so it must be an explicit,
 * deliberate choice — `npm run demo` sets it; nothing else does.
 */
export function isDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.DEMO_MODE;
  const enabled = raw === 'true' || raw === '1';
  if (!enabled) return false;
  // Never, under any circumstance, in production.
  if ((env.NODE_ENV ?? 'development') === 'production') return false;
  return true;
}

function resolveDemoMode(): boolean {
  const enabled = envBool('DEMO_MODE', false);
  if (enabled && isProduction) {
    throw new Error('DEMO_MODE cannot be enabled when NODE_ENV=production.');
  }
  return enabled;
}

export const config = {
  nodeEnv,
  isProduction,
  isTest,
  /**
   * Loopback by default. Binding to every interface exposes an unauthenticated-
   * by-default demo dataset to the local network, so it takes an explicit HOST.
   */
  host: envString('HOST', '127.0.0.1'),
  port: envInt('PORT', 4000),
  dataDir,
  databaseFile: path.join(dataDir, 'meridian.db'),
  uploadsDir: path.join(dataDir, 'uploads'),
  sessionSecret: resolveSessionSecret(),
  sessionTtlHours: envInt('SESSION_TTL_HOURS', 72),
  maxUploadBytes: envInt('MAX_UPLOAD_MB', 10) * 1024 * 1024,
  maxUploadMb: envInt('MAX_UPLOAD_MB', 10),
  sessionCookieName: 'grantconsole_session',
  demoMode: resolveDemoMode(),
  allowedOrigins: buildAllowedOrigins(),
  /** Canonical public origin, used for sitemap/robots URLs. */
  siteUrl: envString('SITE_URL', 'https://grantconsole.com').replace(/\/+$/, ''),
  /** GA4 measurement id (G-XXXXXXXX). Analytics is off unless this is set. */
  gaMeasurementId: envString('GA_MEASUREMENT_ID'),
} as const;

function buildAllowedOrigins(): string[] {
  const extra = envString('ALLOWED_ORIGINS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const port = envInt('PORT', 4000);
  const defaults = isProduction
    ? []
    : [
        `http://localhost:${port}`,
        `http://127.0.0.1:${port}`,
        'http://localhost:5173',
        'http://127.0.0.1:5173',
      ];
  return [...new Set([...defaults, ...extra])];
}

export type AppConfig = typeof config;
