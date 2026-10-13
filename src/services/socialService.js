import { config } from "../config.js";
import { kv } from "../lib/kv.js";
import { settingsService } from "./settingsService.js";

// The Instagram feed shown on /socials.
//
// --- What this can and cannot do -------------------------------------------
// Instagram has no public, key-free API. Reading even your *own* posts
// requires either the Instagram Basic Display API or the Graph API, and both
// need a token obtained through an OAuth app review. There is no legitimate
// way to "just fetch our page" server-side, and scraping the public HTML
// breaks their terms and their markup changes without notice.
//
// So this is built as a proper integration with an honest fallback:
//   * With INSTAGRAM_ACCESS_TOKEN set, it calls the real Graph API.
//   * Without one, it returns `{ configured: false, posts: [] }` and the page
//     renders the profile link and the blog instead.
//
// It never fabricates posts. A social feed that invents plausible-looking
// content is worse than an empty one, because nobody can tell it is empty.

const GRAPH_URL = "https://graph.instagram.com/me/media";
const FIELDS = "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp";
const CACHE_KEY = "social:instagram:feed";
const CACHE_TTL_MS = 15 * 60 * 1000;

export const socialService = {
  configured() {
    return Boolean(config.instagramAccessToken);
  },

  async instagramFeed({ limit = 12 } = {}) {
    const profile = settingsService.get("social")?.instagram || null;

    if (!this.configured()) {
      return {
        configured: false,
        profile_url: profile,
        posts: [],
        // Surfaced to the admin console so an operator can see *why* the feed
        // is empty rather than assuming it is broken.
        reason:
          "INSTAGRAM_ACCESS_TOKEN is not set. Instagram requires an OAuth access token for its Graph API; there is no key-free way to read a profile.",
      };
    }

    const cached = await kv.get(CACHE_KEY).catch(() => null);
    if (cached) return { ...cached, cached: true };

    try {
      const url = `${GRAPH_URL}?fields=${FIELDS}&limit=${limit}&access_token=${encodeURIComponent(
        config.instagramAccessToken
      )}`;
      const res = await fetch(url);
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        // Never surface the upstream body: it echoes the access token back in
        // some error shapes.
        console.error(`[social] instagram ${res.status}: ${detail.slice(0, 300)}`);
        return { configured: true, profile_url: profile, posts: [], reason: "Instagram rejected the request." };
      }

      const payload = await res.json();
      const posts = (payload.data || []).map((p) => ({
        id: p.id,
        caption: p.caption || "",
        // Videos expose a poster frame in `thumbnail_url`; `media_url` for a
        // video is the video file itself, which must not be used as an <img>.
        image: p.media_type === "VIDEO" ? p.thumbnail_url : p.media_url,
        permalink: p.permalink,
        type: p.media_type,
        timestamp: p.timestamp,
      }));

      const feed = { configured: true, profile_url: profile, posts };
      await kv.set(CACHE_KEY, feed, { ttlMs: CACHE_TTL_MS }).catch(() => {});
      return feed;
    } catch (err) {
      console.error(`[social] instagram fetch failed: ${err}`);
      return { configured: true, profile_url: profile, posts: [], reason: "Could not reach Instagram." };
    }
  },
};
