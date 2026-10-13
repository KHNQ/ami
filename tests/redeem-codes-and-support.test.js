import { describe, test, expect } from "bun:test";
import { db } from "../src/db/index.js";
import { redeemCodeService } from "../src/services/redeemCodeService.js";
import { supportService } from "../src/services/supportService.js";
import { adminService } from "../src/services/adminService.js";
import { purchaseService } from "../src/services/purchaseService.js";
import { makeUser, fundWallet, makeProduct } from "./helpers.js";

function ownerNodeFor(product, userId) {
  fundWallet(userId, 1_000_000);
  const { node, ownRedeemCode } = purchaseService.buy({ userId, productId: product.id });
  return { node, code: ownRedeemCode.code };
}

describe("Redeem codes -- generate, validate, revoke", () => {
  test("generating an extra code requires already owning a node for that product", () => {
    const product = makeProduct();
    const user = makeUser("rc_no_node");
    expect(() => redeemCodeService.generate({ userId: user.id, productId: product.id })).toThrow(/don't have a position/);
  });

  test("a fresh code with maxUses is usable, and becomes unusable exactly at the limit", () => {
    const product = makeProduct();
    const owner = makeUser("rc_owner");
    const { node } = ownerNodeFor(product, owner.id);
    const extra = redeemCodeService.generate({ userId: owner.id, productId: product.id, maxUses: 1 });

    const before = redeemCodeService.validate(extra.code);
    expect(before.usable).toBe(true);
    expect(before.owner_user_id).toBe(owner.id);

    db.redeemCodes.tryIncrementUse(extra.id);
    const after = redeemCodeService.validate(extra.code);
    expect(after.usable).toBe(false);
    expect(after.uses_count).toBe(1);

    expect(() => db.redeemCodes.tryIncrementUse(extra.id)).toThrow(/not usable/);
    void node;
  });

  test("an expired code is not usable even with uses remaining", () => {
    const product = makeProduct();
    const owner = makeUser("rc_expired");
    ownerNodeFor(product, owner.id);
    const extra = redeemCodeService.generate({
      userId: owner.id,
      productId: product.id,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(redeemCodeService.validate(extra.code).usable).toBe(false);
  });

  test("owner can revoke their own code; a non-owner cannot; an admin can revoke anyone's", () => {
    const product = makeProduct();
    const owner = makeUser("rc_rev_owner");
    const stranger = makeUser("rc_rev_stranger");
    ownerNodeFor(product, owner.id);
    const extra = redeemCodeService.generate({ userId: owner.id, productId: product.id });

    expect(() => redeemCodeService.revoke(extra.id, stranger.id, false)).toThrow(/do not have access/);

    const revoked = redeemCodeService.revoke(extra.id, owner.id, false);
    expect(revoked.status).toBe("revoked");
    expect(redeemCodeService.validate(extra.code).usable).toBe(false);

    const second = redeemCodeService.generate({ userId: owner.id, productId: product.id });
    const adminRevoked = redeemCodeService.revoke(second.id, "some-admin-id", true);
    expect(adminRevoked.status).toBe("revoked");
  });

  test("maxUses must be a positive integer when provided", () => {
    const product = makeProduct();
    const owner = makeUser("rc_badmax");
    ownerNodeFor(product, owner.id);
    expect(() => redeemCodeService.generate({ userId: owner.id, productId: product.id, maxUses: 0 })).toThrow();
    expect(() => redeemCodeService.generate({ userId: owner.id, productId: product.id, maxUses: -1 })).toThrow();
  });
});

describe("Support requests -- intake, triage, validation", () => {
  const user = () => db.users.create({ email: `sr-${Math.random()}@t.local`, passwordHash: "x", name: "SR" });

  test("rejects a request with no name, contact or message", () => {
    expect(() => supportService.create({ name: "", contact: "a@b.co", message: "m" })).toThrow(/name/);
    expect(() => supportService.create({ name: "n", contact: "  ", message: "m" })).toThrow(/contact/);
    expect(() => supportService.create({ name: "n", contact: "a@b.co" })).toThrow(/message/);
  });

  test("a request is stored new, with its sender and nothing hidden", () => {
    const u = user();
    const r = supportService.create({ name: "N", contact: "+98912", message: "M", userId: u.id });
    expect(r.status).toBe("new");
    expect(r.user_id).toBe(u.id);
    expect(supportService.get(r.id).message).toBe("M");
  });

  test("update changes status and note, and rejects an invalid status", () => {
    const admin = user();
    const r = supportService.create({ name: "N", contact: "a@b.co", message: "M" });
    expect(() => supportService.update(r.id, { status: "bogus" }, admin.id)).toThrow(/status/);
    const updated = supportService.update(r.id, { status: "closed", admin_note: "done" }, admin.id);
    expect(updated.status).toBe("closed");
    expect(updated.admin_note).toBe("done");
    expect(updated.handled_by).toBe(admin.id);
    expect(() => supportService.get("req_nope")).toThrow(/not found/i);
  });

  test("list filters by status and paginates", () => {
    const a = supportService.create({ name: "A", contact: "a@b.co", message: "M" });
    supportService.update(a.id, { status: "resolved" }, user().id);
    expect(supportService.list({ status: "resolved", limit: 100 }).some((r) => r.id === a.id)).toBe(true);
    expect(supportService.list({ status: "new", limit: 100 }).some((r) => r.id === a.id)).toBe(false);
    expect(supportService.list({ limit: 1 }).length).toBe(1);
  });
});

describe("Admin -- user management", () => {
  test("listing users supports role and status filters", () => {
    const user = makeUser("admin_list_user");
    adminService.setUserRole(user.id, "admin", "actor");
    const admins = db.users.list({ role: "admin", limit: 1000 });
    expect(admins.some((u) => u.id === user.id)).toBe(true);
    expect(admins.every((u) => u.role === "admin")).toBe(true);

    adminService.setUserStatus(user.id, "suspended", "actor");
    const suspended = db.users.list({ status: "suspended", limit: 1000 });
    expect(suspended.some((u) => u.id === user.id)).toBe(true);
  });

  test("setUserStatus and setUserRole reject invalid values", () => {
    const user = makeUser("admin_invalid");
    expect(() => adminService.setUserStatus(user.id, "vaporized", "actor")).toThrow(/invalid status/);
    expect(() => adminService.setUserRole(user.id, "superuser", "actor")).toThrow(/invalid role/);
  });

  test("setUserStatus/setUserRole never leak the password hash", () => {
    const user = makeUser("admin_noleak");
    const afterStatus = adminService.setUserStatus(user.id, "active", "actor");
    const afterRole = adminService.setUserRole(user.id, "user", "actor");
    expect(afterStatus.password_hash).toBeUndefined();
    expect(afterRole.password_hash).toBeUndefined();
  });
});
