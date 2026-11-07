/**
 * Background embed route, as a testable function. `api/embed.ts` wires it to the real sandbox.
 *
 * POST /api/embed { id: UUID }
 * Owner-only. Off unless NLT_MEMORY_ENABLED=1. Acquires the agent sandbox lock with a
 * 0-second wait (returns 503 { busy } immediately if a turn is running). Runs the embed
 * script, updates the memories.embedding column in Neon.
 *
 * Called fire-and-forget from the memory store's save(); the chat page never awaits it.
 * Failure is silent to the owner — the row stays usable via pg_trgm until embedded.
 */

import type { AgentRequest, AgentResponse } from "../agent/route.ts";
import type { NeonSqlRunner } from "./neon-store.ts";
import type { EmbedRunner } from "./sandbox-embed.ts";
import type { SandboxClient } from "../sandbox/lifecycle.ts";
import { withAgentSandbox } from "../sandbox/lifecycle.ts";
import { memoryEnabled } from "./route.ts";

export interface EmbedRouteDeps {
  env: { NLT_MEMORY_ENABLED?: string; DATABASE_URL?: string };
  owner: (request: AgentRequest) => string | undefined;
  sql: NeonSqlRunner;
  embedRunner: EmbedRunner;
  sandboxClient: SandboxClient;
  log: (line: string) => void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

export interface EmbedOutcome {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Runs one embed for a memory id + owner: look up the row, acquire the agent sandbox lock,
 * run the embedder, update the embedding column, and return the outcome. Consolidates the
 * former standalone background route so it can be invoked in-process from the memories save
 * path (one serverless function per file, keeping the Hobby plan deployment within its limit).
 */
export async function runEmbedForMemory(
  deps: EmbedRouteDeps,
  id: string,
  owner: string,
): Promise<EmbedOutcome> {
  // Look up the row — must exist, belong to this owner, and have no embedding yet.
  let text: string;
  try {
    const rows = await deps.sql.query(
      "SELECT text FROM memories WHERE id = $1 AND owner_sub = $2 AND embedding IS NULL",
      [id, owner],
    );
    if (rows.length === 0) {
      // Either not found, wrong owner, or already embedded.
      return { status: 200, body: { skipped: true } };
    }
    text = String(rows[0].text);
  } catch {
    deps.log(JSON.stringify({ event: "memory_embed", op: "lookup_error" }));
    return { status: 503, body: { error: "Memory unavailable" } };
  }

  // Try to acquire the sandbox lock with a 0-second stale age (never wait — return busy immediately).
  let vec: number[] | null = null;
  try {
    vec = await withAgentSandbox(
      deps.sandboxClient,
      async (sandbox) => deps.embedRunner.embed(text, sandbox),
      // lockStaleMs: 1 ms means any existing lock is "stale" immediately, so we never actually
      // wait. In practice, if the agent turn holds the lock, mkdir fails with exit 75 (BUSY)
      // before the stale check is reached. This gives us the 0-second-wait semantics.
      { lockStaleMs: 1, lockPath: "/tmp/nlt-embed.lock" },
    );
  } catch (err) {
    const name = err instanceof Error ? err.constructor.name : "";
    if (name === "SandboxBusyError") {
      deps.log(JSON.stringify({ event: "memory_embed", op: "busy" }));
      return { status: 503, body: { busy: true } };
    }
    deps.log(JSON.stringify({ event: "memory_embed", op: "sandbox_error" }));
    return { status: 503, body: { error: "Sandbox unavailable" } };
  }

  if (vec === null) {
    deps.log(JSON.stringify({ event: "memory_embed", op: "failed" }));
    return { status: 503, body: { embedFailed: true } };
  }

  // Update the embedding column. Scoped to owner and NULL check to avoid overwriting.
  try {
    const vecLiteral = `[${vec.join(",")}]`;
    await deps.sql.query(
      "UPDATE memories SET embedding = $1::vector WHERE id = $2 AND owner_sub = $3 AND embedding IS NULL",
      [vecLiteral, id, owner],
    );
  } catch {
    deps.log(JSON.stringify({ event: "memory_embed", op: "update_error" }));
    return { status: 503, body: { error: "Memory unavailable" } };
  }

  deps.log(JSON.stringify({ event: "memory_embed", op: "done" }));
  return { status: 200, body: { embedded: true } };
}

export async function handleEmbedRequest(
  request: AgentRequest,
  response: AgentResponse,
  deps: EmbedRouteDeps,
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

  if (!memoryEnabled(deps.env)) {
    response.status(404).json({ error: "Not found" });
    return;
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }
  const owner = deps.owner(request);
  if (!owner) {
    response.status(401).json({ error: "Sign in required" });
    return;
  }
  if (!isRecord(request.body)) {
    response.status(400).json({ error: "Body must be a JSON object" });
    return;
  }
  const { id } = request.body;
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    response.status(400).json({ error: "id must be a UUID" });
    return;
  }

  const outcome = await runEmbedForMemory(deps, id, owner);
  response.status(outcome.status).json(outcome.body);
}
