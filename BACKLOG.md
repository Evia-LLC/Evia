# Project backlog

Items marked as launch blockers must be resolved or explicitly accepted by the
appropriate project and compliance owners before launch.

## Launch blockers

### CK-01 — Define and implement the cookie-consent scope

- **Status:** Acknowledged — unresolved
- **Priority:** Launch blocker
- **Audit finding:** [CK-01](COMPLIANCE_AUDIT.md#ck-01--cookie-and-browser-storage-consent-scope-is-not-approved)
- **Dependency:** Explicit instruction approving the cookie classification and
  banner scope

Obtain an approved classification for cookies and comparable browser storage,
including the required treatment of Google Fonts and analytics. Define the
regions, user states, controls, application surfaces, and consent-management
platform (if any) that the implementation must cover.

This item is intentionally not implementation-ready. Do not change
`index.html`, cookie behavior, Google Fonts loading, local-storage usage,
analytics loading, or a consent-management platform until the dependency above
is satisfied. Do not add placeholder cookie controls or a dormant banner.

Once explicit scope is available, plan the implementation and verification
work against the exit criteria in the compliance audit. Until then, CK-01 stays
open as an acknowledged unresolved launch blocker.
