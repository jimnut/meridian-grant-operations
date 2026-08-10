/**
 * Minimal `.env` loader.
 *
 * Deliberately dependency-free: it reads `KEY=value` pairs, supports `#`
 * comments, quoted values and `export ` prefixes, and never overwrites a
 * variable that is already present in the real environment. That ordering
 * matters — CI and the demo scripts set variables inline, and a stale `.env`
 * on a developer machine must not silently win.
 */

import fs from 'node:fs';
import path from 'node:path';

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;

export function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const match = LINE.exec(line);
    if (!match) continue;

    const key = match[1]!;
    let value = (match[2] ?? '').trim();

    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    } else {
      // Strip an unquoted trailing comment.
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }

    out[key] = value;
  }
  return out;
}

/** Loads `.env` from the working directory if present. Returns the keys applied. */
export function loadEnvFile(file = path.resolve(process.cwd(), '.env')): string[] {
  if (!fs.existsSync(file)) return [];

  let contents: string;
  try {
    contents = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }

  const applied: string[] = [];
  for (const [key, value] of Object.entries(parseEnvFile(contents))) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      applied.push(key);
    }
  }
  return applied;
}
