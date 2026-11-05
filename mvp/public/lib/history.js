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

/** Server limits (src/history/route.ts), applied here so a save is never rejected for them. */
export const MAX_SAVE_BATCH = 20;
export const MAX_SAVED_TEXT = 20_000;
/** The route measures length in UTF-16 units (JavaScript string length), so the page does too. */
const MAX_TITLE_UNITS = 80;
/** Stays below the route's 524,288-byte body limit with room for the envelope. */
const MAX_BATCH_BYTES = 450_000;
export const TRUNCATED = "…(truncated)";
/** Shown and saved as the title when a conversation's first message was blocked, so no part of it is kept. */
export const BLOCKED_TITLE = "Blocked message";

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** Well-formed text (lone surrogates become U+FFFD) without NUL characters, which Postgres text cannot hold. */
function clean(value) {
  const text = String(value ?? "");
  const formed = typeof text.toWellFormed === "function" ? text.toWellFormed() : text.replace(LONE_SURROGATE, "\ufffd");
  return formed.replaceAll("\u0000", "");
}

/** At most `max` UTF-16 units, never ending in the first half of a surrogate pair. */
function cutUnits(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** A sidebar title from the first prompt: at most `max` characters (code points), plus "…" when cut. */
export function shortTitle(text, max) {
  const chars = Array.from(clean(text));
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : chars.join("");
}

/** The title sent to the server: well formed, trimmed, 1 to 80 UTF-16 units. */
export function saveTitle(title) {
  const cut = cutUnits(clean(title).trim(), MAX_TITLE_UNITS).trim();
  return cut.length > 0 ? cut : "Conversation";
}

/**
 * One finished exchange in stored form. Skips the page's own messages (kind "info") and any without an id. Page kinds
 * map to stored kinds ("allowed" and unknown kinds become "normal"). If any message of this exchange is blocked, every
 * message of it is stored as blocked with empty text, so the prompt that was stopped is never kept, not even in the
 * page's retry queue. Text is cut to the server's limit with a marker, and a time ahead of `now` becomes `now`.
 */
export function toStoredMessages(exchange, now = Date.now()) {
  const kept = exchange.filter((m) => isRecord(m) && typeof m.id === "string" && m.kind !== "info");
  const blocked = kept.some((m) => m.kind === "blocked");
  let previous = Number.NEGATIVE_INFINITY;
  return kept.map((m) => {
    const kind = blocked ? "blocked" : STORED_KINDS.has(m.kind) ? m.kind : "normal";
    const raw = kind === "blocked" ? "" : clean(m.text);
    const text = raw.length > MAX_SAVED_TEXT ? `${cutUnits(raw, MAX_SAVED_TEXT - TRUNCATED.length)}${TRUNCATED}` : raw;
    const parsed = m.at instanceof Date ? m.at.getTime() : Date.parse(m.at ?? "");
    // Not ahead of now, and strictly after the previous message, so the stored order is the order they happened.
    const at = Math.max(Number.isFinite(parsed) ? Math.min(parsed, now) : now, previous + 1);
    previous = at;
    const out = { id: m.id, role: m.role === "user" ? "user" : "assistant", kind, text, createdAt: new Date(at).toISOString() };
    if (typeof m.model === "string") out.model = cutUnits(clean(m.model), 200);
    return out;
  });
}

/** The first messages of `queue` that fit one request: at most 20, and under the body size limit (at least one). */
function nextBatch(queue) {
  const batch = [];
  let bytes = 1024; // envelope
  for (const m of queue.slice(0, MAX_SAVE_BATCH)) {
    const size = new TextEncoder().encode(JSON.stringify(m)).length + 1;
    if (batch.length > 0 && bytes + size > MAX_BATCH_BYTES) break;
    batch.push(m);
    bytes += size;
  }
  return batch;
}

/**
 * Saves exchanges for each conversation, one request at a time per conversation. Messages wait in
 * `conversation.unsaved` until the server accepts them; a failed request keeps them for the next exchange, and a
 * rejected batch (400) is dropped so it cannot block later saves. Sets `conversation.saveState` ("saving", then "saved"/"unsaved"),
 * `conversation.stored` once anything was accepted, and `conversation.saving` (the running chain).
 *
 * @param {(body: object) => Promise<{ status?: number }>} send
 */
export function createSaver(send) {
  async function flush(conversation) {
    while (conversation.unsaved.length > 0) {
      const batch = nextBatch(conversation.unsaved);
      const result = await send({ conversation: { id: conversation.id, title: saveTitle(conversation.title) }, messages: batch });
      if (result?.status === 200 || result?.status === 400) {
        const sent = new Set(batch.map((m) => m.id));
        conversation.unsaved = conversation.unsaved.filter((m) => !sent.has(m.id));
        if (result.status === 200) conversation.stored = true;
        else conversation.dropped = true;
        continue;
      }
      break; // keep everything for the next exchange
    }
    conversation.saveState = conversation.unsaved.length === 0 && !conversation.dropped ? "saved" : "unsaved";
  }

  return {
    /** Queues an exchange and resolves when this conversation's saves have settled. Never rejects. */
    enqueue(conversation, exchange, now = Date.now()) {
      conversation.unsaved = mergePending(conversation.unsaved ?? [], toStoredMessages(exchange, now));
      conversation.saveState = "saving";
      conversation.saving = (conversation.saving ?? Promise.resolve()).then(() => flush(conversation)).catch(() => {
        conversation.saveState = "unsaved";
      });
      return conversation.saving;
    },
    /** Resolves once no save is running for this conversation. */
    idle(conversation) {
      return conversation.saving ?? Promise.resolve();
    },
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
