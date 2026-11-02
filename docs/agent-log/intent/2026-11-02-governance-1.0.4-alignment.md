# NLT-Pi Intent Record

**Date:** 2026-11-02T00:12:22Z  
**Agent / session:** Cline (`cline-cloud[bot]` GitHub App)  
**Branch:** `cline/mra9at1d`  
**OTOI:** NLT-PI-DEV-OTOI-1.0.4 / ORG-DEV-OTOI-1.0.4

## Intended action

Align this repository's governance artifacts to `ORG-DEV-OTOI-1.0.4`, the canonical contract for public NeuroLift Technologies repositories, following the owner's direction to "make sure the governance files in pi match 1.0.4".

Files affected: `NLT-DEV-OTOI.md`, `AGENTS.md`, `CLAUDE.md`, `REVIEW.md`, `docs/active-threads.md`, `templates/commit-message.md`, `templates/agent-registration.json`, `templates/handoff-record.json`, `templates/intent-log.md`, `nltotoi.json`, `.nltotoi/**`, `.claude/settings.json`, `.claude/README.md`, `.claude/hooks/session-start.sh`, `SOPs/repo-governance-setup.md`.

## Rationale

The owner ruled that `NeuroLift-Technologies/.github` is canonical for public repositories and that a divergent SOP must change. This repository is public (`private: false`, `visibility: public`), so `ORG-DEV-OTOI-1.0.4` governs it.

Prior state had four substantive gaps against that contract:

1. The contract cited `.github-private` — the internal line — as its governance source.
2. The amendment clause permitted changes by "the repository owner through explicit review" and omitted any prohibition on agent self-amendment.
3. Commit format, canonical pointer, review factuality checks, and the section 6 active-threads format were absent.
4. Templates and manifests carried the superseded local identifier and source.

## Risks and trust boundaries

- **Authority boundary.** Editing a governance contract is an amendment-shaped action. Mitigation: this alignment is explicitly directed by the owner, recorded here before execution, and delivered as a pull request rather than a direct push to `main`.
- **Self-amendment.** This change *restores* the canonical prohibition on agent self-amendment. It does not remove any guardrail and does not weaken any existing rule.
- **Provenance.** The two historical agent-log records (`docs/agent-log/registrations/`, `docs/agent-log/handoffs/`) are deliberately left at `NLT-PI-DEV-OTOI-1.0.0`. Rewriting history to match a newer version would falsify what those sessions actually declared.
- **Not in scope.** `SECURITY.md` still routes reports to `security@earendil.com`. Repointing a vulnerability-reporting channel is a security-boundary change and is left for explicit owner approval. The upstream `CONTRIBUTING.md` override is likewise left pending decision.
- No credentials, tokens, or private-repository content are introduced. `.github-private` remains referenced only to describe scope.

## Alternatives considered

- **Leave the local contract at 1.0.0 and patch only the SOP references.** Rejected: leaves the repository governed by a superseded line and keeps the internal source citation.
- **Delete `NLT-DEV-OTOI.md` and link only to the canonical contract.** Rejected for now: the canonical artifacts contain no ASFDK content (0 references), while this repository's contract carries the three-layer development / foundation / harness / MCP model (7 references). Deleting it would remove functionality without approval. This record keeps the local document as an aligned supplement.
- **Copy the internal contract wholesale.** Rejected: the owner ruled `.github` canonical for public repositories.

## Human approval / escalation

Required and obtained in direction: the owner instructed that the governance files be made to match 1.0.4. The commit format for governance amendments is `[HUMAN]`; because this work was agent-executed under explicit direction, the commit uses an agent identifier and cites this record. Owner review of the pull request is still required before merge.

## Outcome

Complete after execution. See the pull request and handoff record.
