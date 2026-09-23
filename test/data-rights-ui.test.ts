import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('data rights confirmation UI contract', () => {
  it('requires typed and second confirmations and guards double submission', async () => {
    const source = await readFile(new URL('../src/pages/DataRightsPage.svelte', import.meta.url), 'utf8');
    expect(source).toContain("const phrase = 'DELETE'");
    expect(source).toContain('secondConfirmation');
    expect(source).toContain('if (!typedCorrectly || !secondConfirmation || deleting) return');
    expect(source).toContain("disabled={deleting || !typedCorrectly}");
  });

  it('keeps authentication until deletion is confirmed by the server', async () => {
    const source = await readFile(new URL('../src/state/controller.ts', import.meta.url), 'utf8');
    const deletion = source.slice(source.indexOf('export async function deleteAccount'), source.indexOf('export async function refreshScans'));
    expect(deletion.indexOf('await api.deleteAccount()')).toBeLessThan(deletion.indexOf('setToken(null)'));
    expect(deletion.indexOf('setToken(null)')).toBeLessThan(deletion.indexOf('session.reset()'));
  });

  it('registers an authenticated attachment route with private no-store headers', async () => {
    const source = await readFile(new URL('../server/routes/api.ts', import.meta.url), 'utf8');
    expect(source).toContain('apiRouter.use(requireAuth)');
    expect(source).toContain("apiRouter.get('/me/data-export'");
    expect(source).toContain('assembleDataExport(req.userId!)');
    expect(source).toContain("'Content-Disposition'");
    expect(source).toContain("'Cache-Control', 'private, no-store'");
  });

  it('uses centralized placeholder legal entries', async () => {
    const source = await readFile(new URL('../src/pages/DataRightsPage.svelte', import.meta.url), 'utf8');
    expect(source).toContain('DATA_EXPORT_NOTICE_PLACEHOLDER');
    expect(source).toContain('ACCOUNT_DELETION_NOTICE_PLACEHOLDER');
    expect(source).toContain('import.meta.env.DEV');
  });
});
