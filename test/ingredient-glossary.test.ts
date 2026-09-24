/**
 * The Learn page's ingredient glossary: a public read of the knowledge base.
 *
 * Two promises. It carries the reference text and nothing else - no match
 * patterns, caution lists or layering rules, and nothing about any person -
 * and it is reachable without a session, on the public router, through the
 * client function the page uses. Tested against a real HTTP server so the
 * route's wiring is what is checked, not a copy of it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { FAMILY_LABELS, INGREDIENTS } from '../server/skin/ingredient-data.ts';
import { heldFromGlossary, ingredientGlossary } from '../server/skin/glossary.ts';
import type { IngredientGlossary } from '../shared/ingredient-glossary.ts';

// The public router also serves picks, which read the shelf. Nothing here
// touches it, so the store is stubbed rather than given a database.
vi.mock('../server/catalogue/store.ts', () => ({
  catalogueStatus: vi.fn(async () => ({})),
  listCatalogue: vi.fn(async () => []),
}));

const { publicRouter } = await import('../server/routes/public.ts');

// Held back from the public page until counsel clears them (MED-01): each
// note names a prescription or refers the reader to a clinician. The list is
// written out so a change to the rule, or a new note it catches, shows here.
const HELD = ['Tretinoin', 'Topical antibiotic', 'Hydroquinone'];
const PUBLIC = INGREDIENTS.filter((i) => !HELD.includes(i.label));

describe('ingredient glossary', () => {
  it('lists every public knowledge-base entry once, with the reference fields only', () => {
    const glossary = ingredientGlossary();
    expect(glossary.ingredients).toHaveLength(PUBLIC.length);
    expect(new Set(glossary.ingredients.map((i) => i.label))).toEqual(new Set(PUBLIC.map((i) => i.label)));
    for (const entry of glossary.ingredients) {
      expect(Object.keys(entry).sort()).toEqual(['family', 'irritationRisk', 'label', 'note']);
      expect(entry.note.length).toBeGreaterThan(0);
      expect(['none', 'low', 'moderate', 'high']).toContain(entry.irritationRisk);
    }
  });

  it('holds back the prescription and clinician-referral notes, and only those', () => {
    expect(INGREDIENTS.filter(heldFromGlossary).map((i) => i.label)).toEqual(HELD);
    const wire = JSON.stringify(ingredientGlossary()).toLowerCase();
    for (const word of ['prescri', 'clinician', 'dermatologist', 'doctor', 'physician']) {
      expect(wire).not.toContain(word);
    }
  });

  it('keeps the matching and caution logic on the server', () => {
    const wire = JSON.stringify(ingredientGlossary());
    for (const field of ['match', 'cautionFor', 'conflictsWith', 'timeOfDay', 'active']) {
      expect(wire).not.toContain(`"${field}"`);
    }
  });

  it('names each family with its label and count, in the knowledge base order', () => {
    const { ingredients, families } = ingredientGlossary();
    for (const family of families) {
      expect(family.label).toBe(FAMILY_LABELS[family.id as keyof typeof FAMILY_LABELS]);
      expect(family.count).toBe(ingredients.filter((i) => i.family === family.id).length);
    }
    expect(families.reduce((sum, f) => sum + f.count, 0)).toBe(ingredients.length);
    // Grouped: once a family's run ends, it does not come back.
    const runs = ingredients.map((i) => i.family).filter((f, i, all) => f !== all[i - 1]);
    expect(new Set(runs).size).toBe(runs.length);
    expect(runs).toEqual(families.map((f) => f.id));
  });

  it('has a client function on the public path', () => {
    const client = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
    expect(client).toContain("ingredients: () => request<IngredientGlossary>('/public/ingredients')");
  });

  it('is built in the browser from the same code when the API cannot serve it', () => {
    // No server, or a deploy with no database (every /api path but health
    // answers 503 there): the glossary needs neither, so Learn builds it from
    // the bundled knowledge base rather than showing nothing.
    const page = readFileSync(new URL('../src/pages/LearnPage.svelte', import.meta.url), 'utf8');
    expect(page).toContain("import('../../server/skin/glossary.ts')");
    const data = readFileSync(new URL('../server/skin/ingredient-data.ts', import.meta.url), 'utf8');
    const glossary = readFileSync(new URL('../server/skin/glossary.ts', import.meta.url), 'utf8');
    // Browser-safe: nothing but types and the knowledge base.
    expect(data).not.toMatch(/^import /m);
    expect(glossary.match(/^import .*$/gm)).toEqual([
      "import type { IngredientGlossary } from '../../shared/ingredient-glossary.ts';",
      "import { FAMILY_LABELS, INGREDIENTS, type Ingredient, type IngredientFamily } from './ingredient-data.ts';",
    ]);
  });
});

describe('GET /api/public/ingredients', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use('/api/public', publicRouter);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no port');
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('answers without a session, cacheably', async () => {
    const res = await fetch(`${base}/api/public/ingredients`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('public');
    const body = (await res.json()) as IngredientGlossary;
    expect(body.ingredients).toHaveLength(PUBLIC.length);
    expect(body).toEqual(ingredientGlossary());
  });
});
