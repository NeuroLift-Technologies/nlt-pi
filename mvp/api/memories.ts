/**
 * Owner-only memories (list, save, delete). Off unless the owner sets NLT_MEMORY_ENABLED=1.
 *
 * Wires src/memory/route.ts to Mem0. The owner is the signed-in Vercel user from the session cookie.
 * The Mem0 client and credentials are server side only — never passed to the browser or the sandbox.
 * This file is not exercised by the offline tests.
 */
import { sessionFromCookie } from "../src/auth/owner.ts";
import { type MemoryRequest, handleMemoryRequest } from "../src/memory/route.ts";
import { type MemoryStore, createMem0Store } from "../src/memory/store.ts";
import { createMemoryClient, type MemoryClientEnv } from "../src/memory/client.ts";
import type { AgentResponse } from "../src/agent/route.ts";
import { neon } from "@neondatabase/serverless";

let cachedClient: { env: MemoryClientEnv; client: ReturnType<typeof createMemoryClient> } | undefined;

function memoryClient(env: MemoryClientEnv) {
  if (!cachedClient || cachedClient.env !== env) {
    cachedClient = { env, client: createMemoryClient(env) };
  }
  return cachedClient.client;
}

let cachedSql: { url: string; sql: ReturnType<typeof neon> } | undefined;

function sqlFor(url: string) {
  if (!cachedSql || cachedSql.url !== url) {
    cachedSql = { url, sql: neon(url) };
  }
  return cachedSql.sql;
}

/**
 * Checks a source message in Neon: returns { kind } when the message exists, belongs to the owner,
 * and is not blocked/unavailable. Returns undefined otherwise.
 */
async function checkSourceMessage(databaseUrl: string, messageId: string, owner: string): Promise<{ kind: string } | undefined> {
  const sql = sqlFor(databaseUrl);
  const rows = await sql.query(
    `SELECT m.kind
     FROM chat_messages m
     JOIN chat_conversations c ON c.id = m.conversation_id
     WHERE m.id = $1 AND c.owner_sub = $2`,
    [messageId, owner],
  ) as Array<{ kind: string }>;
  if (rows.length === 0) return undefined;
  return { kind: rows[0].kind };
}

export default async function handler(request: MemoryRequest, response: AgentResponse) {
  const env = process.env as unknown as {
    NLT_MEMORY_ENABLED?: string;
    NLT_HISTORY_ENABLED?: string;
    DATABASE_URL?: string;
    MEM0_API_KEY?: string;
    MEM0_ORG_ID?: string;
    MEM0_PROJECT_ID?: string;
    MEM0_BASE_URL?: string;
  };

  const databaseUrl = env.DATABASE_URL;
  const store: MemoryStore = createMem0Store(memoryClient(env));

  await handleMemoryRequest(request, response, {
    env,
    owner: (req) => sessionFromCookie(process.env, req.headers?.cookie)?.sub,
    createStore: () => store,
    sourceMessage: databaseUrl
      ? async (messageId: string, ownerId: string) => checkSourceMessage(databaseUrl, messageId, ownerId)
      : undefined,
    log: (line) => console.warn(line),
  });
}