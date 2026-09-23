import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('legal component accessibility contracts', () => {
  const decision = readFileSync('src/components/legal/ConsentDecision.svelte', 'utf8');
  const notice = readFileSync('src/components/legal/LegalPlaceholderNotice.svelte', 'utf8');
  it('uses native keyboard controls with no prechecked choice', () => {
    expect(decision.match(/type="radio"/g)).toHaveLength(2);
    expect(decision).not.toContain('checked=');
    expect(decision).not.toContain('tabindex="-1"');
  });
  it('exposes separate accept and decline actions and optional skip', () => {
    expect(decision).toContain("submit('accepted')");
    expect(decision).toContain("submit('declined')");
    expect(decision).toContain("submit('skipped')");
  });
  it('shows a labelled placeholder badge in review mode', () => {
    expect(notice).toContain('Placeholder · review only');
    expect(notice).toContain('aria-label="Placeholder legal content"');
  });
});
