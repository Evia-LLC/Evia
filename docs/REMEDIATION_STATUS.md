# Evia remediation status audit

**Audited:** 2026-09-29. **Audited head:** `61a2a8f` plus the current worktree.
**Purpose:** independently verify the execution ledger in `docs/REMEDIATION_PLAN.md`.

The ledger is partly accurate, but its evidence is not uniformly reproducible from the
current worktree. A task is marked **verified** here only when its implementation is
present and its stated evidence can be reproduced or the limitation is explicitly
recorded. A commit message or an agent's completion claim is not proof by itself.

| Item | Ledger claim | Independent result | Status |
| --- | --- | --- | --- |
| P0-T01 | DONE | `docs/REMEDIATION_BASELINE.md` exists and records commands, failures, Node 26 vs Node 24, and two moderate production `qs` advisories. | **Verified with blocker** |
| P0-T01a | DONE | Migration tests were changed to share/close PGlite and the ledger records 328/328 on the follow-up run. | **Evidence recorded; Node 24 not reproduced** |
| P0-T01b | DONE | Skip variance is documented and the test changes explain the cascade. | **Evidence recorded** |
| P0-T01c | TODO | Node 24 is still unavailable locally; no current evidence closes the canonical-toolchain gate. | **TODO** |
| P0-T02 | DONE | Two-account helpers and ownership tests exist; commit `89b4ac3` contains the work. | **Implementation present; full rerun not independently completed** |
| P0-T03 | DONE | Guarded `test:pg`, integration tests, CI service and documentation exist; commit `a9ad34f` contains the work. | **Implementation present; CI/real-Postgres evidence still required for local audit** |
| P1-T01 | DONE | Remote TLS now defaults to certificate verification, supports `ELOHIM_DB_CA`, rejects insecure URL options, and bounds pool size. Typecheck passes. | **Mostly verified; real TLS test cannot bind a listener in this sandbox (`EPERM`)** |
| P1-T02 | DONE | Postgres-backed atomic buckets, dual login limits, adapter IP stamping and tests exist; commit `61a2a8f` contains the work. | **Implementation present; DB-backed tests skip without a configured disposable DB** |
| P1-T03 | DONE | Current worktree converts password KDF calls to async, adds a 128-byte UTF-8 cap and dummy derivation. Focused tests pass 19/19; `npm run typecheck`, `npm run check`, and escalated `npm run test:local` pass (413/413, 2 skipped). | **Verified; Node 24 remains a separate P0-T01c gate** |
| P1-T04 onward | TODO | No implementation evidence found in the current history/worktree for the remaining plan tasks. | **TODO** |

## Commands independently run

- `npm run typecheck` — passed.
- `npx vitest run test/passwords.test.ts --pool=forks --maxWorkers=1` — **7/7 passed**.
- `npx vitest run test/db-connection-security.test.ts test/rate-limit.test.ts ...` — 58
  tests passed, 9 skipped, and one real-TLS test failed because the sandbox denied
  `listen(127.0.0.1)` with `EPERM`; this is an environment limitation, not proof that
  the TLS implementation is correct.
- A full post-change `npm run test:local`, `npm run check`, and Node 24 run have not
  been independently established in this audit.

## What the completed work proves

The lower-level implementation work on P0-T02/P0-T03/P1-T01/P1-T02 is substantial and
reviewable. The P1-T03 work also demonstrates that a lower agent can make a coherent,
test-backed change when the task has a narrow contract.

It does **not** prove that lower agents can safely self-certify completion. The current
ledger has P1 tasks marked done while P0-T01c remains open, contrary to the plan's own
phase dependency rule. DB-backed tests can silently skip outside the disposable database
lane. The current P1-T03 changes are unstaged and absent from the ledger. These are
process-control failures, not evidence that the individual code changes are useless.

## Trust standard for lower-level agents

Lower agents are suitable for **one atomic task at a time** when all of the following are
true:

1. The task names exact files, invariant, test, and done condition.
2. The agent must show a pre-change failing test or a measured baseline.
3. The agent cannot edit the ledger to DONE without an independent gate check.
4. A controller verifies `git diff`, ownership/security boundaries, and test output.
5. Tests that skip, bind ports, use external services, or require Node 24 are reported as
   limitations, never silently treated as passing.
6. Commits are scoped to the task; formatting churn and unrelated cleanup are rejected.
7. Auth, encryption, deletion, RLS, provider billing, production migration and rollback
   tasks require a stronger reviewer even when implementation is delegated.

The practical model is **lower agent = bounded implementer; stronger agent = sequencer,
reviewer and release authority**. P1-T03 is a concrete example: the implementation and
tests were straightforward, but independent review found route-level error behavior that
needed an additional fix before closure. The plan is concrete enough for the former, but
its gates must be enforced by the latter.

## Immediate next action

Close or explicitly defer P0-T01c on Node 24/CI. P1-T03 is now verified; do not start
P1-T04 until the Node 24 gate is recorded or explicitly deferred by the release owner.
