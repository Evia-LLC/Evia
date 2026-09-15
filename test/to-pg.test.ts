/**
 * `toPg` is the narrowest, most load-bearing function on the server: every one
 * of the ~73 database call sites routes its SQL through it, and it is a pure
 * string transform that needs no database to test.
 *
 * The last test is the important one. `toPg` is safe only because no statement
 * in this codebase contains a literal `?` outside a placeholder position — the
 * function's own docstring says so and asks for it to be re-checked. This turns
 * that request into something that fails the build instead of relying on
 * someone remembering.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toPg } from '../server/db/index.ts';

describe('toPg', () => {
  it('numbers placeholders from one, in order', () => {
    expect(toPg('SELECT * FROM t WHERE a = ? AND b = ?')).toBe(
      'SELECT * FROM t WHERE a = $1 AND b = $2',
    );
  });

  it('leaves a statement with no placeholders untouched', () => {
    expect(toPg('SELECT 1')).toBe('SELECT 1');
  });

  it('numbers across multiple lines and clauses', () => {
    const sql = `INSERT INTO t (a, b, c)
       VALUES (?, ?, ?)
       ON CONFLICT (a) DO UPDATE SET b = ?`;
    expect(toPg(sql)).toContain('VALUES ($1, $2, $3)');
    expect(toPg(sql)).toContain('SET b = $4');
  });

  it('keeps an existing dollar-parameter distinct from what it generates', () => {
    // Not a pattern the codebase uses, but the transform must not silently
    // produce two $1s if someone ever mixes the styles.
    expect(toPg('SELECT ? , $1')).toBe('SELECT $1 , $1');
  });

  it('is the identity for LIKE patterns, which are parameters and not SQL', () => {
    // The wildcards live in the parameter array, never in the statement text —
    // this is what keeps the naive replace safe for search.
    expect(toPg('WHERE name ILIKE ? OR brand ILIKE ?')).toBe(
      'WHERE name ILIKE $1 OR brand ILIKE $2',
    );
  });
});

/**
 * Walks the repositories looking for a `?` that is not a bare placeholder.
 *
 * A question mark inside a SQL string literal, or a Postgres jsonb `?`/`?|`/`?&`
 * operator, would be rewritten into a positional parameter and corrupt the
 * statement. Today there are none; this fails the moment one appears.
 */
/** True if a `?` appears inside a single-quoted SQL string literal. */
function quotedQuestionMark(sql: string): boolean {
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      // '' inside a literal is an escaped quote, not a close-then-open.
      if (inString && sql[i + 1] === "'") {
        i++;
        continue;
      }
      inString = !inString;
      continue;
    }
    if (ch === '?' && inString) return true;
  }
  return false;
}

describe('the assumption toPg rests on', () => {
  const dir = join(import.meta.dirname, '..', 'server', 'db');

  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));

  it.each(files)('%s contains no non-placeholder question mark in SQL', (file) => {
    const source = readFileSync(join(dir, file), 'utf8');

    // Template and single-quoted SQL strings, loosely: any quoted run that
    // looks like a statement.
    const statements = source.match(/(['"`])(?:(?!\1)[\s\S])*?\1/g) ?? [];

    for (const raw of statements) {
      const body = raw.slice(1, -1);
      if (!/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i.test(body)) continue;
      if (!body.includes('?')) continue;

      // A jsonb existence operator would be rewritten into a parameter.
      expect(body, `${file}: ${body.slice(0, 90)}`).not.toMatch(/\?[|&]/);

      // A question mark inside a SQL string literal would be too. This has to
      // be scanned rather than matched: a regex looking for '...?...' happily
      // spans the gap between two *separate* literals, which is how
      // `coalesce(lower(brand), '') = coalesce(lower(?), '')` looks like a
      // violation when it is not.
      expect(quotedQuestionMark(body), `${file}: ${body.slice(0, 90)}`).toBe(false);
    }
  });
});
