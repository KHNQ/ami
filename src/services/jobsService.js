import { activityService } from "./activityService.js";
import { notificationService } from "./notificationService.js";
import { chequeService } from "./chequeService.js";
import { releaseMaturedCommissions } from "./commissionService.js";
import { rankService } from "./rankService.js";
import { salesService } from "./salesService.js";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { settingsService } from "./settingsService.js";

// Scheduled-job entry points (Section 10 items 7-8). Exposed via
// POST /admin/jobs/* so they can be triggered on demand -- by a real cron
// runner in prod, or directly by tests that want to simulate a period
// boundary without waiting on real wall-clock time.
export const jobsService = {
  recalculateActivityPeriods({ asOf } = {}) {
    return activityService.recalculatePeriods(asOf);
  },

  releaseCommissions({ holdDays, asOf } = {}) {
    return releaseMaturedCommissions({
      holdDays: holdDays ?? config.defaults.commissionHoldDays,
      asOf: asOf ? new Date(asOf) : new Date(),
    });
  },

  // Drains the outbound notification queue. Async, unlike its neighbours,
  // because it actually talks to email/SMS providers -- which is precisely
  // why enqueueing and sending are separate steps (the enqueue side has to
  // stay synchronous to run inside db.transaction()).
  sendDueNotifications(opts = {}) {
    return notificationService.sendDue(opts);
  },

  // Queues reminders for cheques approaching their due date. Separate from
  // sendDueNotifications on purpose: this one decides *what* to say, that one
  // delivers it. Running this twice is a no-op (dedupe keys), so it is safe
  // to schedule aggressively.
  queueChequeReminders(opts = {}) {
    return chequeService.queueDueReminders({
      asOf: opts.asOf ? new Date(opts.asOf) : new Date(),
      leadDays: opts.lead_days,
    });
  },

  // Storefront sales housekeeping. Both are idempotent, so running them
  // twice in a day changes nothing the second time -- which is what makes
  // them safe to schedule aggressively alongside the jobs above.
  //
  // Without the first, the open pipeline slowly fills with proformas priced
  // at an exchange rate that no longer exists, and the sales desk cannot
  // tell which of them are still honourable.
  expireStaleQuotes() {
    return salesService.expireStaleQuotes();
  },

  flagLateInstalments() {
    return salesService.flagLateInstalments();
  },

  // Assistant confirmation cards nobody answered. Expiry is already enforced
  // at confirm time by the guarded UPDATE, so this changes no outcome -- it
  // exists so the admin view of ai_tool_calls stops implying that a card from
  // last Tuesday is still live.
  //
  // Goes to the repo rather than through aiConfirmService, which is the one
  // line that service adds on top of it: with the assistant switched off
  // there are no proposals to sweep, and importing the agent's registry into
  // every deployment just to return zero is the overhead this whole switch
  // exists to avoid.
  expireStaleProposals() {
    if (!config.aiEnabled) return 0;
    return db.aiToolCalls.expireStale();
  },

  runAll(opts = {}) {
    const activity = this.recalculateActivityPeriods(opts);
    // Commission is NOT released automatically unless an operator has said it
    // should be. The default is that the company pays its network by hand and
    // records it on the payout sheet -- crediting a wallet as well would be
    // the same commission paid twice, and this is the scheduled job that
    // would do it quietly, every night, to everyone.
    const releases = settingsService.isEnabled("network_auto_payout")
      ? this.releaseCommissions(opts)
      : { releasedCount: 0, releasedCents: 0, skipped: "network_auto_payout is off" };
    const expiredQuotes = this.expireStaleQuotes();
    const lateInstalments = this.flagLateInstalments();
    const expiredProposals = this.expireStaleProposals();
    db.logs.record({
      action: "jobs.run_all",
      meta: { activity, releases, expiredQuotes, lateInstalments, expiredProposals },
    });
    return { activity, releases, expiredQuotes, lateInstalments, expiredProposals };
  },

  // Rank/leadership bonus pool jobs (idea.md Section 7 item 4) -- run
  // per-product, on a monthly-ish cadence, not part of runAll since that's
  // meant for the frequent per-tick jobs above.
  fundRankPool({ productId, periodStart, periodEnd }) {
    return rankService.fundPeriodPool({ productId, periodStart, periodEnd });
  },

  distributeRankBonuses({ periodId }) {
    return rankService.distributeRankBonuses({ periodId });
  },

  releaseRankBonuses({ holdDays, asOf } = {}) {
    return rankService.releaseMaturedRankBonuses({
      holdDays: holdDays ?? config.defaults.commissionHoldDays,
      asOf: asOf ? new Date(asOf) : new Date(),
    });
  },
};
