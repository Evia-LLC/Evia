import { LEGAL_RELEASE_REQUIREMENTS, unresolvedLegalContent } from '../shared/legal-content.ts';

const release = process.env.LEGAL_RELEASE;
const production = process.env.VERCEL_ENV === 'production' || process.env.CONTEXT === 'production' || process.env.LEGAL_PRODUCTION === 'true';

if (!production) {
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
