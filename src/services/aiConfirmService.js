import { db } from "../db/index.js";
import { Errors } from "../lib/errors.js";
import { getTool, validateArgs, isAllowed } from "./agent/registry.js";

// Proposing and confirming a consequential action.
//
// The whole safety property lives in `db.aiToolCalls.claim`, which is a single
// guarded UPDATE: `... WHERE id = ? AND user_id = ? AND status = 'proposed'
// AND expires_at > ?`. Two taps on the same card race into that statement and
// SQLite serialises them, so exactly one sees `changes === 1`. Reading the row
// first and updating second would leave a window between the two -- which, for
// something that debits a wallet, is a window worth not having.

/** How long a card stays live. Long enough to read, short enough to be a decision. */
const PROPOSAL_TTL_MS = 10 * 60 * 1000;

export const aiConfirmService = {
  PROPOSAL_TTL_MS,

  /**
   * Records a proposal and returns what the card should show.
   *
   * Called from inside a turn, by the registry, when a consequential tool is
   * requested. The preview has already established that the action is possible.
   */
  propose({ sessionId, userId, tool, args, preview }) {
    const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS).toISOString();
    const row = db.aiToolCalls.record({
      sessionId,
      userId,
      toolName: tool.name,
      args,
      status: "proposed",
      consequential: true,
      expiresAt,
    });

    return {
      id: row.id,
      tool: tool.name,
      title: preview.title,
      summary: preview.summary,
      details: preview.details || [],
      danger: Boolean(preview.danger),
      expires_at: expiresAt,
    };
  },

  /**
   * Executes a proposal the visitor approved.
   *
   * `ctx` is built from the CONFIRMING request, never restored from the
   * proposal: the token could have been revoked, the account suspended or the
   * permissions changed in the ten minutes since the card appeared.
   */
  async confirm({ proposalId, ctx }) {
    const claimed = db.aiToolCalls.claim(proposalId, ctx.userId);
    if (!claimed) {
      // Deliberately one message for every losing case -- already used,
      // expired, someone else's, never existed. Distinguishing them would
      // tell a prober which proposal ids are real.
      const existing = db.aiToolCalls.get(proposalId);
      const status = existing?.status;
      throw Errors.badRequest(
        status === "executed" || status === "confirmed"
          ? "That action has already been carried out."
          : status === "expired" || (existing?.expires_at && existing.expires_at <= new Date().toISOString())
            ? "That confirmation expired. Ask again and I will set it up afresh."
            : "That confirmation is no longer valid.",
        "proposal_unavailable"
      );
    }

    const tool = getTool(claimed.tool_name);
    if (!tool || !isAllowed(tool, ctx)) {
      db.aiToolCalls.settle(claimed.id, { status: "failed", errorCode: "forbidden" });
      throw Errors.forbidden("You cannot carry out that action.", "forbidden");
    }

    // Re-validated rather than trusted: the row has been sitting in a database
    // and the schema may have changed under it.
    const validated = validateArgs(tool.parameters, claimed.args);
    if (!validated.ok) {
      db.aiToolCalls.settle(claimed.id, { status: "failed", errorCode: "bad_arguments" });
      throw Errors.badRequest(validated.error, "bad_arguments");
    }

    const started = Date.now();
    try {
      const result = await tool.handler(validated.value, { ...ctx, executingProposal: true });
      db.aiToolCalls.settle(claimed.id, {
        status: "executed",
        result,
        durationMs: Date.now() - started,
      });

      // Recorded exactly as a clicked action would be, so a wallet debit made
      // through the assistant is indistinguishable in the audit log from one
      // made through the buy button -- which is the point of "the result of
      // both must be the same thing".
      db.logs.record({
        actorUserId: ctx.userId,
        action: "ai.tool_executed",
        entityType: "ai_tool_call",
        entityId: claimed.id,
        meta: { tool: claimed.tool_name, args: validated.value },
        ip: ctx.ip,
      });

      return { ok: true, tool: claimed.tool_name, result };
    } catch (err) {
      const isAppError = err && typeof err === "object" && "code" in err;
      db.aiToolCalls.settle(claimed.id, {
        status: "failed",
        errorCode: isAppError ? err.code : "tool_failed",
        durationMs: Date.now() - started,
      });
      if (!isAppError) console.error(`[agent] confirmed tool ${claimed.tool_name} failed:`, err);
      throw isAppError ? err : Errors.internal("That action could not be completed", "tool_failed");
    }
  },

  /** The visitor declined. */
  reject({ proposalId, userId }) {
    const rejected = db.aiToolCalls.reject(proposalId, userId);
    if (!rejected) throw Errors.badRequest("That confirmation is no longer valid.", "proposal_unavailable");
    return { ok: true, rejected: true };
  },

  /** Sweeps proposals nobody answered, so the admin log stops implying they are live. */
  expireStale() {
    return db.aiToolCalls.expireStale();
  },
};
