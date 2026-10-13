import { Hono } from "hono";

// What `/ai/*` is when the assistant is switched off.
//
// Mounted INSTEAD of routes/ai.js, which is never imported in that case --
// so none of the assistant's services, tools or the Exa client are loaded at
// boot and nothing of it exists in this process.
//
// A stub rather than nothing at all: an unmounted path would fall through to
// the SPA handler and hand a browser some HTML where it expected JSON, and a
// client that got a 404 could not tell "this build has no assistant" from
// "you typed the URL wrong". 503 with a stable code says which.
export const aiDisabledRoutes = new Hono();

aiDisabledRoutes.all("/*", (c) =>
  c.json(
    {
      error: {
        code: "ai_disabled",
        message: "The assistant is switched off on this deployment.",
      },
    },
    503
  )
);
