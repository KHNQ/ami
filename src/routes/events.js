import { Hono } from "hono";
import { subscribe, Topics } from "../lib/realtime.js";
import { settingsService } from "../services/settingsService.js";

// Server-Sent Events: the push channel for things a client must learn about
// without asking.
//
// Today that is one thing -- an admin changed a public setting, and every open
// storefront should pick it up without the visitor refreshing. Previously
// `GET /site-config` was fetched once at boot and cached for 30s, so flipping
// "online purchasing off" left buy buttons on screen for anyone already
// browsing until they happened to reload.
//
// SSE rather than a WebSocket because the traffic is strictly one-directional
// and low-volume: it is a plain HTTP response that reconnects itself, needs no
// upgrade handshake, and passes through proxies that would need extra
// configuration to carry a socket.
export const eventRoutes = new Hono();

// Long-lived connections need a periodic write or intermediaries close them as
// idle. 25s is comfortably under the usual 30-60s proxy timeout.
const HEARTBEAT_MS = 25_000;

eventRoutes.get("/site-config", (c) => {
  const encoder = new TextEncoder();

  // Assigned by start(), called by cancel(). Both paths must reach the same
  // teardown -- see the note on cancel() below.
  let teardown = () => {};

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event, data) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // The client vanished between our liveness check and this write.
          closed = true;
        }
      };

      // Send the current config immediately. A client that connects during a
      // change would otherwise sit on stale values until the *next* change --
      // which for a setting that only ever flips once is forever.
      send("config", settingsService.publicConfig());

      const unsubscribe = subscribe(Topics.siteConfig(), (payload) => send("config", payload));

      const heartbeat = setInterval(() => {
        // A comment frame: valid SSE, ignored by EventSource, enough to keep
        // the connection from being reaped.
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(`: ping\n\n`));
          } catch {
            closed = true;
          }
        }
      }, HEARTBEAT_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        // Unsubscribing is not optional: a subscriber that outlives its
        // connection leaks and throws on every subsequent publish.
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      teardown = cleanup;
      c.req.raw.signal?.addEventListener("abort", cleanup);
    },

    // The abort signal above is not a guarantee. When the runtime notices the
    // client is gone by cancelling the stream instead of firing `abort`, every
    // one of these connections leaks: the 25s heartbeat keeps firing forever
    // and the settings subscriber outlives the request. Each page load adds
    // one, so a browsing session quietly accumulates them.
    //
    // Both teardown paths are idempotent (`cleanup` returns early once
    // `closed` is set), so wiring both is safe and covers either behaviour.
    cancel() {
      teardown();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx buffers proxied responses by default, which holds an SSE stream
      // until it completes -- defeating the entire point.
      "X-Accel-Buffering": "no",
    },
  });
});
