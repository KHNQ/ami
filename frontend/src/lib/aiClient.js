import { getToken } from "./token.js";

// The assistant's transport.
//
// Separate from lib/api.js on purpose: every method there parses one JSON
// body and returns it, which is exactly the wrong shape for a token stream.
// This reads the response incrementally and hands each fragment to a
// callback, so the answer types out instead of appearing all at once after
// a long silence.
//
// EventSource is deliberately not used: it is GET-only, and the question
// (plus session and product scope) belongs in a POST body rather than smeared
// across a query string that ends up in every access log.

const API_PORT = import.meta.env.VITE_API_PORT || "3000";

function baseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (configured) return configured;
  if (typeof window === "undefined") return `http://localhost:${API_PORT}`;
  return `${window.location.protocol}//${window.location.hostname}:${API_PORT}`;
}

/**
 * A stable per-browser id so follow-up questions ("and how much is that
 * one?") land in the same server-side conversation.
 *
 * sessionStorage, not localStorage: the thread should not still be running
 * a week later, and it should not leak between tabs the visitor thinks of
 * as separate visits.
 */
export function sessionId() {
  if (typeof window === "undefined") return null;
  const KEY = "trex-ai-session";
  try {
    let id = window.sessionStorage.getItem(KEY);
    if (!id) {
      id = `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      window.sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // Private browsing: fall back to a per-page-load id. Follow-ups within
    // this page still work; a reload starts fresh, which is acceptable.
    return `s_ephemeral_${Date.now().toString(36)}`;
  }
}

/**
 * Streams an answer.
 *
 * Calls `onDelta` with each text fragment, `onSources`/`onSuggestions` once
 * with structured data, and resolves when the stream closes. Returns an
 * `abort()` so a component unmounting (or the visitor hitting stop) drops the
 * request rather than leaving a generation running that nobody will read.
 */
export function streamChat({
  message,
  productId = null,
  routeContext = null,
  // The conversation this turn belongs to. A signed-in caller passes the id
  // the server gave them; anyone else falls back to the per-tab id below.
  session = null,
  // Ids of files already uploaded through /ai/attachments. Never the bytes:
  // uploading happens while the visitor is still typing, so pressing send
  // posts a few dozen characters rather than five megabytes.
  attachmentIds = [],
  onDelta,
  onSources,
  onSuggestions,
  onError,
  // Every event the server sends, named or not. The agent adds several
  // (thinking, tool_call, tool_result, client_action, confirm_required,
  // step, retract, teaser); routing them through one passthrough means a
  // server that learns a new event does not need a client deploy first.
  onEvent,
}) {
  const controller = new AbortController();

  const done = (async () => {
    const headers = { "content-type": "application/json" };
    const token = getToken();
    // Optional: the endpoint is anonymous. Sending the token when there is
    // one only lets the admin log attribute the conversation.
    if (token) headers.authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(`${baseUrl()}/ai/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message,
          product_id: productId,
          session_id: session || sessionId(),
          attachment_ids: attachmentIds,
          // Where the visitor is, so "what is this?" resolves against the
          // page in front of them. A fixed constant from routeContext.js,
          // never anything the visitor typed.
          route_context: routeContext,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name !== "AbortError") onError?.(new Error("Could not reach the assistant."));
      return;
    }

    if (!res.ok || !res.body) {
      // The error body is JSON even though the success path is a stream.
      const detail = await res.json().catch(() => null);
      onError?.(new Error(detail?.error?.message || "The assistant is unavailable right now."));
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are blank-line separated. A network chunk can split one
        // mid-frame, so the remainder stays buffered for the next read.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";

        for (const frame of frames) {
          let event = "message";
          let data = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (!data) continue;

          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }

          // Unknown events are handed to onEvent and otherwise ignored --
          // never treated as an error. Server and client deploy separately,
          // so the client must tolerate an event it has never heard of.
          onEvent?.(event, parsed);

          if (event === "delta") onDelta?.(parsed.text);
          // `sources` may now arrive more than once in a turn: the catalogue
          // hits come before the first token, and a web search adds more at
          // step two. Each arrival is an APPEND, not a replacement.
          else if (event === "sources") onSources?.(parsed);
          else if (event === "suggestions") onSuggestions?.(parsed);
          else if (event === "error") onError?.(new Error(parsed.message));
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") onError?.(new Error("The connection dropped."));
    } finally {
      reader.releaseLock?.();
    }
  })();

  return { done, abort: () => controller.abort() };
}

/** Retrieval-only related products. No model call, so this is free and fast. */
export async function suggestProducts({ query, limit = 4, excludeProductId = null }) {
  try {
    const res = await fetch(`${baseUrl()}/ai/suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, limit, exclude_product_id: excludeProductId }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.suggestions || [];
  } catch {
    // A decorative strip of related devices is never worth surfacing an
    // error for -- it simply doesn't render.
    return [];
  }
}

/* --- conversations ------------------------------------------------------ */

// Signed-in visitors get durable, listable conversations; anonymous ones keep
// the ephemeral per-tab thread `sessionId()` above provides. These helpers are
// therefore only ever called with a token.

async function authed(path, { method = "GET", body } = {}) {
  const headers = { "content-type": "application/json" };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message || "Request failed");
  return data;
}

export const listSessions = () => authed("/ai/sessions").then((d) => d.sessions || []);
export const getSession = (id) => authed(`/ai/sessions/${id}`);
export const renameSession = (id, title) => authed(`/ai/sessions/${id}`, { method: "PATCH", body: { title } });
export const deleteSession = (id) => authed(`/ai/sessions/${id}`, { method: "DELETE" });

/* --- attachments -------------------------------------------------------- */

/**
 * Sends one file and gets back the id the next message will reference.
 *
 * Deliberately separate from the chat request. Uploading a 3MB photograph
 * takes as long as it takes; doing it while the visitor is still typing their
 * question means the turn itself is as fast as any other, and a failed upload
 * can be reported next to the file rather than swallowing the message.
 */
export const uploadAttachment = ({ dataUrl, filename, session = null }) =>
  authed("/ai/attachments", {
    method: "POST",
    body: { data_url: dataUrl, filename, session_id: session },
  });

/** Today's allowance. One indexed lookup server-side; safe to call on open. */
export const getQuota = () => authed("/ai/quota");

/** Answers a confirmation card. Quota-exempt server-side: saying yes is not a new prompt. */
export const confirmProposal = (proposalId, decision = "confirm") =>
  authed("/ai/confirm", { method: "POST", body: { proposal_id: proposalId, decision } });
