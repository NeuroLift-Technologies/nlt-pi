/**
 * Pure helpers for saved chat history on the chat page. No DOM access; tested with node --test.
 * See docs/superpowers/specs/2026-11-05-chat-history-neon-design.md §4.
 */

/** The data notice shown while history is on (spec copy, verbatim). */
export const HISTORY_NOTICE =
  "Your conversations are saved to this project's Neon database until you delete them. Messages the safety check blocks are saved only as a 'blocked' marker, without their text.";

/** Shown for a stored blocked message, whose text is never kept. */
export const BLOCKED_PLACEHOLDER = "This message was blocked by the safety check.";

const STORED_KINDS = new Set(["normal", "blocked", "unavailable"]);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * History is on for this tab only after a 200 with a conversation list. Anything else (404 off, 401, 503, network
 * error, a malformed body) leaves the page as it is without history.
 *
 * @param {{ status?: number, body?: unknown, networkError?: boolean } | undefined} result
 */
export function interpretHistoryList(result) {
  if (!result || result.status !== 200 || !isRecord(result.body) || !Array.isArray(result.body.conversations)) {
    return { state: "off" };
  }
  const conversations = result.body.conversations
    .filter((c) => isRecord(c) && typeof c.id === "string" && typeof c.title === "string")
    .map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt }));
  return { state: "on", conversations };
}

/** A saved conversation and its messages, or undefined for anything but a well-formed 200. */
export function interpretConversation(result) {
  if (!result || result.status !== 200 || !isRecord(result.body)) return undefined;
  const { conversation, messages } = result.body;
  if (!isRecord(conversation) || typeof conversation.id !== "string" || !Array.isArray(messages)) return undefined;
  return {
    conversation,
    messages: messages.filter(
      (m) => isRecord(m) && typeof m.id === "string" && (m.role === "user" || m.role === "assistant") && typeof m.text === "string",
    ),
  };
}

/**
 * The POST body for an exchange. Skips the page's own messages (kind "info") and any without an id. Page kinds map to
 * stored kinds ("allowed" and unknown kinds become "normal"). If any message of the exchange is blocked, every message
 * of it is sent as blocked with empty text, so the prompt that was stopped is never stored.
 *
 * @returns {{ conversation: { id: string, title: string }, messages: object[] } | undefined}
 */
export function toSaveBody(conversation, messages) {
  const kept = messages.filter((m) => isRecord(m) && typeof m.id === "string" && m.kind !== "info");
  if (kept.length === 0) return undefined;
  const blocked = kept.some((m) => m.kind === "blocked");
  return {
    conversation: { id: conversation.id, title: conversation.title },
    messages: kept.map((m) => {
      const kind = blocked ? "blocked" : STORED_KINDS.has(m.kind) ? m.kind : "normal";
      const out = {
        id: m.id,
        role: m.role === "user" ? "user" : "assistant",
        kind,
        text: kind === "blocked" ? "" : String(m.text ?? ""),
        createdAt: (m.at instanceof Date ? m.at : new Date(m.at ?? Date.now())).toISOString(),
      };
      if (typeof m.model === "string") out.model = m.model;
      return out;
    }),
  };
}

/** Messages still to save: `pending` then `next`, without repeating an id. */
export function mergePending(pending, next) {
  const seen = new Set();
  const out = [];
  for (const m of [...pending, ...next]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}
