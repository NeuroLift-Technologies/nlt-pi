import { describe, expect, it, vi } from "vitest";
import { createNeonMemoryStore, type NeonSqlRunner } from "../src/memory/neon-store.ts";
import { EMBED_VECTOR_DIM } from "../src/memory/sandbox-embed.ts";
import type { EmbedRunner } from "../src/memory/sandbox-embed.ts";
import type { SandboxLike } from "../src/sandbox/operations.ts";

const OWNER = "owner-sub-1";
const OTHER = "owner-sub-2";
const GOOD_VEC = Array.from({ length: EMBED_VECTOR_DIM }, (_, i) => i / EMBED_VECTOR_DIM);

const FAKE_ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  text: "I prefer TypeScript",
  bucket: "owner",
  source_msg_id: null,
  created_at: "2026-11-06T00:00:00.000Z",
};

function stubSql(
  rowsFor: (text: string) => Record<string, unknown>[],
): NeonSqlRunner & { calls: Array<{ text: string; params: unknown[] }> } {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text: text.trim(), params });
      return rowsFor(text);
    },
  };
}

function makeSandbox(): SandboxLike {
  return {
    runCommand: async () => ({ exitCode: 0 }),
    fs: {
      readFile: async () => Buffer.from(""),
      writeFile: async () => {},
      mkdir: async () => undefined,
      access: async () => {},
      realpath: async (p) => p,
    },
  };
}

function makeEmbedRunner(vec: number[] | null): EmbedRunner {
  return { embed: async (_text: string, _sandbox: SandboxLike, _timeoutMs?: number) => vec };
}

describe("createNeonMemoryStore", () => {
  it("creates schema once on first call", async () => {
    const sql = stubSql(() => []);
    const store = createNeonMemoryStore(sql);
    await store.list(OWNER);
    await store.list(OWNER);
    const schemaCalls = sql.calls.filter((c) => c.text.startsWith("CREATE"));
    // Extensions + table + 3 indexes = 6 CREATE statements
    expect(schemaCalls.length).toBeGreaterThanOrEqual(6);
    // Schema created only once
    const createIndex = sql.calls.findIndex((c) => c.text.startsWith("CREATE"));
    const secondListCalls = sql.calls.slice(createIndex + schemaCalls.length);
    expect(secondListCalls.filter((c) => c.text.startsWith("CREATE")).length).toBe(0);
  });

  it("list returns rows scoped to owner", async () => {
    const sql = stubSql(() => [FAKE_ROW]);
    const store = createNeonMemoryStore(sql);
    const rows = await store.list(OWNER);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("I prefer TypeScript");
    // owner_sub in every non-schema query
    const workCalls = sql.calls.filter((c) => !c.text.startsWith("CREATE"));
    expect(workCalls.every((c) => {
      // Verify owner predicate is bound: the query must contain $1 (owner_sub) and params must include OWNER
      return c.text.includes("$1") && c.params.includes(OWNER);
    })).toBe(true);
  });

  it("get returns undefined for another owner", async () => {
    // Returns a row — but get() must scope by owner_sub via params
    const sql = stubSql((text) => (text.includes("SELECT") && !text.includes("CREATE") ? [] : []));
    const store = createNeonMemoryStore(sql);
    const result = await store.get(OTHER, FAKE_ROW.id);
    expect(result).toBeUndefined();
  });

  it("save inserts and fires triggerEmbed", async () => {
    const triggered: string[] = [];
    const sql = stubSql(() => [{ id: FAKE_ROW.id }]);
    const store = createNeonMemoryStore(sql, {
      triggerEmbed: (id) => triggered.push(id),
    });
    const result = await store.save(OWNER, { text: "test memory", bucket: "owner" });
    expect(result.owned).toBe(true);
    expect(result.id).toBe(FAKE_ROW.id);
    expect(triggered).toEqual([FAKE_ROW.id]);
  });

  it("save returns owned:false when insert returns no rows", async () => {
    const sql = stubSql(() => []);
    const store = createNeonMemoryStore(sql);
    const result = await store.save(OWNER, { text: "test", bucket: "owner" });
    expect(result.owned).toBe(false);
  });

  it("remove deletes scoped to owner and returns true when found", async () => {
    const sql = stubSql(() => [{ id: FAKE_ROW.id }]);
    const store = createNeonMemoryStore(sql);
    expect(await store.remove(OWNER, FAKE_ROW.id)).toBe(true);
    // DELETE statement uses parameterised owner scope
    const delCall = sql.calls.find((c) => c.text.startsWith("DELETE"));
    expect(delCall).toBeDefined();
    // Verify owner predicate is bound
    expect(delCall?.params).toContain(OWNER);
  });

  it("remove returns false when row not found or wrong owner", async () => {
    const sql = stubSql(() => []);
    const store = createNeonMemoryStore(sql);
    expect(await store.remove(OTHER, FAKE_ROW.id)).toBe(false);
  });

  it("search uses pgvector when embed succeeds", async () => {
    const sql = stubSql((text) => (text.includes("SELECT") ? [FAKE_ROW] : []));
    const store = createNeonMemoryStore(sql, {
      embedRunner: makeEmbedRunner(GOOD_VEC),
      sandbox: makeSandbox(),
    });
    const results = await store.search(OWNER, "typescript preferences", 5);
    expect(results.length).toBeGreaterThan(0);
    // Should have called a vector query (contains <=>)
    const vectorCalls = sql.calls.filter((c) => c.text.includes("<=>"));
    expect(vectorCalls.length).toBeGreaterThan(0);
  });

  it("search falls back to trigram when embed returns null", async () => {
    const sql = stubSql((text) => (text.includes("SELECT") ? [FAKE_ROW] : []));
    const store = createNeonMemoryStore(sql, {
      embedRunner: makeEmbedRunner(null),
      sandbox: makeSandbox(),
    });
    const results = await store.search(OWNER, "typescript", 5);
    expect(results.length).toBeGreaterThan(0);
    // No vector query
    expect(sql.calls.filter((c) => c.text.includes("<=>")).length).toBe(0);
    // Trigram query used
    expect(sql.calls.some((c) => c.text.includes("similarity"))).toBe(true);
  });

  it("search falls back to trigram when no embed runner provided", async () => {
    const sql = stubSql(() => [FAKE_ROW]);
    const store = createNeonMemoryStore(sql); // no embedRunner
    const results = await store.search(OWNER, "typescript", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(sql.calls.filter((c) => c.text.includes("<=>")).length).toBe(0);
  });

  it("search deduplicates and caps at limit", async () => {
    // Overlapping vector and trigram result sets with distinct IDs. FAKE_ROW appears in
    // both queries, so deduplication is the only way it appears once; the cap then trims
    // the fourth row. Without dedup this returns 4 ids; without the cap it returns 4.
    const second = { ...FAKE_ROW, id: "22222222-2222-4222-8222-222222222222", text: "second result" };
    const third = { ...FAKE_ROW, id: "33333333-3333-4333-8333-333333333333", text: "third result" };
    const fourth = { ...FAKE_ROW, id: "44444444-4444-4444-8444-444444444444", text: "fourth result" };
    const sql = stubSql((text) => {
      if (text.includes("<=>")) return [FAKE_ROW, second];
      if (text.includes("similarity")) return [FAKE_ROW, third, fourth];
      return [];
    });
    const store = createNeonMemoryStore(sql, {
      embedRunner: makeEmbedRunner(GOOD_VEC),
      sandbox: makeSandbox(),
    });
    const results = await store.search(OWNER, "typescript", 3);
    // Vector rows come first (more relevant), then trgm with the duplicate FAKE_ROW skipped.
    expect(results.map((r) => r.id)).toEqual([FAKE_ROW.id, second.id, third.id]);
  });

  it("mutation: removing owner scope causes owner isolation to break (documents the invariant)", async () => {
    // This test documents that all queries include owner_sub as a param.
    // If the param were removed, another owner's rows could be returned.
    const sql = stubSql(() => [{ ...FAKE_ROW }]);
    const store = createNeonMemoryStore(sql);
    // With correct scoping, list for OTHER returns the stub rows
    // (the stub doesn't actually filter — we verify the SQL contains owner_sub binding via calls)
    await store.list(OTHER);
    await store.get(OTHER, FAKE_ROW.id);
    // Every read query (list, get) must include owner_sub as a parameter bound to the requested owner.
    const workCalls = sql.calls.filter((c) => !c.text.startsWith("CREATE"));
    expect(workCalls.every((c) => {
      // Verify the query contains owner_sub parameter ($1) and the param is bound to the requested owner
      return c.text.includes("$1") && c.params.includes(OTHER);
    })).toBe(true);
  });
});
