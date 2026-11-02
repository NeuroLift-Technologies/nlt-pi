# NLT-Pi Commit Message Format

`[AGENT_NAME] type(scope): imperative description`

Allowed types: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `ci`.

Governance amendments use `[HUMAN] docs(governance): …` instead of an agent name. They require explicit written approval under the amendment process in `NLT-DEV-OTOI.md` §10 and cannot be authored by an agent on its own initiative.

Examples:
- `[Claude] feat(runtime): add governed tool dispatch`
- `[Codex] fix(harness): reject unapproved capability`
- `[Copilot] docs(governance): clarify MCP boundary`
- `[HUMAN] docs(governance): align repository contract to ORG-DEV-OTOI-1.0.4`

Do not include secrets, credentials, or sensitive data in commit messages.
