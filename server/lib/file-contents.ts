/**
 * Content-level upload validation.
 *
 * Extension and declared MIME type are both attacker-controlled, so they only
 * decide *which* validator to run. This module reads the bytes and rejects a
 * file whose real structure disagrees with what it claims to be — a PHP script
 * renamed to `.pdf`, or a ZIP bomb wearing an `.xlsx` extension.
 *
 * For OOXML (`.docx` / `.xlsx`) we parse the real ZIP central directory and
 * require the format's mandatory parts — `word/document.xml` versus
 * `xl/workbook.xml` is what actually distinguishes the two.
 */

import { ApiError } from './errors';

const PDF_MAGIC = '%PDF-';
const ZIP_LOCAL_HEADER = 0x04034b50;
const ZIP_EOCD = 0x06054b50;
const ZIP_EOCD64_LOCATOR = 0x07064b50;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

function reject(message: string): never {
  throw new ApiError('UNSUPPORTED_MEDIA', message);
}

/* --------------------------------------------------------------------- pdf */

export function isPdf(buffer: Buffer): boolean {
  // Some producers emit a few junk bytes before the header; the spec tolerates
  // a small offset, so scan a short prefix rather than only offset 0.
  const prefix = buffer.subarray(0, 1024).toString('latin1');
  return prefix.includes(PDF_MAGIC);
}

/* --------------------------------------------------------------------- zip */

export interface ZipEntryInfo {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
}

/**
 * Read the ZIP central directory. Returns null when the buffer is not a ZIP.
 * Deliberately parses the directory rather than scanning for local headers, so
 * a file with a plausible prefix but no valid structure is rejected.
 */
export function readZipEntries(buffer: Buffer): ZipEntryInfo[] | null {
  if (buffer.length < 22) return null;
  if (buffer.readUInt32LE(0) !== ZIP_LOCAL_HEADER) return null;

  // Find the end-of-central-directory record, scanning back over any comment.
  let eocd = -1;
  const start = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) === ZIP_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const entryCount = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);

  // Zip64 is not accepted: a legitimate report never needs it, and supporting it
  // widens the parser surface for no product benefit.
  if (directoryOffset === 0xffffffff || entryCount === 0xffff) return null;
  if (eocd >= 20 && buffer.readUInt32LE(eocd - 20) === ZIP_EOCD64_LOCATOR) return null;
  if (directoryOffset + directorySize > buffer.length) return null;

  const entries: ZipEntryInfo[] = [];
  let cursor = directoryOffset;
  for (let i = 0; i < entryCount; i += 1) {
    if (cursor + 46 > buffer.length) return null;
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) return null;

    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);

    const nameStart = cursor + 46;
    if (nameStart + nameLength > buffer.length) return null;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');

    entries.push({ name, compressedSize, uncompressedSize });
    cursor = nameStart + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** Guard against a decompression bomb before anything tries to open the file. */
const MAX_EXPANSION_RATIO = 200;
const MAX_TOTAL_UNCOMPRESSED = 400 * 1024 * 1024;

function assertNotZipBomb(entries: ZipEntryInfo[], fileSize: number): void {
  const totalUncompressed = entries.reduce((sum, e) => sum + e.uncompressedSize, 0);
  if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) {
    reject('That archive expands to an implausible size and was rejected.');
  }
  if (fileSize > 0 && totalUncompressed / fileSize > MAX_EXPANSION_RATIO) {
    reject('That archive expands to an implausible size and was rejected.');
  }
}

/* ------------------------------------------------------------------- ooxml */

/** The mandatory body part for each OOXML format. */
const OOXML_SIGNATURES: Record<string, { part: RegExp; label: string }> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    part: /^word\/document\.xml$/,
    label: 'Word document',
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    part: /^xl\/workbook\.xml$/,
    label: 'Excel workbook',
  },
};

function assertOoxml(buffer: Buffer, mime: string): void {
  const entries = readZipEntries(buffer);
  if (!entries) {
    reject('That file is not a valid Office document. It may be renamed or corrupted.');
  }
  assertNotZipBomb(entries, buffer.length);

  const names = new Set(entries.map((e) => e.name));
  if (!names.has('[Content_Types].xml')) {
    reject('That file is not a valid Office document. It may be renamed or corrupted.');
  }

  const signature = OOXML_SIGNATURES[mime];
  if (!signature) {
    reject('That file type is not accepted.');
  }

  // The mandatory body part is what actually separates a Word document from a
  // Workbook, whatever extension the browser claimed.
  if (![...names].some((name) => signature.part.test(name))) {
    reject(`That file does not contain a ${signature.label}. Check that the extension matches the contents.`);
  }
}

/* ------------------------------------------------------------------ public */

/**
 * Verify that the bytes match the declared type. Throws `ApiError` (415) with a
 * user-safe message when they do not.
 */
export function assertContentMatchesType(buffer: Buffer, mime: string, extension: string): void {
  if (buffer.length === 0) {
    reject('That file is empty.');
  }

  switch (mime) {
    case 'application/pdf': {
      if (!isPdf(buffer)) {
        reject('That file is not a valid PDF. It may be renamed or corrupted.');
      }
      return;
    }

    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
      assertOoxml(buffer, mime);
      return;
    }

    case 'application/msword':
    case 'application/vnd.ms-excel': {
      // Legacy Office files are OLE compound documents. Some tools also emit the
      // modern ZIP container under a legacy extension, so accept either.
      if (buffer.subarray(0, 8).equals(OLE_MAGIC)) return;
      if (readZipEntries(buffer)) return;
      reject(`That file is not a valid ${extension === '.doc' ? 'Word' : 'Excel'} document.`);
      return;
    }

    case 'image/png': {
      if (!buffer.subarray(0, 8).equals(PNG_MAGIC)) {
        reject('That file is not a valid PNG image.');
      }
      return;
    }

    case 'image/jpeg': {
      if (!buffer.subarray(0, 3).equals(JPEG_MAGIC)) {
        reject('That file is not a valid JPEG image.');
      }
      return;
    }

    case 'text/csv': {
      // CSV has no magic number. Reject binary payloads and anything that looks
      // like active markup or a script, which are the realistic attacks here.
      if (buffer.includes(0)) {
        reject('That CSV file contains binary data.');
      }
      const head = buffer.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
      if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?php') || head.startsWith('#!')) {
        reject('That file is not a CSV document.');
      }
      return;
    }

    default:
      reject('That file type is not accepted.');
  }
}
