# Rivet agentOS as the agent's computer — design

**Date:** 2026-11-07
**Owner:** Joshua W. Dorsey, Sr.
**Status:** draft — proposed for owner decision (2026-11-07). Not approved, not implemented. Every Rivet agentOS capability cited here was taken from Rivet's public documentation and repository on 2026-11-07 and has not been verified against a live deployment.
**Scope:** `mvp/` (NLT Coding Agent MVP on Vercel, project `nlt-pi-mvp`)

## 1. Intent

The repository's architecture names AgentOS as the agent's execution environment, the agent's "computer". Today that role is filled by one Vercel Sandbox: the agent's `bash`, `read`, `write`, `edit`, `ls` and `find` tools run inside it (`src/sandbox/operations.ts`, chosen by the owner on 2026-11-05). The owner now wants Rivet agentOS to be that computer.

- **Outcome:** the agent's tool operations execute inside a Rivet agentOS VM instead of a Vercel Sandbox, with every existing governance control preserved: harness policy review before each operation, crisis gate before any execution, computed egress policy, one turn at a time, no host environment, no credentials in the computer.
- **For whom:** the signed-in owner only, unchanged.
- **Success:** a live turn on the production deployment runs the agent's tools in agentOS, produces the same statuses (`completed`, `blocked`, `busy`, `no_free_model`, `timed_out`, `aborted`, `error`) under the same route and deadline, and a blocked host or command is blocked there exactly as it is today.

### Decisions (proposed; recorded here for the owner to confirm or change)

| Question | Proposed decision |
|---|---|
| What replaces the Vercel Sandbox as the computer | Rivet agentOS (Rivet's Linux-compatible sandbox: POSIX files, processes, shell and networking, powered by WebAssembly and V8 isolates, Apache-2.0). |
| Where agentOS runs | The hosted agentOS Rivet Actor (Rivet Cloud), reached over HTTP from the Vercel serverless function. The `@rivet-dev/agentos-core` library form runs a Rust sidecar process next to the host process, which a Vercel serverless function cannot own; it is allowed for local development only. |
| One computer or many | One persistent agentOS VM, named `nlt-agent` to mirror today's fixed-name sandbox, with a persisted filesystem. Never one per conversation. |
| What happens to the Vercel Sandbox | Retained behind `NLT_SANDBOX_BACKEND` as the default backend until the agentOS path is verified live, then demoted to fallback. Not deleted in this design. |
| What the agent's model sees | Nothing about the backend. The tool names, the harness review and the route contract are unchanged. |
| Egress | The same server-computed list (presets, always-allowed hosts, turn grants) is applied as agentOS network permissions. `NLT_AGENT_EGRESS_ALL=1` keeps its meaning; `NLT_ACCESS_REQUESTS` is unchanged. |

### Out of scope

- Changing the agent runner's order of events, the route contract, the model selection or the free-model rule.
- Moving the application off Vercel. Only the execution environment changes.
- Mounting the Vercel Sandbox inside agentOS through `@rivet-dev/agentos-sandbox` (Rivet's external-sandbox extension). It is the named fallback if hosted-agentOS verification fails, not the plan of record.
- Multi-agent use of the computer, concurrent turns, or a second VM.
- Any change to the ASFDK foundation, harness, MCP, memory, TOI or history layers.

## 2. How it works

```
today:   route -> gate -> free model -> lock(vercel sandbox) -> tools -> Vercel Sandbox (nlt-agent, /vercel/sandbox)
proposed: route -> gate -> free model -> lock(agentos vm)     -> tools -> Rivet agentOS (nlt-agent, /home/agentos/workspace)

backend choice at turn start:
  NLT_SANDBOX_BACKEND = "vercel"  (default until verified)  -> vercel-client.ts   (unchanged)
  NLT_SANDBOX_BACKEND = "agentos"                             -> agentos-client.ts   (new)
```

`src/sandbox/operations.ts` is documented in the MVP README as the swappable boundary, and `src/sandbox/vercel-client.ts` is kept separate from the lifecycle so the SDK is never loaded by tests. This design adds a second implementation of that same contract. Nothing above the sandbox layer changes: the route, the runner, the harness review and the tool set do not know which computer answered.

## 3. Rivet agentOS, as documented (2026-11-07, unverified live)

- **What it is.** Rivet's lightweight sandbox for agents: a Linux-compatible VM with a POSIX filesystem, processes, shell and networking, powered by WebAssembly and V8 isolates. It ships as a library, `@rivet-dev/agentos-core`, that runs the VM inside the backend process, with the kernel and all guest code held in a separate Rust sidecar process so untrusted code never enters the host process. Open source under Apache-2.0.
- **Hosted form.** A prebuilt agentOS Rivet Actor on Rivet Cloud gives each VM a durable id, versioned configuration, replayable output and expiring previews, controlled from `@rivet-dev/agentos` or plain HTTP. This is the deployment form the MVP would use, because the Vercel function cannot run the sidecar.
- **Filesystem.** In memory by default; options persist it and attach other filesystems.
- **Networking.** Outbound requests and serving HTTP from inside the VM happen under explicit permissions — the hook this design uses for egress.
- **Pi integration.** Rivet documents a first-class Pi path: `@rivet-dev/sandbox-adapter` with `agentOSProvider()` connects Pi's file and shell tools to agentOS, and the returned sandbox exposes `exec`, `readFile`, `writeFile`, `mkdir`, `stat`, `readdir` and `exists` on absolute paths, with a `cwd`. The VM ships coreutils (`sh` and basic commands).
- **What is not yet verified.** Every item above. The exact hosted-Actor API surface, credential handling, egress permission syntax, persistence guarantees, pricing and plan limits on Rivet Cloud, and behavior under a 270-second serverless deadline are unknown until a probe runs (section 10).

## 4. The client contract

`src/sandbox/agentos-client.ts` mirrors `vercel-client.ts`: the only module that loads the agentOS SDK, compile-checked against real SDK types, never imported by tests. It implements the interface the operations and lifecycle modules already consume:

- create or reconnect the one persistent VM (`nlt-agent`), with the workspace as the session `cwd`;
- `bash`, `read`, `write`, `edit`, `ls`, `find` operations with the existing caps (command timeout default 2 minutes, at most 10; output 1 MiB; reads 10 MiB; writes 2 MiB; size asked before any transfer);
- a fixed, configured environment only — the caller's environment is never forwarded, and the Vercel OIDC token, gateway credential, session cookie and database credentials never enter the VM;
- the lock primitives (section 6), ported to the agentOS filesystem;
- errors are errors, never passes.

If Rivet's `agentOSProvider` adapter satisfies this contract directly, the client wraps it rather than reimplementing it; the adapter's credential stays on the Vercel worker, which is Rivet's documented design for sandbox credentials. Any gap in the adapter (for example the `edit` operation, timeout parameters, or path-resolution behavior) is filled in the client, not by loosening the operations contract.

## 5. Deployment model and persistence

- **Hosted Actor as the plan of record.** The turn's sequence on the Vercel function is unchanged; where it today calls `Sandbox.getOrCreate`, it asks the agentOS client for the persistent VM. The workspace path becomes the agentOS VM's workspace path, and the gate's and operations' workspace root moves with it.
- **Persistence.** Today's sandbox keeps files across turns, and the access-request resume flow depends on that ("a resumed turn is a new session; only the sandbox files carry over"). The agentOS VM must therefore be configured with a persisted filesystem, not the in-memory default, and the same one VM must be reconnected each turn. If hosted persistence cannot guarantee this, the design fails its own success criterion and the fallback (section 1) applies.
- **Local development.** `@rivet-dev/agentos-core` may run the VM beside a local server for tests, never on Vercel. Nothing in the repository depends on it.
- **Cost and plan.** Vercel Sandbox usage currently counts against the Vercel plan; Rivet Cloud pricing and free-tier limits are not yet known and are a probe item, not an assumption.

## 6. Egress policy

The server already computes the egress list from presets, always-allowed hosts and turn grants, validates every entry, and applies it before the turn runs (fail closed to presets on lookup failure). That computation is unchanged. What changes is enforcement:

- the agentOS client translates the computed host list into agentOS network permissions for the turn, after the crisis gate and before the VM is touched, so a blocked prompt never reaches Rivet;
- presets (npm, yarn, PyPI, GitHub including `api.github.com` for `gh`) keep their meaning; `NLT_AGENT_EGRESS_ALL=1` maps to the agentOS allow-all equivalent and still suppresses the access-request tool;
- the lock is taken before the policy is stated, exactly as today (a reused computer keeps the policy it was created with);
- if the permissions call fails, the turn fails; it never widens.

The sandbox-access-requests design's authority model is preserved verbatim: the computer is not an authorization authority; it only enforces the policy the server computed from the owner's decisions. The access-request flow, its nonce binding and its Neon storage are untouched.

## 7. Lock and lifecycle

`src/sandbox/lifecycle.ts` keeps its contract and gains a backend parameter. The lock itself is already filesystem-based (an atomic `mkdir` of a directory holding the turn's random token, released only if the token is still its own), so it ports to the agentOS filesystem with the same semantics:

- one turn at a time; a second turn gets `SandboxBusyError` and touches nothing;
- a stale lock (older than 15 minutes) can be taken over under the same short-lived mutex; the takeover window and its millisecond caveat carry over as-is;
- the work function's `AbortSignal` aborts at 80% of the stale age; an unsettled turn throws `SandboxTurnTimeoutError` and the lock is left to expire;
- the lock scripts stay fixed text with every value passed as an argument; no model or user input reaches them; an agent with `bash` inside the VM could delete the lock, which would only allow two turns to overlap in the owner's own computer — same exposure, same wording in the README.

The 270-second absolute deadline, the stale age of 320 seconds and the grace period are unchanged; a hosted VM reached over HTTP adds one network hop where the Vercel SDK already had one, and the probe (section 10) must show that lock, policy and tool calls fit inside the budget with the same margin.

## 8. Safety

- **Isolation is still the boundary.** The path containment checks in the operations layer (workspace root, symlink resolution, policy review of both the given path and its target) remain guardrails, unchanged; the computer remains the security boundary. agentOS's own isolation claim (kernel and guest code in the sidecar, never in the host process) is an additional property of the hosted form, adopted only after live verification, not a substitute for the existing controls.
- **Governance order is untouched.** Crisis gate before any backend contact; harness `reviewToolCall` before every operation; authorization never inherited from one boundary to the next. agentOS becomes an independent enforcement point exactly as the architecture's AgentOS level requires: it verifies authorization at its execution boundary rather than trusting the agent's assertion.
- **Credentials.** Nothing new enters the computer. The Rivet credential (an agentOS token or API key) lives on the Vercel worker in memory, like the OIDC token today, and is never placed in the VM, a file, the session or a log.
- **Prompt injection and exfiltration.** Same exposure as today: content the agent reads can direct it to request an attacker's site, and an approved host can receive anything in the workspace. The access-request card, its warning text and the README statement carry over unchanged.
- **Logging.** Same rule, new names where needed: backend selection and effective policy per turn (`sandbox_backend`), agentOS client errors by operation name. Never the prompt, file contents or any credential.

## 9. Testing

- **Parity.** The existing operations and lifecycle tests run against a fake agentOS client with the same assertions used for the fake Vercel sandbox: policy review before each operation, path containment including symlink escapes, environment never forwarded, caps enforced, errors never passes, lock semantics (busy, stale takeover, abort, timeout).
- **Unit.** Backend selection (default, unknown value, unset); egress translation (presets, grants, allow-all, empty list, lookup failure fails closed); permission call failure fails the turn.
- **Mutation checks** on each rule: removing the policy review, the fail-closed egress path, the environment filter or the lock token check must fail a test.
- **Runner.** The offline suite with the faux provider and the fake agentOS client: same statuses, same short-circuits (blocked gate, no free model, busy computer each stop before the next step).
- **Not verifiable offline:** the hosted agentOS Actor, its persistence across turns, real egress enforcement inside the VM, coreutils sufficiency for the agent's commands, timing inside the 270-second budget, and Rivet Cloud plan limits. Confirmed by the probe (section 10), then one live turn with the owner after deploy.

## 10. Rollout

1. **Probe first (a throwaway script, not product code).** Before any implementation, a probe against a hosted agentOS Actor answers: the exact HTTP/SDK surface for exec and file operations; whether a persisted filesystem survives across Actor wake cycles; the egress permission syntax and whether an allowlist can express the presets; cold and warm timings for lock-plus-policy-plus-first-exec; pricing and plan limits. The probe's findings are recorded as a results file next to this spec (the mem0 spec and probe-results pair is the precedent) and the design is revised before implementation.
2. **Merge with `NLT_SANDBOX_BACKEND` unset:** no change in behavior; the Vercel Sandbox stays the computer.
3. **Owner sets `NLT_SANDBOX_BACKEND=agentos` plus the Rivet credential settings in one environment** (preview first) and runs a live turn: a file edit, a command, a blocked host, an access-request resume.
4. **Promote to production** after the owner accepts the results file; the Vercel Sandbox backend remains available as the fallback until the owner removes it in a later change.

**Governance records.** This design changes the execution boundary, so it follows the sandbox-access-requests precedent: its design PR carries a session registration (`docs/agent-log/registrations/`), an intent record (`docs/agent-log/intent/`), a handoff (`docs/agent-log/handoffs/`) and a thread in `docs/active-threads.md`. The implementation PR adds its own intent record before code, updates the thread and writes a new handoff. The MVP README's platform table, Sandbox tool operations, Sandbox lifecycle and Network paragraphs are updated then, not in this spec.

**Layering.** This is an AgentOS execution-environment change with owner authorization, in the architectural sense the README already uses: agentOS is the computer. The design does not touch the ASFDK development, foundation, harness or MCP layers; the crisis gate still runs before any backend contact; and the computer remains an enforcement point, never an authorization authority.

## 11. Known limits

- Everything about Rivet agentOS cited here is documented, not observed. The probe in section 10 is part of this design, not optional follow-up.
- The VM ships coreutils (`sh` and basic commands), not a full Linux userland. Commands the agent uses today without thinking (compilers, language runtimes, package managers) may be absent until software is added to the VM; the probe must list what the agent's corpus actually needs.
- The library form of agentOS cannot run on Vercel serverless functions (its sidecar is a process the function cannot own), so the hosted Actor is the only production form here.
- A resumed access-request turn is still a new session; only the computer's files carry over, and that now depends on Rivet Cloud persistence.
- Rivet agentOS is a young product; API and behavior changes are more likely than with the pinned `@vercel/sandbox` 3.6.1. The SDK version is pinned in the same spirit, and upgrades are deliberate.
- Two computers exist behind the flag during rollout, but only one is ever active per environment. A misconfigured environment variable, not the design, would be the way to get both.
