// In-process pub/sub hub for everything the server needs to push at a client
// without being asked: today, admin settings changes that must land on open
// storefronts without a refresh.
//
// The transport on top of this hub is SSE (src/routes/events.js) --
// server -> client only.
//
// Deliberately in-process, and deliberately honest about what that means:
// with more than one server instance a client connected to instance A would
// not see an event published on instance B. That is the same single-writer
// constraint SQLite already imposes on this deployment, so it buys nothing to
// solve here -- but when Redis becomes real (see lib/kv.js), `publish()` is
// the single function that grows a Redis PUBLISH alongside the local fan-out.
// Nothing else in the codebase would change.

/** topic -> Set<subscriber fn> */
const topics = new Map();

/**
 * Subscribes to a topic. Returns an unsubscribe function.
 *
 * Every caller MUST call it (on socket close, on SSE abort). A subscriber that
 * outlives its connection is a leak that also throws on every subsequent
 * publish, and one dead subscriber on a hot topic is enough to fill the log.
 */
export function subscribe(topic, fn) {
  if (!topics.has(topic)) topics.set(topic, new Set());
  topics.get(topic).add(fn);
  return () => {
    const set = topics.get(topic);
    if (!set) return;
    set.delete(fn);
    // Drop the topic entirely once empty, so a long-running process does not
    // accumulate one empty Set per topic that ever existed.
    if (set.size === 0) topics.delete(topic);
  };
}

/**
 * Publishes to every subscriber of a topic.
 *
 * A throwing subscriber is caught and logged rather than allowed to abort the
 * loop: one client whose socket died mid-send must not stop the message
 * reaching everyone else in the room.
 */
export function publish(topic, payload) {
  const set = topics.get(topic);
  if (!set || set.size === 0) return 0;
  let delivered = 0;
  for (const fn of set) {
    try {
      fn(payload);
      delivered++;
    } catch (err) {
      console.warn(`[realtime] subscriber for "${topic}" threw: ${err}`);
    }
  }
  return delivered;
}

/** How many subscribers a topic has. Used by tests and the admin console. */
export function subscriberCount(topic) {
  return topics.get(topic)?.size ?? 0;
}

/** Every topic with at least one subscriber. */
export function activeTopics() {
  return [...topics.keys()];
}

/** Test helper -- drops all state. Never called by application code. */
export function _reset() {
  topics.clear();
}

// --- topic naming --------------------------------------------------------
// Centralised so a typo in a topic string can't silently produce a channel
// nobody is listening to (the failure mode of stringly-typed pub/sub).
export const Topics = {
  /** Public site configuration changed; every open storefront should re-read. */
  siteConfig: () => "site-config",
};
