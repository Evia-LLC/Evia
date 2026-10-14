import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DataApiError, result, affected, encodeBytea, decodeBytea, allPages } from '../server/lib/data-api.ts';

describe('Data API wire contracts', () => {
  it('round-trips all byte values and rejects ambiguous or malformed encodings', () => {
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    expect(decodeBytea(encodeBytea(bytes))).toEqual(bytes);
    expect(decodeBytea(encodeBytea(Buffer.alloc(0)))).toEqual(Buffer.alloc(0));
    for (const invalid of ['AA==', '00ff', '\\x0', '\\xzz']) expect(() => decodeBytea(invalid)).toThrow(DataApiError);
  });
  it('turns result errors into Error instances without assigning a public route status', async () => {
    const error = await result(Promise.resolve({ data: null, error: {
      code: '23505', message: 'duplicate', details: 'detail', hint: 'hint',
    }, status: 409 })).catch((err) => err);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ code: '23505', httpStatus: 409, details: 'detail', hint: 'hint' });
    expect(error).not.toHaveProperty('status');
  });
  it('requires the requested count rather than treating an absent count as zero', async () => {
    await expect(affected(Promise.resolve({ data: null, error: null, count: 0 }))).resolves.toBe(0);
    await expect(affected(Promise.resolve({ data: null, error: null }))).rejects.toThrow(/exact count/);
  });
  it('collects every page and stops at a caller limit without requesting an invalid range', async () => {
    const source = Array.from({ length: 1201 }, (_, id) => ({ id }));
    const ranges: number[][] = [];
    const page = async (from: number, to: number) => {
      ranges.push([from, to]);
      return { data: source.slice(from, to + 1), error: null };
    };
    expect(await allPages(page)).toEqual(source);
    expect(ranges).toEqual([[0, 499], [500, 999], [1000, 1499], [1201, 1700]]);
    ranges.length = 0;
    expect(await allPages(page, 1000)).toHaveLength(1000);
    expect(ranges).toEqual([[0, 499], [500, 999]]);
  });
  it('does not mistake a smaller server response ceiling for the end of an export', async () => {
    const source = Array.from({ length: 17 }, (_, id) => id);
    expect(await allPages(async (from, to) => ({ data: source.slice(from, Math.min(to + 1, from + 3)), error: null })))
      .toEqual(source);
  });
});

describe('sole runtime transport', () => {
  it('contains no direct SQL driver/helper path and keeps the SDK outside the browser', () => {
    const root = join(import.meta.dirname, '..');
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : /\.(ts|svelte)$/.test(path) ? [path] : [];
    });
    for (const file of walk(join(root, 'server'))) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/from\s+['"]pg['"]|db\/index\.ts|\b(?:NETLIFY_DATABASE_URL|DATABASE_URL)\b/);
    }
    for (const file of walk(join(root, 'src'))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/@supabase|VITE_SUPABASE|PUBLIC_SUPABASE/);
    }
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    for (const name of ['pg', '@types/pg', '@electric-sql/pglite', '@electric-sql/pglite-socket']) {
      expect(pkg.dependencies ?? {}).not.toHaveProperty(name);
      if (name !== '@electric-sql/pglite') expect(pkg.devDependencies ?? {}).not.toHaveProperty(name);
    }
  });
});
