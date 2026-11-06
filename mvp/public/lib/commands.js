/**
 * Page commands for the chat box ("/help", "/new", "/model", "/status"). No DOM access, so they can be unit-tested.
 *
 * These are handled entirely in the browser. A command is never sent to the governance gate, the agent or any
 * model, never saved to history, and never changes what the agent is allowed to do: it only drives controls
 * that already exist on the page (new conversation, model selector) or reads what the page already shows.
 *
 * A message is a command only when its single word after "/" is exactly a command name. Anything else, such as a
 * path ("/vercel/sandbox") or other text starting with a slash, is an ordinary message. A message starting with
 * "//" is sent with one slash removed, so text that begins with a command name can still be sent.
 */

export const COMMANDS = [
  { name: "help", usage: "/help", summary: "List the commands" },
  { name: "new", usage: "/new", summary: "Start a new conversation" },
  { name: "model", usage: "/model [auto|name]", summary: "Show or choose the model for the next turns" },
  { name: "status", usage: "/status", summary: "Show governance, agent, sign-in and storage state" },
];

const COMMAND_LINE = /^\/([A-Za-z][A-Za-z-]*)(?:\s+([\s\S]*))?$/;

/**
 * Classifies a composer message:
 * - { kind: "command", name, args }  a known command
 * - { kind: "partial", matches }     a lone word that is only the start of a command (for example "/he"), so it is
 *                                    answered with a hint and not sent as a message by mistake
 * - { kind: "escaped", text }        starts with "//": send text with one slash removed
 * - { kind: "none" }                 an ordinary message
 */
export function parseSlash(input) {
  const text = typeof input === "string" ? input.trim() : "";
  if (text.startsWith("//")) return { kind: "escaped", text: text.slice(1) };
  const match = COMMAND_LINE.exec(text);
  if (!match) return { kind: "none" };
  const word = match[1].toLowerCase();
  const known = COMMANDS.find((command) => command.name === word);
  if (known) return { kind: "command", name: known.name, args: (match[2] ?? "").trim() };
  if (match[2] === undefined) {
    const matches = COMMANDS.filter((command) => command.name.startsWith(word));
    if (matches.length > 0) return { kind: "partial", matches };
  }
  return { kind: "none" };
}

/** Commands to offer while the first word is still being typed ("/" or "/mo"). Empty once a space or another slash is typed. */
export function suggestCommands(input) {
  if (typeof input !== "string") return [];
  const match = /^\/([A-Za-z-]*)$/.exec(input);
  if (!match) return [];
  const word = match[1].toLowerCase();
  return COMMANDS.filter((command) => command.name.startsWith(word));
}

/**
 * Picks a model for "/model <name>" from the list the server gave the page. "" or "auto" means automatic (id "").
 * Matches an id or label exactly (ignoring case), else a single id or label containing the text.
 * @param {string} arg
 * @param {{ id: string, label: string }[]} models
 */
export function resolveModel(arg, models) {
  const wanted = typeof arg === "string" ? arg.trim().toLowerCase() : "";
  if (wanted === "" || wanted === "auto") return { ok: true, id: "" };
  const list = Array.isArray(models) ? models : [];
  const exact = list.filter((model) => model.id.toLowerCase() === wanted || String(model.label).toLowerCase() === wanted);
  if (exact.length === 1) return { ok: true, id: exact[0].id };
  const partial = exact.length > 0 ? exact : list.filter((model) => model.id.toLowerCase().includes(wanted) || String(model.label).toLowerCase().includes(wanted));
  if (partial.length === 1) return { ok: true, id: partial[0].id };
  return { ok: false, reason: partial.length === 0 ? "none" : "ambiguous", matches: partial.map((model) => model.id) };
}

/** The /help text. */
export function helpText() {
  return [
    "Commands (handled in this page; nothing is sent to the model):",
    ...COMMANDS.map((command) => `${command.usage}: ${command.summary}`),
    "To send a message that starts with a command name, begin it with //.",
  ].join("\n");
}
