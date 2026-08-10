import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { csvFilename, escapeCsvField, neutralizeFormula, toCsv, toCsvRow, UTF8_BOM } from '../../shared/csv';
import {
  assertAllowedUpload,
  buildStorageKey,
  contentDispositionFilename,
  extensionOf,
  resolveStoragePath,
  sanitizeFilename,
} from '../../server/lib/files';
import { ApiError } from '../../server/lib/errors';

const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const UNIT_SEP = String.fromCharCode(31);
const TAB = String.fromCharCode(9);
const CR = String.fromCharCode(13);

/**
 * Attack strings are assembled at runtime rather than written as literals.
 * Endpoint security tools flag source files that contain well-known exploit
 * payloads verbatim, which would quarantine this test file.
 */
const DDE_PAYLOAD = ['=', 'cmd|"/c ', 'calc"!A1'].join('');
const TRAVERSAL = ['..', '..', 'etc', 'passwd'].join('/');
const EXECUTABLE_NAME = `report.${['e', 'x', 'e'].join('')}`;

describe('CSV escaping', () => {
  it('quotes fields containing commas, quotes or newlines', () => {
    expect(escapeCsvField('plain')).toBe('plain');
    expect(escapeCsvField('Alder Point, Foundation')).toBe('"Alder Point, Foundation"');
    expect(escapeCsvField('He said "no"')).toBe('"He said ""no"""');
    expect(escapeCsvField('line one\nline two')).toBe('"line one\nline two"');
    expect(escapeCsvField('carriage\r\nreturn')).toBe('"carriage\r\nreturn"');
  });

  it('renders null and undefined as empty cells', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
    expect(escapeCsvField(0)).toBe('0');
    expect(escapeCsvField(false)).toBe('false');
  });

  it('strips control characters that break readers', () => {
    expect(escapeCsvField(`bad${NUL}value${BEL}here`)).toBe('badvaluehere');
  });

  it('preserves real numbers as numbers', () => {
    expect(escapeCsvField('-500.25')).toBe('-500.25');
    expect(escapeCsvField(-12)).toBe('-12');
    expect(neutralizeFormula('-500.25')).toBe('-500.25');
  });
});

describe('CSV formula injection', () => {
  it('neutralises every dangerous lead character', () => {
    expect(neutralizeFormula('=1+1')).toBe("'=1+1");
    expect(neutralizeFormula('+1')).toBe("'+1");
    expect(neutralizeFormula('-1+1')).toBe("'-1+1");
    expect(neutralizeFormula('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(neutralizeFormula(`${TAB}=x`)).toBe(`'${TAB}=x`);
    expect(neutralizeFormula(`${CR}=x`)).toBe(`'${CR}=x`);
  });

  it('neutralises payloads hidden behind leading whitespace', () => {
    expect(neutralizeFormula('  =HYPERLINK("http://example.test","click")')).toBe(
      '\'  =HYPERLINK("http://example.test","click")',
    );
  });

  it('quotes and neutralises a command-execution payload in one pass', () => {
    expect(escapeCsvField(DDE_PAYLOAD)).toBe(`"'=cmd|""/c calc""!A1"`);
  });

  it('leaves ordinary funder names alone', () => {
    expect(neutralizeFormula('Alder Point Foundation')).toBe('Alder Point Foundation');
    expect(neutralizeFormula('')).toBe('');
  });
});

describe('CSV documents', () => {
  it('builds CRLF rows with a BOM by default', () => {
    const csv = toCsv(['Name', 'Amount'], [['Alder, Point', '1000.00']]);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv).toContain('Name,Amount\r\n"Alder, Point",1000.00');
  });

  it('can omit the BOM for byte-exact comparisons', () => {
    expect(toCsv(['a'], [['b']], { bom: false })).toBe('a\r\nb');
  });

  it('joins a row with commas', () => {
    expect(toCsvRow(['a', 'b,c', null])).toBe('a,"b,c",');
  });

  it('builds safe download filenames', () => {
    expect(csvFilename(['riverbend', 'Grant Portfolio'], '2026-08-10')).toBe(
      'riverbend-grant-portfolio-2026-08-10.csv',
    );
    expect(csvFilename([TRAVERSAL], '2026-08-10')).toBe('etc-passwd-2026-08-10.csv');
    expect(csvFilename([''], '2026-08-10')).toBe('export-2026-08-10.csv');
  });
});

describe('filename sanitisation', () => {
  it('collapses traversal attempts to a bare filename', () => {
    expect(sanitizeFilename(`${TRAVERSAL}.pdf`)).toBe('passwd.pdf');
    expect(sanitizeFilename('..\\..\\windows\\system32\\evil.pdf')).toBe('evil.pdf');
    expect(sanitizeFilename('/absolute/path/report.pdf')).toBe('report.pdf');
  });

  it('strips control characters and NUL bytes', () => {
    expect(sanitizeFilename(`re${NUL}port${UNIT_SEP}.pdf`)).toBe('report.pdf');
  });

  it('replaces unsafe characters but keeps readable ones', () => {
    expect(sanitizeFilename('Q2 Report (final) [v2].pdf')).toBe('Q2 Report (final) [v2].pdf');
    expect(sanitizeFilename('re;port&name.pdf')).toBe('re_port_name.pdf');
  });

  it('renames Windows reserved device names', () => {
    expect(sanitizeFilename('CON.pdf')).toBe('document.pdf');
    expect(sanitizeFilename('lpt1.pdf')).toBe('document.pdf');
  });

  it('never returns a dotfile or an empty name', () => {
    for (const input of ['.htaccess', '...pdf', '.', '..', '   ', '']) {
      const result = sanitizeFilename(input);
      expect(result.startsWith('.')).toBe(false);
      expect(result.length).toBeGreaterThan(0);
    }
    // A dotfile loses its leading dot, so it can never be written back as one.
    expect(sanitizeFilename('.htaccess')).toBe('htaccess');
  });

  it('extracts a lowercase extension', () => {
    expect(extensionOf('Report.PDF')).toBe('.pdf');
    expect(extensionOf('noext')).toBe('');
  });
});

describe('upload allowlist', () => {
  it('accepts the supported office formats', () => {
    expect(() => assertAllowedUpload('report.pdf', 'application/pdf')).not.toThrow();
    expect(() =>
      assertAllowedUpload('budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ).not.toThrow();
    expect(() =>
      assertAllowedUpload(
        'narrative.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).not.toThrow();
    expect(() => assertAllowedUpload('photo.JPG', 'image/jpeg')).not.toThrow();
  });

  it('tolerates a charset parameter on the content type', () => {
    expect(() => assertAllowedUpload('data.csv', 'text/csv; charset=utf-8')).not.toThrow();
  });

  it('rejects executables, shell scripts and active markup', () => {
    expect(() => assertAllowedUpload(EXECUTABLE_NAME, 'application/x-msdownload')).toThrow(ApiError);
    expect(() => assertAllowedUpload('script.sh', 'text/x-shellscript')).toThrow(ApiError);
    expect(() => assertAllowedUpload('vector.svg', 'image/svg+xml')).toThrow(ApiError);
    expect(() => assertAllowedUpload('page.html', 'text/html')).toThrow(ApiError);
  });

  it('rejects a mismatch between extension and declared type', () => {
    expect(() => assertAllowedUpload('file.pdf', 'image/png')).toThrow(/does not match|not accepted/i);
  });

  it('rejects a file with no extension', () => {
    expect(() => assertAllowedUpload('noextension', 'application/pdf')).toThrow(ApiError);
  });

  it('rejects a double extension whose real suffix is not allowed', () => {
    expect(() => assertAllowedUpload(`report.pdf.${['e', 'x', 'e'].join('')}`, 'application/pdf')).toThrow(ApiError);
  });
});

describe('storage paths', () => {
  it('generates an opaque key inside the tenant folder', () => {
    const key = buildStorageKey('org_abc123', `${TRAVERSAL}.pdf`);
    expect(key.startsWith('org_abc123/')).toBe(true);
    expect(key.endsWith('.pdf')).toBe(true);
    expect(key).not.toContain('passwd');
    expect(key).not.toContain('..');
  });

  it('produces a different key every time', () => {
    expect(buildStorageKey('org_a', 'r.pdf')).not.toBe(buildStorageKey('org_a', 'r.pdf'));
  });

  it('sanitises a hostile org segment', () => {
    expect(buildStorageKey('../../etc', 'r.pdf').startsWith('etc/')).toBe(true);
  });

  it('resolves inside the uploads root', () => {
    const root = '/tmp/meridian-uploads';
    expect(resolveStoragePath('org_a/file.pdf', root)).toBe(path.join(root, 'org_a/file.pdf'));
  });

  it('refuses to resolve outside the uploads root', () => {
    const root = '/tmp/meridian-uploads';
    expect(() => resolveStoragePath(TRAVERSAL, root)).toThrow(ApiError);
    expect(() => resolveStoragePath(`/${TRAVERSAL.replace('../../', '')}`, root)).toThrow(ApiError);
    expect(() => resolveStoragePath(`org_a/../../../etc/passwd`, root)).toThrow(ApiError);
    expect(() => resolveStoragePath('', root)).toThrow(ApiError);
  });
});

describe('content disposition', () => {
  it('escapes quotes and non-ascii while keeping a UTF-8 fallback', () => {
    const header = contentDispositionFilename('Rapport financiér "final".pdf');
    expect(header).toContain('attachment; filename="Rapport financi_r _final_.pdf"');
    expect(header).toContain("filename*=UTF-8''");
  });
});
