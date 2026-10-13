import { config } from "../config.js";
import { db } from "../db/index.js";
import { Errors } from "../lib/errors.js";
import { settingsService } from "../services/settingsService.js";

// The per-user daily allowance for the assistant.
//
// Distinct from `rateLimit`, which is IP-keyed and lives in KV: this one is
// per *account*, per calendar day, and durable. A clinic behind one NAT should
// not share an allowance, and a restart should not hand everybody a fresh
// twenty. Both of those follow from where the count is kept.
//
// Anonymous callers fall through untouched -- they are metered by the IP
// limiter instead, because there is no account to attach a day to.

/**
 * "Today", in the configured calendar.
 *
 * `en-CA` because it formats as YYYY-MM-DD, which sorts lexically and matches
 * the column. Building the string from Intl rather than slicing an ISO string
 * is what makes AI_QUOTA_TIMEZONE mean anything: a deployment serving Tehran
 * wants the day to roll at local midnight, not at 03:30 in the afternoon.
 */
export function quotaDay(timezone = config.aiQuotaTimezone, at = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  } catch {
    // An invalid IANA name would otherwise throw on every request. Falling
    // back to UTC keeps the meter running rather than taking the assistant
    // down over a typo in an env var.
    return at.toISOString().slice(0, 10);
  }
}

/** The effective limit: the operator's override if set, else the deployment default. */
export function dailyLimit() {
  const configured = Number(settingsService.get("ai_daily_prompt_limit"));
  return Number.isFinite(configured) && configured > 0 ? configured : config.aiDailyPromptLimit;
}

export function aiQuota() {
  return async (c, next) => {
    const userId = c.get("userId");
    if (!userId) return next();

    const limit = dailyLimit();
    const day = quotaDay();

    // Increment first, then compare. One statement means two concurrent
    // requests cannot both read 19 and both proceed. The cost of this
    // ordering is that a request which fails downstream still burns a slot;
    // that is accepted deliberately, because a reserve-and-refund scheme is
    // a great deal of machinery -- and a new class of bug -- to protect an
    // allowance the operator can raise with one setting.
    const { prompts } = db.aiUsage.incrementPrompts(userId, day);

    if (prompts > limit) {
      throw Errors.tooManyRequests(
        `You have used all ${limit} assistant messages for today. Your allowance resets at midnight.`,
        "ai_quota_exhausted"
      );
    }

    c.set("aiQuota", { used: prompts, limit, remaining: Math.max(0, limit - prompts), day });
    await next();
  };
}
