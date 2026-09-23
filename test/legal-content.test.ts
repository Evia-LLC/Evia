import { describe, expect, it, vi } from 'vitest';
import { LEGAL_CONTENT, LEGAL_RELEASE_REQUIREMENTS, unresolvedLegalContent } from '../shared/legal-content.ts';
import { submitLegalDecision } from '../src/lib/legal-consent.ts';

describe('versioned legal content', () => {
  it('preserves exact copy without normalization or paraphrase', () => {
    const copy = '  Exact spacing\nand punctuation—stay.  ';
    const rendered = [copy].join('');
    expect(rendered).toBe(copy);
    expect(LEGAL_CONTENT.terms.body[0]).toBe('Draft terms are being prepared for review.');
  });

  it('marks every draft and rejects required release placeholders', () => {
    expect(LEGAL_CONTENT.terms.status).toBe('placeholder');
    expect(unresolvedLegalContent(LEGAL_RELEASE_REQUIREMENTS.public_web)).toEqual(['terms', 'privacy-policy']);
  });

  it('submits the immutable wording version with a separate decision', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetch);
    await submitLegalDecision('facial-scan-consent', 'declined', 'facial-scan-draft-2026-09-23.1');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      contentId: 'facial-scan-consent', decision: 'declined', wordingVersionId: 'facial-scan-draft-2026-09-23.1',
    });
    vi.unstubAllGlobals();
  });

  it('keeps optional consent independently skippable', () => {
    expect(LEGAL_CONTENT['safety-lifestyle-consent'].applicability.requirement).toBe('optional');
    expect(LEGAL_CONTENT['safety-lifestyle-consent'].skipLabel).toBe('Skip for now');
  });
});
