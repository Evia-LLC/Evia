import { expect, it, vi } from 'vitest';
import { verifyAge } from '../src/lib/age-verification.ts';

it('never verifies a claimed adult or minor and never calls a provider', async () => {
  const fetch = vi.fn(() => { throw new Error('No provider should be called'); });
  vi.stubGlobal('fetch', fetch);
  try {
    for (const dateOfBirth of ['1980-01-01', '2010-01-01', '']) {
      await expect(verifyAge({ email: 'sample@example.test', dateOfBirth })).resolves.toEqual({
        verified: false, mock: true, reason: 'no provider selected',
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
