# Test the hosted sample demo

## Vercel from main (current setup)

The user authorized a sample-only deployment from `main` on Vercel's production URL. The tracked `vercel.json` supplies the explicit `sample_demo` build profile, visible demo notice, `EVIA_SAMPLE_DEMO=1`, and `DEMO_MODE=0` at runtime. Keep the standard `npm run build` command. No `LEGAL_RELEASE` dashboard setting is needed; remove an old conflicting override if one was added. This is hosting configuration, not approval to launch to real users.

Set `DATABASE_URL` to a dedicated sample-only Postgres database in Vercel's **Production** environment, since this deployment comes from `main`. Put `PERFECTCORP_API_KEY` there too if exercising the vendor path; `ANALYSIS_PROVIDER=local` avoids vendor calls for initial walkthroughs. Local `.env` is ignored and does not transfer through GitHub. Use the browser checklist below after deployment succeeds. No database/provider connectivity has been verified merely by building.

Before a real-user launch, remove the demo build/runtime profile and banner flag from `vercel.json`, select the appropriate normal legal release, obtain approved documents, and close the tracker blockers. Ordinary production legal checks remain intact.

## Alternative: Netlify preview


Use the preview URL rather than the production site. All data must be sample data. Automated checks passed (323 tests, TypeScript and Svelte); a deployed browser/camera test is still required.

## Deployment setup

Keep the production branch as `main`. Publish only `demo`. Use ONE route to avoid duplicate builds:

- Enable a branch deploy for `demo`, OR
- Open an unmerged pull request from `demo` to `main` with Deploy Previews enabled. Opening a PR does not merge it or push commits to main.

Netlify must already be linked to `Evia-LLC/Evia`. A branch push alone does not guarantee a preview. Configure runtime variables in Netlify's UI/API for the preview context (Functions scope, or all scopes), before the first build:

| Variable | Preview setting |
| --- | --- |
| `EVIA_SAMPLE_DEMO` | `1` to allow sample registration and review events |
| `DEMO_MODE` | `0`; do not publish the known seeded demo credentials |
| `ANALYSIS_PROVIDER` | `local` for initial testing without Perfect Corp credit usage |
| `DATABASE_URL` / `NETLIFY_DATABASE_URL` | A dedicated sample-only Postgres database, not production; the latter takes precedence |
| `PERFECTCORP_API_KEY` | Leave absent for initial UI testing |
| `ELOHIM_GUEST_VOICE` | `0` for initial testing without paid guest voice |

Do not inherit production provider keys or the production database into the preview. Provider keys are not needed for these UI tests. Without a preview database, guest walkthroughs work, but signup, account history and durable review events are unavailable. Keep the production legal guard enabled: deploy as `deploy-preview` or `branch-deploy`, not production. Runtime variables in `netlify.toml` are not available to Functions; use the UI/API.

Official references: [Deploy Previews](https://docs.netlify.com/deploy/deploy-types/deploy-previews/), [branch deploys](https://docs.netlify.com/deploy/deploy-types/branch-deploys/), [Functions environment variables](https://docs.netlify.com/build/functions/environment-variables/).

## Browser checklist

1. Open the preview in a private window. Check the cookie banner: Reject all, reopen cookie settings, and confirm optional categories are off. Test Manage preferences and Save. Marketing stays unavailable.
2. Visit `/legal/age-assurance`. Use sample DOBs representing under 16, 16–17 and 18+. Under 16 is blocked; 16–17 stays a guardian preview; debit/prepaid returns an explicitly mocked age-check failure. No guardian approval or camera unlock should be claimed.
3. Visit `/legal/subscription`. Check the 20.99 then 40 US dollars disclosure and guardian wording. Enable the EU/UK scenario: payment button stays disabled until its separate checkbox is checked. Clicking shows “Payments launch soon — check back shortly”. No charge occurs.
4. Visit `/legal/health-consent`, `/legal/safety-lifestyle-consent`, and `/legal/progress-photo-consent`. Check unticked defaults; WA/NV/CT branching; optional Skip for now; distinct refusal. Acceptance is labelled a demo review and does not enable photo storage.
5. Choose guest access from `/` to test chat and `/scan` without signup. Check the persistent AI notice and result disclaimer. The guest scan stays local. If testing camera consent, use a dedicated sample image or consenting operator; do not enter real client data. Camera and local analysis still use your device even though Netlify hosts the app.
6. With a dedicated preview database, register a sample adult account using an `example.test` email, sample DOB and separate Terms checkbox. Visit `/privacy`: review the controls and recorded versions/dates. Withdraw scan consent and check the stated behavior. Existing global/automatic-deletion limitations remain disclosed.
7. Visit `/settings/data`. Export the sample account, then test deletion using the typed DELETE and final confirmation. Never run this deletion test against a production account/database.
8. Check phone and desktop layouts. Record the URL, action, expected result, actual result and screenshot for any issue.

Expected demo limits: no live payments, certified age verification, real guardian approval, marketing, or activation of unapproved photo storage. Manager/legal/provider and retention gaps remain in `LEGAL_PROMISE_TRACKER.md`.
