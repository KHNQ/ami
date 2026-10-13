// Pre-flight for the assistant: is it actually configured, and will the
// pieces it depends on answer?
//
// Every one of these is a silent failure in production. A missing DEEPSEEK
// key leaves the chat button opening a panel that errors on the first
// message; a missing Exa key removes web search with no error anywhere; a
// quota timezone left at UTC resets the daily allowance in the middle of the
// Tehran working day. None of them are visible from a health check.
//
// Usage: bun run scripts/check-assistant.js
// Exit code 0 = ready, 1 = something a deploy should have set is not set.
import { config } from "../src/config.js";
import { settingsService } from "../src/services/settingsService.js";

const problems = [];
const notes = [];
const ok = (label, value) => console.log(`  ${value ? "✓" : "·"} ${label}`);

console.log("\nAssistant");
ok("AI_ENABLED", config.aiEnabled);
if (!config.aiEnabled) {
  // Not a failure. The assistant is OFF by default and this is what that
  // looks like -- exiting non-zero here would fail every deployment that has
  // deliberately switched it off.
  console.log("\n  The assistant is switched off for this deployment.");
  console.log("  /ai/* answers 503, nothing of it is loaded, and the storefront shows no chat.");
  console.log("  To turn it on: set AI_ENABLED=true and restart.\n");
  process.exit(0);
}

ok("feature flag ai_chat_enabled", settingsService.isEnabled("ai_chat_enabled"));
if (!settingsService.isEnabled("ai_chat_enabled")) {
  notes.push("ai_chat_enabled is off: every /ai route returns 403. Turn it on in Settings.");
}

ok(`model ${config.deepseekModel}`, Boolean(config.deepseekApiKey));
if (!config.deepseekApiKey) problems.push("DEEPSEEK_API_KEY is not set: the assistant cannot answer at all.");

// Imported only past the switch: loading the agent to tell someone it is
// switched off would be the overhead this script is meant to report on.
const { allTools, schemasFor } = await import("../src/services/agent/registry.js");
const { exaService } = await import("../src/services/exaService.js");
await import("../src/services/agentService.js"); // registers every tool module

console.log("\nTools");
const anonymous = schemasFor({ userId: null, permissions: [] }).length;
const customer = schemasFor({ userId: "u", permissions: [] }).length;
console.log(`  ${allTools().length} registered · ${customer} for a signed-in customer · ${anonymous} public`);
if (!customer) problems.push("No tools are registered: the agent would answer from retrieval alone.");

// Every consequential tool must be able to explain itself before it runs.
// A confirmation card with no numbers on it is not consent, and the preview
// is where those numbers come from.
for (const tool of allTools()) {
  if (tool.consequential && typeof tool.preview !== "function") {
    problems.push(`${tool.name} is consequential but has no preview(): it could not raise a confirmation card.`);
  }
}

console.log("\nWeb search");
if (config.exaApiKeys.length) {
  ok(`${config.exaApiKeys.length} Exa key(s) configured`, true);
  try {
    const res = await exaService.search({ query: "medical laser manufacturer", numResults: 1 });
    ok(`live search returned ${res.results.length} result(s)`, res.results.length > 0);
  } catch (err) {
    problems.push(`Exa is configured but failing: ${err.code || ""} ${err.message}`);
  }
} else {
  ok("Exa keys", false);
  notes.push("EXA_API_KEYS is not set: web_search and read_web_page are not registered. The agent works, without the web.");
}

console.log("\nLimits");
console.log(`  ${config.aiDailyPromptLimit} prompts/day · resets on the ${config.aiQuotaTimezone} calendar`);
console.log(`  ${config.aiAnonHourlyLimit}/hour for anonymous visitors · ${config.aiWebSearchDailyMax} searches/day`);
console.log(`  attachments up to ${(config.aiMaxAttachmentBytes / 1e6).toFixed(1)}MB, ${config.aiMaxAttachmentsPerMessage} per message`);
if (config.aiQuotaTimezone === "UTC") {
  notes.push("AI_QUOTA_TIMEZONE is UTC. For Iranian clinics set Asia/Tehran, or allowances reset mid-afternoon.");
}

if (notes.length) {
  console.log("\nWorth knowing");
  for (const n of notes) console.log(`  - ${n}`);
}

if (problems.length) {
  console.error("\nNot ready:");
  for (const p of problems) console.error(`  ! ${p}`);
  process.exit(1);
}

console.log("\nThe assistant is ready.\n");
