import { defineTool } from "../registry.js";
import { productService } from "../../productService.js";
import { purchaseService } from "../../purchaseService.js";
import { redeemCodeService } from "../../redeemCodeService.js";
import { walletService } from "../../walletService.js";
import { money } from "./shape.js";

// Actions that move money or cannot be undone.
//
// These never run during a turn. `consequential: true` makes the loop call
// `preview()` instead of `handler()`, store the proposal, and show the visitor
// a card; the handler runs only after they tap Confirm, on a separate request
// with its own freshly-checked auth.
//
// `preview` is doing real work, not decoration. A card that says "Confirm
// purchase?" with no numbers is not consent -- it has to state the device, the
// price, the balance before and after, and that it is permanent. If the
// preview cannot produce those, the proposal is refused rather than shown.

defineTool("purchase_device", {
  auth: "user",
  consequential: true,
  parallelSafe: false,
  description:
    "Buy a device with the visitor's wallet balance. This debits their wallet, decrements stock " +
    "and creates a permanent network position. The visitor is shown a confirmation card and must " +
    "approve it -- you do not complete the purchase yourself, so describe what will happen rather " +
    "than saying it is done.",
  parameters: {
    type: "object",
    properties: {
      product_id: { type: "string", maxLength: 80 },
      redeem_code: { type: "string", maxLength: 40 },
    },
    required: ["product_id"],
    additionalProperties: false,
  },

  summarise: (r) => `Purchase ready to confirm — ${r.product}`,

  /**
   * Read-only. Everything the visitor is being asked to agree to.
   */
  preview({ product_id, redeem_code }, ctx) {
    const product = productService.getPublic(product_id);
    if (!product) return { ok: false, error: `No product with id "${product_id}".` };
    if (product.status !== "active") return { ok: false, error: `${product.name} is no longer on sale.` };
    if (product.stock_count <= 0) return { ok: false, error: `${product.name} is out of stock.` };

    const price = product.list_price_y_cents ?? 0;
    const balance = walletService.getWallet(ctx.userId).balance_cents;

    if (balance < price) {
      // Refused at preview rather than shown and failed at confirm: being told
      // "you cannot afford this" before tapping is better than after.
      return {
        ok: false,
        error: `Wallet balance ${money(balance).display} does not cover ${money(price).display}.`,
      };
    }

    return {
      ok: true,
      title: `Buy ${product.name}?`,
      summary: `${money(price).display} will be debited from your wallet now.`,
      danger: true,
      details: [
        { label: "Device", value: product.name },
        { label: "Price", value: money(price).display },
        { label: "Wallet now", value: money(balance).display },
        { label: "Wallet after", value: money(balance - price).display },
        ...(redeem_code ? [{ label: "Using code", value: redeem_code }] : []),
        { label: "Note", value: "This is permanent. Only our team can reverse it." },
      ],
      // Given back to the model so it can describe the decision accurately
      // without claiming the purchase happened.
      product: product.name,
      price: money(price),
    };
  },

  handler({ product_id, redeem_code }, ctx) {
    // The same call POST /purchases makes: stock, wallet, space, node,
    // commission and the reserve cut all happen inside its one transaction.
    const tx = purchaseService.buy({
      userId: ctx.userId,
      productId: product_id,
      redeemCode: redeem_code || undefined,
    });
    return {
      purchased: true,
      order_id: tx.id,
      paid: money(tx.y_at_sale_cents),
      balance_after: money(walletService.getWallet(ctx.userId).balance_cents),
    };
  },
});

defineTool("revoke_redeem_code", {
  auth: "user",
  consequential: true,
  parallelSafe: false,
  description:
    "Permanently revoke one of the visitor's own redeem codes. There is no way to un-revoke it. " +
    "The visitor confirms this on a card before it happens.",
  parameters: {
    type: "object",
    properties: { code: { type: "string", maxLength: 40 } },
    required: ["code"],
    additionalProperties: false,
  },

  summarise: (r) => `Code ${r.code} revoked`,

  preview({ code }, ctx) {
    const mine = redeemCodeService.listMine(ctx.userId);
    const found = mine.find((c) => c.code === code);
    // Ownership is settled here, at preview, so a proposal can never be
    // created for a code the visitor does not own.
    if (!found) return { ok: false, error: `You have no code "${code}".` };
    if (found.status !== "active") return { ok: false, error: `That code is already ${found.status}.` };

    return {
      ok: true,
      title: `Revoke ${code}?`,
      summary: "Nobody will be able to redeem it again.",
      danger: true,
      details: [
        { label: "Code", value: code },
        { label: "Used", value: `${found.uses} of ${found.max_uses ?? "unlimited"}` },
        { label: "Note", value: "This cannot be undone." },
      ],
      id: found.id,
      code,
    };
  },

  handler({ code }, ctx) {
    const mine = redeemCodeService.listMine(ctx.userId);
    const found = mine.find((c) => c.code === code);
    if (!found) return { error: `You have no code "${code}".`, code: "not_found" };
    // Re-checked ownership, then the same service the button calls.
    redeemCodeService.revoke(found.id, ctx.userId, false);
    return { revoked: true, code };
  },
});

/** Every consequential tool, for the admin console and the tests. */
export function consequentialToolNames() {
  return ["purchase_device", "revoke_redeem_code"];
}
