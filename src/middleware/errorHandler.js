import { AppError } from "../lib/errors.js";

export function errorHandler(err, c) {
  if (err instanceof AppError) {
    return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
  }

  // Route handlers call `await c.req.json()` directly, which throws a
  // SyntaxError when the client sends an absent, truncated or non-JSON
  // body. That's a malformed *request*, not a server fault -- without this
  // it surfaced as a 500 (and logged a stack trace) on every bad body,
  // which both misleads clients and hands anyone a cheap way to fill the
  // logs. Matched narrowly on the parser's message so a SyntaxError raised
  // by our own code still reports as the internal error it is.
  if (err instanceof SyntaxError && /JSON/i.test(err.message)) {
    return c.json({ error: { code: "invalid_json", message: "Request body must be valid JSON" } }, 400);
  }

  console.error(err);
  return c.json({ error: { code: "internal", message: "Internal server error" } }, 500);
}
