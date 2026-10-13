import { Errors } from "../lib/errors.js";

// Every handler here does `const { a, b } = await c.req.json()`. That is fine
// for an object, but `null`, `[]` and `"text"` are all VALID JSON, so they
// parse without error and then blow up at the destructuring as a TypeError --
// a 500 and a stack trace in the logs for what is plainly a bad request.
//
// Checked once, here, rather than in each of the ~100 handlers. Only bodies
// that PARSE are judged: an absent or truncated body keeps its existing
// behaviour (a 400 from the error handler, or the handler's own `.catch`).
// `c.req.json()` caches, so the handler's own call re-reads nothing.
const BODY_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export async function jsonObjectBody(c, next) {
  if (BODY_METHODS.has(c.req.method) && (c.req.header("content-type") || "").includes("application/json")) {
    let parsed;
    try {
      parsed = await c.req.json();
    } catch {
      return next(); // not JSON at all: leave it to the handler / error handler as before
    }
    // A JSON `null` is how some clients say "no body" (an HTTP DELETE with
    // nothing to send); treat it as the empty object rather than as an error,
    // so handlers see `{}` and answer with their own "field is required".
    if (parsed === null) {
      c.req.json = async () => ({});
    } else if (typeof parsed !== "object" || Array.isArray(parsed)) {
      throw Errors.badRequest("Request body must be a JSON object", "invalid_body");
    }
  }
  return next();
}
