import { describe, expect, it } from 'vitest';
import { emptyIntakeDraft, validateIntakeDraft, intakeProfileFields } from '../shared/intake.ts';
import { INTAKE_QUESTIONS, visibleIntakeQuestions } from '../src/lib/intake-content.ts';

describe('optional, self-reported intake validation', () => {
  it('allows every personal answer to be skipped without converting unknown into no', () => {
    const draft = validateIntakeDraft(emptyIntakeDraft());
    expect(draft.storageConsent).toBe(false); expect(draft.answers.ageBand).toBeNull();
    expect(intakeProfileFields(draft.answers).pregnancyStatus).toBe('unknown');
  });
  it('normalizes whitespace while preserving user wording', () => {
    const draft = emptyIntakeDraft(); draft.answers.preferredName = '  Ada  '; draft.answers.currentRoutine = '  cleanser\nmoisturizer  ';
    expect(validateIntakeDraft(draft).answers).toMatchObject({ preferredName: 'Ada', currentRoutine: 'cleanser\nmoisturizer' });
  });
  it.each([['preferredName', 'x'.repeat(61)], ['medications', 'x'.repeat(601)], ['allergies', {}], ['ageBand', '1991-04-01'], ['skinFeel', 'diagnosed rosacea'], ['goals', ['comfort', 'dryness', 'texture', 'breakouts']]])('rejects invalid %s without including sensitive values in the error', (key, value) => {
    const draft = emptyIntakeDraft(); (draft.answers as any)[key] = value;
    expect(() => validateIntakeDraft(draft)).toThrow();
  });
  it('rejects additional owner, photo and diagnosis fields', () => {
    for (const extra of [{ userId: 'other-account' }, { imageBase64: 'photo' }, { diagnosis: 'condition' }]) {
      expect(() => validateIntakeDraft({ ...emptyIntakeDraft(), ...extra })).toThrow();
    }
  });
  it.each(['true', 1, null])('does not coerce storage consent %j into permission', (storageConsent) => {
    expect(() => validateIntakeDraft({ ...emptyIntakeDraft(), storageConsent })).toThrow();
  });
  it('rejects control characters and prototype-shaped payloads', () => {
    const draft = emptyIntakeDraft(); draft.answers.medications = 'private\u0000text';
    expect(() => validateIntakeDraft(draft)).toThrow();
    expect(() => validateIntakeDraft(JSON.parse('{"schemaVersion":1,"storageConsent":true,"answers":{},"__proto__":{}}'))).toThrow();
  });
  it('asks pregnancy only after the person chooses to include it', () => {
    const draft = emptyIntakeDraft();
    expect(visibleIntakeQuestions(draft.answers).some((q) => q.key === 'pregnancyStatus')).toBe(false);
    draft.answers.pregnancyChoice = 'include';
    expect(visibleIntakeQuestions(draft.answers).some((q) => q.key === 'pregnancyStatus')).toBe(true);
    draft.answers.pregnancyStatus = 'prefer-not-to-say';
    expect(intakeProfileFields(validateIntakeDraft(draft).answers).pregnancyStatus).toBe('unknown');
    draft.answers.pregnancyChoice = 'skip';
    expect(() => validateIntakeDraft(draft)).toThrow();
  });
  it('only maps stated skin feel, chosen goals and explicit pregnancy status to a profile', () => {
    const draft = emptyIntakeDraft(); Object.assign(draft.answers, { skinFeel: 'mixed', goals: ['comfort'], allergies: 'Private allergy', medications: 'Private treatment', pregnancyChoice: 'include', pregnancyStatus: 'breastfeeding' });
    const profile = intakeProfileFields(validateIntakeDraft(draft).answers);
    expect(profile).toEqual({ skinType: 'combination', concerns: ['Feel calmer and more comfortable'], pregnancyStatus: 'breastfeeding' });
    expect(JSON.stringify(profile)).not.toContain('Private');
  });
  it('all question prompts are fixed public copy regardless of the draft', () => {
    const draft = emptyIntakeDraft(); draft.answers.preferredName = 'Unique private name'; draft.answers.medications = 'Unique private treatment';
    const prompts = visibleIntakeQuestions(draft.answers).map((q) => q.prompt).join(' ');
    expect(prompts).not.toContain('Unique private'); expect(INTAKE_QUESTIONS.every((q) => q.prompt.length > 8)).toBe(true);
  });
});
