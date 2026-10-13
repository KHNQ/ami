import { defineTool } from "../registry.js";
import { db } from "../../../db/index.js";
import { authService } from "../../authService.js";
import { supportService } from "../../supportService.js";
import { redeemCodeService } from "../../redeemCodeService.js";

// Account and support actions the visitor could equally do by clicking.
//
// The guiding requirement was that anything clickable is also callable, and
// that both produce the same result. These call the same services the routes
// call, so they do -- including the audit trail, the emails and the feature
// flags, none of which are re-implemented here.

defineTool("submit_support_request", {
  auth: "user",
  parallelSafe: false,
  description:
    "Send a support request to our team on the visitor's behalf. Use when they report a fault, " +
    "need service, or ask for something that needs a person. Write the message yourself from " +
    "what they told you -- do not make them repeat it. The team follows up using the contact " +
    "details, so use the ones on the visitor's account.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", maxLength: 4000 },
    },
    required: ["message"],
    additionalProperties: false,
  },

  summarise: () => "Support request sent",

  handler({ message }, ctx) {
    const user = db.users.findById(ctx.userId);
    // Goes through the service, so `support_tickets_enabled` is honoured and
    // the agent cannot file requests while the operator has that switched off.
    const request = supportService.create({
      userId: ctx.userId,
      name: user?.name || "Customer",
      contact: user?.phone || user?.email || "see account",
      message: `${message}\n\n— sent through the assistant`,
    });
    return {
      sent: true,
      request_id: request.id,
      next: "Our team will contact the visitor using the details on their account.",
    };
  },
});

defineTool("update_my_name", {
  auth: "user",
  parallelSafe: false,
  description:
    "Change the name on the visitor's own account. Only their display name and phone -- email and " +
    "password are changed on the profile screen, not here.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", maxLength: 120 },
      phone: { type: "string", maxLength: 40 },
    },
    additionalProperties: false,
  },

  summarise: (r) => `Profile updated — ${r.name}`,

  handler({ name, phone }, ctx) {
    const clean = typeof name === "string" ? name.trim() : undefined;
    if (clean === "") {
      return { error: "A name cannot be empty.", code: "name_required" };
    }
    if (!clean && phone === undefined) {
      return { error: "Nothing to change. Provide a name or a phone number.", code: "nothing_to_change" };
    }

    // The same call POST /profile makes -- so the result is identical to the
    // one the visitor would get by editing the field themselves.
    db.users.updateProfile(ctx.userId, {
      ...(clean ? { name: clean } : null),
      ...(phone !== undefined ? { phone: phone || null } : null),
    });

    const me = authService.me(ctx.userId);
    return { updated: true, name: me.name, phone: me.phone ?? null };
  },
});

defineTool("generate_redeem_code", {
  auth: "user",
  parallelSafe: false,
  description:
    "Mint a new referral/redeem code for one of the products the visitor owns a network position " +
    "in. Someone redeeming it joins their space.",
  parameters: {
    type: "object",
    properties: {
      product_id: { type: "string", maxLength: 80 },
      max_uses: { type: "integer", minimum: 1, maximum: 100 },
    },
    required: ["product_id"],
    additionalProperties: false,
  },

  summarise: (r) => `Code created — ${r.code}`,

  handler({ product_id, max_uses }, ctx) {
    // Throws `no_node_for_product` when the visitor has no position in that
    // product, which is the same refusal the button gives.
    const created = redeemCodeService.generate({
      userId: ctx.userId,
      productId: product_id,
      maxUses: max_uses,
    });
    return { created: true, code: created.code, max_uses: created.max_uses, product_id };
  },
});
