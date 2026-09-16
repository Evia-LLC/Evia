/**
 * Placeholder for the bundled API - committed so Vercel's build validation
 * finds a file at the path `vercel.json` names, replaced during every build.
 *
 * Vercel checks the `functions` patterns against the repository BEFORE the
 * build command runs, so the real bundle (which `scripts/build-api.mjs`
 * generates from server/vercel.ts inside the build) cannot be the only thing
 * at this path. This stub is what ships if that regeneration ever silently
 * stops happening - and it says so out loud instead of serving nothing.
 */
export default function handler(req, res) {
  res.statusCode = 503;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(
    JSON.stringify({
      error:
        'The API bundle was not regenerated during the build. scripts/build-api.mjs did not run - check the build logs.',
    }),
  );
}
