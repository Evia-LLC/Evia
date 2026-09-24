import { LEGAL_RELEASE_REQUIREMENTS, unresolvedLegalContent } from '../shared/legal-content.ts';

const release = process.env.LEGAL_RELEASE;
const production = process.env.VERCEL_ENV === 'production' || process.env.CONTEXT === 'production' || process.env.LEGAL_PRODUCTION === 'true';

// Hosting a sample demo on a production URL is not legal approval for launch.
// Require the complete demo profile, including the visible client notice.
if (release === 'sample_demo') {
  if (process.env.EVIA_SAMPLE_DEMO !== '1' || process.env.DEMO_MODE !== '0' || process.env.VITE_SAMPLE_DEMO !== '1') {
    throw new Error('sample_demo requires EVIA_SAMPLE_DEMO=1, DEMO_MODE=0 and VITE_SAMPLE_DEMO=1');
  }
  console.warn('Legal content guard: SAMPLE-ONLY DEMO RELEASE. Draft policies remain unapproved; no real users. See LEGAL_PROMISE_TRACKER.md.');
} else if (!production) {
  console.log('Legal content guard: local/review build; placeholders are visible.');
} else {
  if (!release || !(release in LEGAL_RELEASE_REQUIREMENTS)) {
    throw new Error(`LEGAL_RELEASE must name one of: ${Object.keys(LEGAL_RELEASE_REQUIREMENTS).join(', ')}`);
  }
  const ids = LEGAL_RELEASE_REQUIREMENTS[release as keyof typeof LEGAL_RELEASE_REQUIREMENTS];
  const unresolved = unresolvedLegalContent(ids);
  if (unresolved.length) throw new Error(`Production release blocked: placeholder legal content: ${unresolved.join(', ')}`);
  console.log(`Legal content guard: ${release} is approved.`);
}
