# Compliance audit

This audit records launch-readiness findings. It is a project control, not a
legal opinion. A finding remains open until its exit criteria are met and the
audit is updated with verification evidence.

## Open findings

### CK-01 — Cookie and browser-storage consent scope is not approved

| Field | Value |
| --- | --- |
| Status | **Acknowledged — unresolved** |
| Launch impact | **Blocker** |
| Implementation state | Deferred pending an explicit product/compliance decision |
| Backlog | [CK-01](BACKLOG.md#ck-01--define-and-implement-the-cookie-consent-scope) |

The application uses browser-facing technologies whose cookie or consent
classification has not yet been supplied or approved. The required scope of a
cookie notice, consent banner, preference controls, and any consent-management
platform is likewise undecided. Launch must remain blocked rather than treating
the absence of a banner as a compliance conclusion.

#### Decision required

Explicit instruction must define:

1. the classification and required treatment of each cookie and comparable
   browser-storage use;
2. how Google Fonts and analytics loading are to be treated;
3. which regions, user states, and application surfaces the banner or controls
   must cover; and
4. whether a consent-management platform is required and, if so, which one and
   how it should be configured.

#### Current-phase constraint

Until that instruction is supplied, do **not**:

- change `index.html`;
- change cookie behavior, Google Fonts loading, local-storage usage, or
  analytics loading;
- add or configure a consent-management platform; or
- create placeholder cookie controls or a dormant banner, because either could
  be mistaken for a compliant implementation.

#### Exit criteria

CK-01 may be closed only after all of the following are complete:

- the cookie and browser-storage inventory has an approved classification;
- the banner and preference-management scope has been explicitly approved;
- the approved behavior has been implemented without placeholder controls;
- regional and consent-state behavior has been verified; and
- the audit contains links to the approval and verification evidence.
