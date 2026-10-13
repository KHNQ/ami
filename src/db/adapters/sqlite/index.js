import { getRawConnection } from "./connection.js";
import { runMigrations } from "./migrate.js";
import { makeUsersRepo, makeWalletRepo, makePasswordResetRepo } from "./repos/accounts.js";
import { makeProductsRepo, makeWarehouseCostRepo, makeCommissionPlansRepo } from "./repos/catalog.js";
import { makeSpacesRepo, makeNodesRepo, makeRedeemCodesRepo } from "./repos/network.js";
import { makeTransactionsRepo, makeLedgerRepo, makeReserveRepo } from "./repos/finance.js";
import { makeSupportRepo, makeAuditLogRepo } from "./repos/support.js";
import { makeRankTiersRepo, makeRankBonusPeriodsRepo, makeRankBonusLedgerRepo } from "./repos/rank.js";
import { makeQuotaTiersRepo, makeNodeQuotaStateRepo, makeQuotaCompletionsRepo } from "./repos/quota.js";
import { makeSiteSettingsRepo } from "./repos/settings.js";
import { makeNotificationsRepo } from "./repos/messaging.js";
import { makeChequesRepo } from "./repos/cheques.js";
import { makeApplicationsRepo } from "./repos/careers.js";
import { makeAiConversationsRepo } from "./repos/ai.js";
import {
  makeAiSessionsRepo,
  makeAiMessagesRepo,
  makeAiAttachmentsRepo,
  makeAiUsageRepo,
  makeAiToolCallsRepo,
} from "./repos/aiAgent.js";
import { makeBlogRepo, makeEmailVerificationRepo } from "./repos/content.js";
import { makeKnowledgeRepo, makeAnswerGapRepo } from "./repos/knowledge.js";
import {
  makeSalesQuotesRepo,
  makeSalesAgreementsRepo,
  makeSalesInstalmentsRepo,
} from "./repos/sales.js";

// Builds the full repo surface the rest of the app talks to. Every other
// adapter (e.g. a future Mongo/LevelDB one) must expose this exact same
// shape — same top-level keys, same method names/args — so nothing outside
// src/db/ ever needs to know which engine is actually running.
export function createSqliteAdapter(connectionOverride) {
  const raw = connectionOverride || getRawConnection();
  runMigrations(raw);

  const repo = {
    users: makeUsersRepo(raw),
    wallet: makeWalletRepo(raw),
    passwordResets: makePasswordResetRepo(raw),
    products: makeProductsRepo(raw),
    warehouseCost: makeWarehouseCostRepo(raw),
    commissionPlans: makeCommissionPlansRepo(raw),
    spaces: makeSpacesRepo(raw),
    nodes: makeNodesRepo(raw),
    redeemCodes: makeRedeemCodesRepo(raw),
    transactions: makeTransactionsRepo(raw),
    ledger: makeLedgerRepo(raw),
    reserve: makeReserveRepo(raw),
    support: makeSupportRepo(raw),
    logs: makeAuditLogRepo(raw),
    rankTiers: makeRankTiersRepo(raw),
    rankBonusPeriods: makeRankBonusPeriodsRepo(raw),
    rankBonusLedger: makeRankBonusLedgerRepo(raw),
    quotaTiers: makeQuotaTiersRepo(raw),
    nodeQuotaState: makeNodeQuotaStateRepo(raw),
    quotaCompletions: makeQuotaCompletionsRepo(raw),
    siteSettings: makeSiteSettingsRepo(raw),
    notifications: makeNotificationsRepo(raw),
    cheques: makeChequesRepo(raw),
    salesQuotes: makeSalesQuotesRepo(raw),
    salesAgreements: makeSalesAgreementsRepo(raw),
    salesInstalments: makeSalesInstalmentsRepo(raw),
    applications: makeApplicationsRepo(raw),
    aiConversations: makeAiConversationsRepo(raw),
    aiSessions: makeAiSessionsRepo(raw),
    aiMessages: makeAiMessagesRepo(raw),
    aiAttachments: makeAiAttachmentsRepo(raw),
    aiUsage: makeAiUsageRepo(raw),
    aiToolCalls: makeAiToolCallsRepo(raw),
    blog: makeBlogRepo(raw),
    emailVerifications: makeEmailVerificationRepo(raw),
    knowledge: makeKnowledgeRepo(raw),
    answerGaps: makeAnswerGapRepo(raw),

    // Atomic multi-step writes. bun:sqlite's Database#transaction wraps a
    // synchronous function in BEGIN/COMMIT/ROLLBACK; any thrown error rolls
    // back automatically. Every write in `fn` must go through this same
    // `raw` connection (i.e. through the repos above), which it does since
    // they're all closed over it.
    transaction(fn) {
      const wrapped = raw.transaction(fn);
      return wrapped();
    },

    _raw: raw,
  };

  return repo;
}
