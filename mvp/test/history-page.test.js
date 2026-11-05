import assert from "node:assert/strict";
import test from "node:test";
import {
  BLOCKED_PLACEHOLDER,
  HISTORY_NOTICE,
  interpretConversation,
  interpretHistoryList,
  mergePending,
  toSaveBody,
} from "../public/lib/history.js";

// Synthetic ids only.
const C = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333333";
const at = new Date("2026-11-05T12:00:00.000Z");

test("the notice is the spec's exact copy", () => {
  assert.equal(
    HISTORY_NOTICE,
    "Your conversations are saved to this project's Neon database until you delete them. Messages the safety check blocks are saved only as a 'blocked' marker, without their text.",
  );
  assert.equal(BLOCKED_PLACEHOLDER, "This message was blocked by the safety check.");
});

test("history is on only for a 200 with a conversation list", () => {
  const on = interpretHistoryList({
    status: 200,
    body: { conversations: [{ id: C, title: "T", createdAt: "x", updatedAt: "y" }, { id: 5 }, { title: "no id" }] },
  });
  assert.deepEqual(on, { state: "on", conversations: [{ id: C, title: "T", createdAt: "x", updatedAt: "y" }] });
  for (const result of [
    undefined,
    { networkError: true },
    { status: 404, body: { conversations: [] } },
    { status: 401 },
    { status: 503, body: { error: "History unavailable" } },
    { status: 200, body: null },
    { status: 200, body: { conversations: "nope" } },
  ]) {
    assert.deepEqual(interpretHistoryList(result), { state: "off" });
  }
});

test("a saved conversation is read only from a well-formed 200", () => {
  const body = { conversation: { id: C, title: "T" }, messages: [{ id: U, role: "user", kind: "normal", text: "hi", createdAt: "z" }, { bad: true }] };
  const read = interpretConversation({ status: 200, body });
  assert.equal(read?.conversation.id, C);
  assert.deepEqual(read?.messages.map((m) => m.id), [U]);
  for (const result of [undefined, { status: 404 }, { status: 200, body: {} }, { networkError: true }]) {
    assert.equal(interpretConversation(result), undefined);
  }
});

test("the save body skips the welcome message and maps page kinds", () => {
  const body = toSaveBody({ id: C, title: "T" }, [
    { kind: "info", role: "assistant", text: "Hello.", at }, // no id: the page's welcome
    { id: U, role: "user", text: "list files", at },
    { id: A, role: "assistant", kind: "allowed", text: "done", at, model: "synthetic/free" },
  ]);
  assert.deepEqual(body, {
    conversation: { id: C, title: "T" },
    messages: [
      { id: U, role: "user", kind: "normal", text: "list files", createdAt: at.toISOString() },
      { id: A, role: "assistant", kind: "normal", text: "done", createdAt: at.toISOString(), model: "synthetic/free" },
    ],
  });
  const info = toSaveBody({ id: C, title: "T" }, [{ id: U, kind: "info", role: "assistant", text: "Hello.", at }]);
  assert.equal(info, undefined);
});

test("a blocked exchange is sent with no text for both messages", () => {
  const body = toSaveBody({ id: C, title: "T" }, [
    { id: U, role: "user", text: "possibly sensitive words", at },
    { id: A, role: "assistant", kind: "blocked", text: "The governance gate stopped this message.", at },
  ]);
  assert.deepEqual(
    body?.messages.map((m) => [m.kind, m.text]),
    [
      ["blocked", ""],
      ["blocked", ""],
    ],
  );
});

test("an unavailable reply keeps its kind and the user's text", () => {
  const body = toSaveBody({ id: C, title: "T" }, [
    { id: U, role: "user", text: "hi", at },
    { id: A, role: "assistant", kind: "unavailable", text: "The agent is unavailable right now.", at },
  ]);
  assert.deepEqual(
    body?.messages.map((m) => [m.kind, m.text]),
    [
      ["normal", "hi"],
      ["unavailable", "The agent is unavailable right now."],
    ],
  );
});

test("the pending queue never duplicates a message", () => {
  const first = [{ id: U }, { id: A }];
  const merged = mergePending(first, [{ id: A }, { id: "x" }]);
  assert.deepEqual(merged.map((m) => m.id), [U, A, "x"]);
  assert.deepEqual(mergePending([], []), []);
});
