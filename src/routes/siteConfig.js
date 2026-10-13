import { Hono } from "hono";
import { settingsService } from "../services/settingsService.js";
import { config } from "../config.js";

// Public runtime configuration for the storefront: which features are on, and
// the contact details to show when they're off. Anonymous by design -- the
// frontend needs this before it knows who the visitor is, and the SSR server
// fetches it to get the very first paint right (a buy button that appears and
// then vanishes is worse than no buy button).
//
// Only settings explicitly marked `public` in settingsService are included.
export const siteConfigRoutes = new Hono();

/**
 * "deepseek-chat" -> "DeepSeek Chat". The chat UI prints it, so it has to be
 * the real model.
 *
 * Inlined here rather than imported from aiService: this route is served on
 * every first paint, and importing the assistant for one string would load
 * the whole feature into deployments that have it switched off.
 */
function modelLabel() {
  const pretty = (config.deepseekModel || "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => (part.toLowerCase() === "deepseek" ? "DeepSeek" : part[0].toUpperCase() + part.slice(1)))
    .join(" ");
  return pretty || "Assistant";
}

siteConfigRoutes.get("/", (c) => {
  // Short cache: long enough to absorb a burst of page loads, short enough
  // that an operator flipping a switch sees it take effect without wondering
  // whether it worked.
  c.header("Cache-Control", "public, max-age=30");
  return c.json({
    ...settingsService.publicConfig(),
    // Derived from this deployment's DEEPSEEK_MODEL rather than stored as a
    // setting: it is a fact about how the instance is configured, not
    // something an operator should be able to type a different answer into.
    // Omitted entirely when the assistant is off, so a client cannot render a
    // model name for something that will not answer.
    ...(config.aiEnabled ? { ai_model_label: modelLabel() } : null),
  });
});
