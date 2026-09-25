import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGE_FLOW_COPY, ageOnDate, adultCardBranch, guardianReviewRecord } from '../shared/age-flow.ts';
import { PaymentService } from '../src/lib/payment-service.ts';

describe('age flow legal copy and safe preview states', () => {
  it('preserves every quoted §5, §6 and §7 string verbatim', () => {
    const guide = readFileSync('docs/LEGAL_IMPLEMENTATION_GUIDE.md', 'utf8');
    const section = guide.split('### 5. Age Assurance and Guardian Approval Flow')[1].split('### 8.')[0];
    const strings = [...section.matchAll(/`([^`]+)`/g)].map(m => m[1]);
    expect(Object.values(AGE_FLOW_COPY)).toEqual(strings);
  });
  it.each([
    ['2010-09-25', 15], ['2010-09-24', 16], ['2009-09-24', 17], ['2008-09-24', 18],
    ['2026-09-25', null], ['2008-02-30', null], ['2008-13-01', null], ['not-a-date', null],
  ])('routes DOB %s accurately at birthday boundaries', (dob, age) => {
    expect(ageOnDate(dob as string, new Date('2026-09-24T12:00:00Z'))).toBe(age);
  });
  it('routes credit to scan consent and debit/prepaid to the email age-check branch', () => {
    expect(adultCardBranch('credit')).toBe('scan-consent');
    expect(adultCardBranch('debit')).toBe('email-age-check');
    expect(adultCardBranch('prepaid')).toBe('email-age-check');
  });
  it('cannot fabricate guardian verification, card identifiers, approval or unlock', () => {
    const record = guardianReviewRecord({ accountId: 'sample', guardianName: 'Sample Guardian', guardianEmail: 'guardian@example.test',
      relationship: true, cardType: 'credit', illinois: true, wordingVersions: { terms: 'review' } });
    expect(record).toMatchObject({ verificationResult: 'not_verified', last4: null, fingerprintToken: null,
      illinoisIdResult: 'not_verified', approved: false, cameraUnlocked: false, demoOnly: true, ipAddress: null });
    expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it('keeps payments unavailable without calling or importing Stripe', () => expect(PaymentService.isEnabled()).toBe(false));
});
