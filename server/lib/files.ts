/**
 * Upload safety.
 *
 * Threat model addressed here:
 *  - path traversal via `../` or absolute paths in the client-supplied filename;
 *  - Windows reserved names and NUL bytes;
 *  - executable/script content types masquerading as evidence;
 *  - direct enumeration of the uploads directory (files are stored under a
 *    generated key and only ever served through an authorised route).
 */

import fs from 'node:fs';
import path from 'node:path';

import { config } from '../config';
import { ApiError } from './errors';
import { newId } from './ids';

export interface AllowedType {
  mime: string;
  extensions: string[];
  label: string;
}

export const ALLOWED_UPLOAD_TYPES: AllowedType[] = [
  { mime: 'application/pdf', extensions: ['.pdf'], label: 'PDF' },
  {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['.docx'],
    label: 'Word (.docx)',
  },
  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extensions: ['.xlsx'],
    label: 'Excel (.xlsx)',
  },
  { mime: 'application/msword', extensions: ['.doc'], label: 'Word (.doc)' },
  { mime: 'application/vnd.ms-excel', extensions: ['.xls'], label: 'Excel (.xls)' },
  { mime: 'text/csv', extensions: ['.csv'], label: 'CSV' },
  { mime: 'image/png', extensions: ['.png'], label: 'PNG image' },
  { mime: 'image/jpeg', extensions: ['.jpg', '.jpeg'], label: 'JPEG image' },
];

export const ALLOWED_EXTENSIONS = ALLOWED_UPLOAD_TYPES.flatMap((t) => t.extensions);
export const ALLOWED_MIME_TYPES = ALLOWED_UPLOAD_TYPES.map((t) => t.mime);
export const ALLOWED_TYPE_SUMMARY = 'PDF, Word, Excel, CSV, PNG or JPEG';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Reduce an arbitrary client filename to a safe display name. Never used as a
 * filesystem path — storage keys are generated separately.
 */
export function sanitizeFilename(original: string): string {
  // Take the basename under both separators so "..\\..\\etc\\passwd" collapses.
  const withoutDirs = original.split(/[/\\]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const stripped = withoutDirs.replace(/[\x00-\x1F\x7F]/g, '').trim();
  const collapsed = stripped
    .replace(/[^A-Za-z0-9._ ()\-[\]]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._\s]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const ext = path.extname(collapsed).toLowerCase();
  const stem = path.basename(collapsed, path.extname(collapsed));
  const safeStem = WINDOWS_RESERVED.test(stem) || stem === '' ? 'document' : stem.slice(0, 120);
  return `${safeStem}${ext}`;
}

export function extensionOf(filename: string): string {
  return path.extname(filename).toLowerCase();
}

/** Validate the declared MIME type and the extension together. */
export function assertAllowedUpload(originalName: string, mimeType: string): void {
  const ext = extensionOf(sanitizeFilename(originalName));
  if (!ext) {
    throw new ApiError('UNSUPPORTED_MEDIA', `Add a file extension. Accepted formats: ${ALLOWED_TYPE_SUMMARY}.`);
  }
  const byExtension = ALLOWED_UPLOAD_TYPES.find((t) => t.extensions.includes(ext));
  if (!byExtension) {
    throw new ApiError('UNSUPPORTED_MEDIA', `${ext} files are not accepted. Use ${ALLOWED_TYPE_SUMMARY}.`);
  }
  const normalizedMime = (mimeType || '').split(';')[0]!.trim().toLowerCase();
  if (!ALLOWED_MIME_TYPES.includes(normalizedMime)) {
    throw new ApiError('UNSUPPORTED_MEDIA', `That file type is not accepted. Use ${ALLOWED_TYPE_SUMMARY}.`);
  }
  if (!byExtension.extensions.includes(ext) || byExtension.mime !== normalizedMime) {
    throw new ApiError('UNSUPPORTED_MEDIA', 'The file extension does not match its content type.');
  }
}

/** Opaque, unguessable storage key. Never derived from user input. */
export function buildStorageKey(orgId: string, originalName: string): string {
  const ext = extensionOf(sanitizeFilename(originalName));
  return path.posix.join(safeSegment(orgId), `${newId('doc', 24)}${ext}`);
}

function safeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, '');
  return cleaned === '' ? 'unknown' : cleaned;
}

/**
 * Resolve a stored key to an absolute path, refusing anything that escapes the
 * uploads root even if the key were tampered with in the database.
 */
export function resolveStoragePath(storageKey: string, uploadsDir = config.uploadsDir): string {
  const root = path.resolve(uploadsDir);
  const target = path.resolve(root, storageKey);
  const relative = path.relative(root, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ApiError('FORBIDDEN', 'Invalid file reference.');
  }
  return target;
}

export function writeUpload(storageKey: string, contents: Buffer, uploadsDir = config.uploadsDir): void {
  const target = resolveStoragePath(storageKey, uploadsDir);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, { mode: 0o600 });
}

export function deleteUpload(storageKey: string, uploadsDir = config.uploadsDir): void {
  try {
    fs.unlinkSync(resolveStoragePath(storageKey, uploadsDir));
  } catch {
    // Already gone: deleting the row is still the right outcome.
  }
}

export function readUpload(storageKey: string, uploadsDir = config.uploadsDir): Buffer {
  const target = resolveStoragePath(storageKey, uploadsDir);
  if (!fs.existsSync(target)) {
    throw new ApiError('NOT_FOUND', 'That file is no longer available.');
  }
  return fs.readFileSync(target);
}

/** RFC 5987 safe value for Content-Disposition. */
export function contentDispositionFilename(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
