/**
 * CSV serialisation with two hard requirements:
 *
 *  1. Correct RFC-4180 quoting for commas, quotes and embedded newlines.
 *  2. Spreadsheet formula-injection defence. A cell beginning with = + - @ (or a
 *     tab/carriage return) is executed by Excel and Google Sheets on open, so
 *     exported funder-supplied text must never round-trip into a live formula.
 */

const NEEDS_QUOTING = /[",\r\n]/;
const FORMULA_LEAD = /^[=+\-@\t\r]/;
/** A value that is unambiguously a number can never be a formula, so it stays numeric. */
const PURE_NUMBER = /^-?\d+(?:\.\d+)?$/;
/** C0/C1 control characters, excluding CR and LF which are legal inside a quoted field. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/** Byte-order mark so Excel detects UTF-8 in downloaded exports. */
export const UTF8_BOM = String.fromCharCode(0xfeff);

/** Neutralise a value that a spreadsheet would otherwise evaluate as a formula. */
export function neutralizeFormula(value: string): string {
  if (value.length === 0) return value;
  if (PURE_NUMBER.test(value)) return value;
  if (FORMULA_LEAD.test(value) || FORMULA_LEAD.test(value.trimStart())) {
    return `'${value}`;
  }
  return value;
}

export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : String(value);

  text = text.replace(CONTROL_CHARS, '');
  text = neutralizeFormula(text);

  if (NEEDS_QUOTING.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsvRow(fields: readonly unknown[]): string {
  return fields.map(escapeCsvField).join(',');
}

/**
 * Build a complete CSV document. Uses CRLF line endings (RFC-4180) and a UTF-8
 * BOM so Excel renders accented funder names correctly.
 */
export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
  options: { bom?: boolean } = {},
): string {
  const lines = [toCsvRow(headers), ...rows.map(toCsvRow)];
  const body = lines.join('\r\n');
  return options.bom === false ? body : `${UTF8_BOM}${body}`;
}

/** Filesystem- and header-safe download filename. */
export function csvFilename(parts: readonly string[], isoDate: string): string {
  const slug = parts
    .map((p) =>
      p
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter(Boolean)
    .join('-');
  return `${slug || 'export'}-${isoDate}.csv`;
}
