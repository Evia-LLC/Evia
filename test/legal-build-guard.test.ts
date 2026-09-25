import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEGAL_CONTENT } from '../shared/legal-content.ts';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
function guard(overrides: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['scripts/check-legal-content.ts'], {
    encoding: 'utf8',
    env: { ...process.env, CONTEXT: '', LEGAL_PRODUCTION: '', VERCEL_ENV: 'production',
      LEGAL_RELEASE: '', EVIA_SAMPLE_DEMO: '', DEMO_MODE: '', VITE_SAMPLE_DEMO: '', ...overrides },
  });
}

describe('hosted sample release boundary', () => {
  it('allows the committed Vercel demo profile without claiming approval', () => {
    const result = guard(config.build.env);
    expect(result.status).toBe(0);
    expect(LEGAL_CONTENT.terms.status).toBe('placeholder');
    expect(LEGAL_CONTENT['privacy-policy'].status).toBe('placeholder');
    expect(config.env).toMatchObject({ EVIA_SAMPLE_DEMO: '1', DEMO_MODE: '0' });
  });
  it.each(['EVIA_SAMPLE_DEMO', 'DEMO_MODE', 'VITE_SAMPLE_DEMO'])('rejects an incomplete demo profile: %s', (key) => {
    expect(guard({ ...config.build.env, [key]: '' }).status).not.toBe(0);
  });
  it('still blocks normal production releases with draft documents', () => {
    expect(guard().status).not.toBe(0);
    const result = guard({ LEGAL_RELEASE: 'public_web' });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('placeholder legal content: terms, privacy-policy');
  });
});
