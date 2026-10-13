import { defineTool } from "../registry.js";
import { db } from "../../../db/index.js";
import { authService } from "../../authService.js";
import { salesService } from "../../salesService.js";
import { money } from "./shape.js";

// Reads about the visitor's own account.
//
// Every handler takes its identity from `ctx.userId` and nothing else. There
// is deliberately no `user_id` parameter on any of these: the model must not
// be able to name whose account it is reading, because then a prompt could.

defineTool("get_my_profile", {
  auth: "user",
  description:
    "The signed-in visitor's own account details: name, email, phone, role and whether their " +
    "email is verified. Use this instead of asking them for details we already hold.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  summarise: (r) => `Read the profile for ${r.name || r.email}`,
  handler(_args, ctx) {
    const me = authService.me(ctx.userId);
    return {
      name: me.name,
      email: me.email,
      phone: me.phone ?? null,
      email_verified: me.email_verified,
      member_since: me.created_at,
    };
  },
});

defineTool("get_my_orders", {
  auth: "user",
  description:
    "The visitor's own purchases: what they bought, when, for how much, and the current status. " +
    "Use for 'where is my order', 'what have I bought', 'when did I buy X'.",
  parameters: {
    type: "object",
    properties: { limit: { type: "integer", minimum: 1, maximum: 25 } },
    additionalProperties: false,
  },
  summarise: (r) => `Found ${r.count} order${r.count === 1 ? "" : "s"}`,
  handler({ limit = 10 }, ctx) {
    // Scoped by buyer at the query, not filtered afterwards -- the difference
    // matters if this ever grows a pagination bug.
    const rows = db.transactions.list({ buyerUserId: ctx.userId, limit, offset: 0 });
    return {
      count: rows.length,
      orders: rows.map((t) => ({
        id: t.id,
        product_id: t.product_id,
        product_name: db.products.get(t.product_id)?.name ?? null,
        status: t.status,
        paid: money(t.y_at_sale_cents),
        purchased_at: t.created_at,
      })),
    };
  },
});

defineTool("get_my_quotes", {
  auth: "user",
  description:
    "Proformas, enquiries and lease proforma requests the visitor has raised, with their " +
    "reference and status. Use for 'where is my " +
    "proforma', 'what did I ask for', 'has anyone come back to me'.",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["new", "contacted", "quoted", "accepted", "declined", "expired", "converted"],
      },
      limit: { type: "integer", minimum: 1, maximum: 25 },
    },
    additionalProperties: false,
  },
  summarise: (r) => `Found ${r.count} quote${r.count === 1 ? "" : "s"}`,
  handler({ status, limit = 15 }, ctx) {
    const rows = salesService
      .listQuotes({ userId: ctx.userId, limit })
      .filter((q) => !status || q.status === status);
    return {
      count: rows.length,
      quotes: rows.map((q) => ({
        reference: q.reference,
        kind: q.kind,
        subject: q.subject,
        status: q.status,
        amount: q.amount_cents == null ? null : money(q.amount_cents, q.currency),
        rate_locked_until: q.locked_until,
        raised_at: q.created_at,
      })),
    };
  },
});

defineTool("get_my_agreements", {
  auth: "user",
  description:
    "Lease agreements the visitor holds, with the instalment " +
    "amount, the term and when the next payment is due.",
  parameters: {
    type: "object",
    properties: { limit: { type: "integer", minimum: 1, maximum: 25 } },
    additionalProperties: false,
  },
  summarise: (r) => `Found ${r.count} agreement${r.count === 1 ? "" : "s"}`,
  handler({ limit = 15 }, ctx) {
    const rows = salesService.listAgreements({ userId: ctx.userId, limit });
    return {
      count: rows.length,
      agreements: rows.map((a) => ({
        reference: a.reference,
        kind: a.kind,
        subject: a.subject,
        status: a.status,
        instalment: a.instalment_cents == null ? null : money(a.instalment_cents, a.currency),
        term_months: a.term_months,
        next_due_on: a.next_due_on,
        transfers_ownership: Boolean(a.transfers_ownership),
      })),
    };
  },
});
