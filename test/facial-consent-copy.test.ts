import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { FACIAL_SCAN_COPY, LEGAL_CONTENT, approvedConsent, consentWordingVersion } from '../shared/legal-content.ts';

it('matches every Section 1 string in the distilled legal guide verbatim, including guardian wording', () => {
  const guide = readFileSync(new URL('../docs/LEGAL_IMPLEMENTATION_GUIDE.md', import.meta.url), 'utf8');
  const section = guide.split('### 1. Facial Scan Consent (before first scan)')[1].split('### 2.')[0];
  const quoted = [...section.matchAll(/`([^`]+)`/g)].map(match => match[1]);
  const content = LEGAL_CONTENT['facial-scan-consent'];
  expect([content.title, ...content.body, FACIAL_SCAN_COPY.checkbox, content.acceptLabel, content.declineLabel,
    FACIAL_SCAN_COPY.links.join(' | '), FACIAL_SCAN_COPY.footer, FACIAL_SCAN_COPY.guardianCheckbox]).toEqual(quoted);
  expect(content.status).toBe('placeholder'); expect(content.effectiveDate).toBeNull();
  const wording = consentWordingVersion(content.wordingVersionId)!;
  for (const text of quoted) expect(wording.text).toContain(text);
  expect(approvedConsent({ consentType: 'facial_scan', wordingVersionId: wording.id, state: 'granted', recordedAt: '', decisionId: '' })).toBe(false);
});
