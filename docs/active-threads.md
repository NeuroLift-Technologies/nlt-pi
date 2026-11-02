# Active Threads — NLT-Pi

**Last updated:** 2026-11-02T01:20:59Z

> **Format note:** entries follow ORG-DEV-OTOI-1.0.4 section 6. `Started` values for threads created before this file adopted that format record the governance adoption date (`2026-11-01`) from repository history; exact start times were never recorded and have not been invented.

## Active

### Thread: NLTPI-ARCH-001
**Status:** open
**Owner:** Joshua W. Dorsey, Sr.
**Started:** 2026-11-01T00:00:00Z
**Last updated:** 2026-11-02T01:20:59Z
**Summary:** Maintain explicit separation between development governance, ASFDK foundation, ASFDK harness enforcement, and ASFDK MCP integration governance. No ASFDK code exists in this repository; the three-layer model is currently documentation only.
**Blockers:** No ASFDK harness wraps `packages/agent` tool execution (`beforeToolCall` / `afterToolCall`). Requires an architecture decision.
**Next action:** Escalate harness integration; do not infer enforcement from documentation.

### Thread: NLTPI-GOV-002
**Status:** open
**Owner:** Joshua W. Dorsey, Sr.
**Started:** 2026-11-02T00:12:22Z
**Last updated:** 2026-11-02T01:20:59Z
**Summary:** Align repository governance artifacts to ORG-DEV-OTOI-1.0.4, the canonical public contract in NeuroLift-Technologies/.github. Restores the anti-self-amendment clause, adds the commit format to AGENTS.md, the canonical pointer to CLAUDE.md, factual-accuracy checks to REVIEW.md, and the section 6 active-threads format.
**Blockers:** `SECURITY.md` still routes vulnerability reports to an upstream third-party address (`security@earendil.com`); repointing it is a security-boundary change requiring owner approval. The repository escalation channel remains unavailable: `nlt-pi` issues are disabled and `.github` lacks the `escalation` / `agent` labels (tracked in NeuroLift-Technologies/.github#13).
**Next action:** Owner review of this pull request, then approval to re-point `SECURITY.md`.

### Thread: NLTPI-GOV-003
**Status:** blocked
**Owner:** Joshua W. Dorsey, Sr.
**Started:** 2026-11-02T00:12:22Z
**Last updated:** 2026-11-02T01:20:59Z
**Summary:** Upstream governance defects reported against NeuroLift-Technologies/.github: escalation labels absent, SOP versions unbumped, and `.github/CLAUDE.md` failing its own SOP Step 6 checklist. The missing 1.0.4 change-log item is withdrawn: the owner confirmed the change log is maintained in the private internal repository.
**Blockers:** This agent holds `issues: write` but not `contents: write` on `.github`, so it can file but not fix. Owner decision required.
**Next action:** Track via NeuroLift-Technologies/.github#13.

## Resolved

### Thread: NLTPI-GOV-001
**Status:** resolved
**Owner:** Joshua W. Dorsey, Sr. / delegated coding agents
**Started:** 2026-11-01T00:00:00Z
**Last updated:** 2026-11-02T01:20:59Z
**Summary:** Repository governance adoption. PR #3 merged; the governance validator passes 36/36.
**Blockers:** None.
**Next action:** None — superseded by NLTPI-GOV-002.

### Thread: NLTPI-CONTRIB-001
**Status:** resolved
**Owner:** Joshua W. Dorsey, Sr.
**Started:** 2026-11-02T00:00:00Z
**Last updated:** 2026-11-02T01:20:59Z
**Summary:** Remove the fork-inherited contributor auto-close/approval gate. PR #4 merged as `034f01e02`; `pr-gate.yml`, `issue-gate.yml`, `approve-contributor.yml`, `.github/APPROVED_CONTRIBUTORS`, and the local `CONTRIBUTING.md` are removed, so the organization default guide applies.
**Blockers:** None.
**Next action:** Remaining documentation that still asserts the deleted auto-close behaviour is tracked as NLTPI-CONTRIB-002.

### Thread: NLTPI-CONTRIB-002
**Status:** resolved
**Owner:** Joshua W. Dorsey, Sr.
**Started:** 2026-11-02T01:20:59Z
**Last updated:** 2026-11-02T01:20:59Z
**Summary:** Remove the four surviving statements that told contributors their issues and PRs would be auto-closed, which stopped being true when PR #4 merged. Affected `.github/ISSUE_TEMPLATE/bug.yml`, `contribution.yml`, `package-report.yml`, and `packages/coding-agent/README.md`, which also linked to the upstream vendor's contribution guide instead of the organization default.
**Blockers:** None.
**Next action:** None.
