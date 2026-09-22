# Contributing to Evia

Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing application boundaries.
The repository retains some Ese/Elohim names internally; changing the company
repository name does not migrate those identifiers or release unfinished work.

## Branches and review

- Start small feature branches from current `main` and open a pull request back
  to `main`. Treat `main` as the reviewed baseline.
- `codex/ese-holographic-studio` contains separate, unfinished feature work.
  It is not part of `main` merely because the branch exists. Review it separately.
- Ask a teammate to review before merging. Describe the user-visible change,
  validation, and known limitations. Include screenshots for visual changes.
- Review authentication, ownership, consent, capture quality and metric-version
  boundaries when changing data flows. Never disable these checks to make a test
  pass. Repository administrators manage access, branch protection and releases.

## Local setup and verification

Use a fresh clone of the company repository:

```sh
git clone https://github.com/Evia-LLC/Evia.git
cd Evia
```

The company repository has sanitized history. Do not push, merge, or mirror old
clones or archive branches into it: those can reintroduce removed private runtime
data. Keep the owner's historical archive separate from development work.

Use Node.js 24 and the committed lockfile:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run check
npm run test:local
npm run build
```

`test:local` runs the full suite against a fresh in-memory PGlite database. It
overrides both database URL variables, uses no persistent database directory,
and discards the database when finished. Its default loopback port is 5434;
set `ELOHIM_TEST_DB_PORT` to a free port if needed. A busy port fails before tests
start. Prefer this command over bare `npm test` for routine verification.

The build copies MediaPipe files from installed dependencies and may download
public model assets. These checks need no deployment or paid-provider secrets.
Run them in a shell without provider credentials. CI has read-only repository
permissions and performs no deployment.

For interactive development, use `npm run dev` with **both** `DATABASE_URL` and
`NETLIFY_DATABASE_URL` unset, including in local environment files. The dev
launcher then uses local PGlite under ignored `data/pglite/`. If either URL is
configured, the application can connect to that database instead. Use synthetic
fixtures and dedicated development credentials only; never use a production
database or customer photos for local work.

Keep databases, SQLite journals/WAL/SHM files, blobs, captures, `.env` files and
secrets out of commits. Check staged paths before committing. Ignoring or deleting
a tracked runtime file does not erase earlier Git history; report any historical
exposure privately to the repository owner for coordinated remediation.

## Product limitations

Skin and body metrics are provisional appearance estimates influenced by capture
conditions, camera, lighting and calibration. They are not clinically validated
diagnoses or direct hydration measurements. Synthetic tests do not establish
clinical accuracy, and product correlations do not establish causation. Preserve
quality and comparability gating, metric versions, and honest uncertainty in UI
and documentation.

The requested AI-generated homepage film is incomplete. An animated or recorded
3D preview is a different artifact and must not be presented as the delivered
AI-generated film. Keep that delivery and the holographic feature branch explicit
in reviews and release notes.
