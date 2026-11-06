import assert from "node:assert/strict";
import test from "node:test";
import { COMMANDS, helpText, parseSlash, resolveModel, suggestCommands } from "../public/lib/commands.js";

test("a known command is recognised, case-insensitively, with its arguments", () => {
  assert.deepEqual(parseSlash("/help"), { kind: "command", name: "help", args: "" });
  assert.deepEqual(parseSlash("  /NEW  "), { kind: "command", name: "new", args: "" });
  assert.deepEqual(parseSlash("/model nemotron free"), { kind: "command", name: "model", args: "nemotron free" });
});

test("paths, prose and unknown words are ordinary messages and are sent as typed", () => {
  for (const text of ["/vercel/sandbox/nlt-pi", "/etc/passwd", "/foo", "/foo bar", "hello /help", "what does /new do?", "/", "/ help", "/1abc", ""]) {
    assert.equal(parseSlash(text).kind, "none", JSON.stringify(text));
  }
  assert.equal(parseSlash(undefined).kind, "none");
  assert.equal(parseSlash(42).kind, "none");
});

test("a lone word that only starts a command is a hint, not a message", () => {
  const parsed = parseSlash("/he");
  assert.equal(parsed.kind, "partial");
  assert.deepEqual(parsed.matches.map((command) => command.name), ["help"]);
  assert.equal(parseSlash("/mo").kind, "partial");
  // With arguments it is not a lone word, so it is an ordinary message.
  assert.equal(parseSlash("/he there").kind, "none");
});

test("a leading // escapes the command so its text can still be sent", () => {
  assert.deepEqual(parseSlash("//help me understand this"), { kind: "escaped", text: "/help me understand this" });
  assert.deepEqual(parseSlash("//new"), { kind: "escaped", text: "/new" });
});

test("suggestions appear only while the first word is being typed", () => {
  assert.deepEqual(suggestCommands("/").map((c) => c.name), COMMANDS.map((c) => c.name));
  assert.deepEqual(suggestCommands("/m").map((c) => c.name), ["model"]);
  assert.deepEqual(suggestCommands("/ver"), []);
  assert.deepEqual(suggestCommands("/model "), []);
  assert.deepEqual(suggestCommands("/vercel/sandbox"), []);
  assert.deepEqual(suggestCommands("hello"), []);
  assert.deepEqual(suggestCommands(undefined), []);
});

test("/model resolves auto, exact, unique partial, ambiguous and unknown names", () => {
  const models = [
    { id: "nvidia/nemotron-3.5-lightning-free", label: "Nemotron Lightning" },
    { id: "nvidia/nemotron-ultra-free", label: "Nemotron Ultra" },
    { id: "stealth/glyph-cluster", label: "Glyph" },
  ];
  assert.deepEqual(resolveModel("", models), { ok: true, id: "" });
  assert.deepEqual(resolveModel("AUTO", models), { ok: true, id: "" });
  assert.deepEqual(resolveModel("stealth/glyph-cluster", models), { ok: true, id: "stealth/glyph-cluster" });
  assert.deepEqual(resolveModel("glyph", models), { ok: true, id: "stealth/glyph-cluster" });
  assert.deepEqual(resolveModel("nemotron lightning", models), { ok: true, id: "nvidia/nemotron-3.5-lightning-free" });
  const ambiguous = resolveModel("nemotron", models);
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reason, "ambiguous");
  assert.equal(ambiguous.matches.length, 2);
  assert.deepEqual(resolveModel("nope", models), { ok: false, reason: "none", matches: [] });
  assert.deepEqual(resolveModel("x", undefined), { ok: false, reason: "none", matches: [] });
});

test("an id chosen with /model can only be one the server listed", () => {
  const models = [{ id: "a/b-free", label: "B" }];
  assert.equal(resolveModel("evil/paid-model", models).ok, false);
});

test("help lists every command and the escape", () => {
  const text = helpText();
  for (const command of COMMANDS) assert.ok(text.includes(command.usage), command.usage);
  assert.ok(text.includes("//"));
});
