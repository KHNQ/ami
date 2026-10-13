import { describe, test, expect } from "bun:test";
import { executeTool, allTools, schemasFor, getTool } from "../src/services/agent/registry.js";
import { signup, signupAdmin, createProduct, fund, buy } from "./httpHelpers.js";
import { salesService } from "../src/services/salesService.js";
import { nodeService } from "../src/services/nodeService.js";
import "../src/services/agentService.js"; // registers every tool module

// The read-only tool suite.
//
// The tests that matter here are the isolation ones. Everything else is
// plumbing; "user A cannot read user B's earnings by naming their node id" is
// the property that decides whether this feature is safe to ship.

const ctxFor = (user, over = {}) => ({
  userId: user.user.id,
  permissions: [],
  isAdmin: false,
  canReadAllOrders: false,
  canReadAllSupport: false,
  emit: () => {},
  ...over,
});

const run = (name, args, ctx) => executeTool({ id: "c1", name, args, valid: true }, ctx);

describe("cross-user isolation", () => {
  test("a node id belonging to someone else is refused, not read", async () => {
    // This is the whole reason tools call services rather than repos. The
    // model is allowed to pass a node id; the service is what decides whose
    // it is. Reading db.nodes.get(id) here would look identical and remove
    // the only check that exists.
    const admin = await signupAdmin("iso-admin");
    const product = await createProduct(admin.token);
    const alice = await signup("iso-alice");
    const bob = await signup("iso-bob");
    fund(alice.user.id, 10_000_000);
    await buy(alice, product);

    const [aliceNode] = nodeService.listByUser(alice.user.id);
    expect(aliceNode).toBeTruthy();

    for (const tool of ["get_network_downline", "get_network_earnings", "get_network_rank"]) {
      const mine = await run(tool, { node_id: aliceNode.id }, ctxFor(alice));
      expect(`${tool} for the owner`).toBe(mine.ok ? `${tool} for the owner` : `${tool} FAILED: ${mine.error}`);

      const theirs = await run(tool, { node_id: aliceNode.id }, ctxFor(bob));
      expect(`${tool} -> ${theirs.ok}`).toBe(`${tool} -> false`);
    }
  });

  test("a space the visitor has no node in is refused", async () => {
    const admin = await signupAdmin("iso-space-admin");
    const product = await createProduct(admin.token);
    const alice = await signup("iso-space-a");
    const bob = await signup("iso-space-b");
    fund(alice.user.id, 10_000_000);
    await buy(alice, product);

    const hers = await run("get_my_spaces", {}, ctxFor(alice));
    const spaceId = hers.result.spaces[0]?.space_id;
    expect(spaceId).toBeTruthy();

    expect((await run("get_space_tree", { space_id: spaceId }, ctxFor(alice))).ok).toBe(true);
    expect((await run("get_space_tree", { space_id: spaceId }, ctxFor(bob))).ok).toBe(false);
  });

  test("the ticket-thread tools no longer exist -- there are no threads to leak", () => {
    for (const name of ["read_ticket", "get_my_tickets", "reply_to_ticket", "open_support_ticket"]) {
      expect(getTool(name)).toBeFalsy();
    }
  });

  test("account reads are scoped by ctx.userId, never by an argument", async () => {
    const alice = await signup("iso-me-a");
    const bob = await signup("iso-me-b");

    const asAlice = await run("get_my_profile", {}, ctxFor(alice));
    expect(asAlice.result.email).toBe(alice.user.email);

    // Even if the model invents a user_id, it is dropped by validation and
    // the answer is still the caller's own profile.
    const spoofed = await run("get_my_profile", { user_id: alice.user.id }, ctxFor(bob));
    expect(spoofed.result.email).toBe(bob.user.email);
  });

  test("quotes and orders are scoped to the caller", async () => {
    const alice = await signup("iso-q-a");
    const bob = await signup("iso-q-b");
    salesService.createQuote({
      kind: "proforma",
      contactName: "Alice Clinic",
      contactEmail: alice.user.email,
      subject: "Alice's secret machine",
      userId: alice.user.id,
    });

    const hers = await run("get_my_quotes", {}, ctxFor(alice));
    expect(hers.result.quotes.some((q) => q.subject === "Alice's secret machine")).toBe(true);

    const his = await run("get_my_quotes", {}, ctxFor(bob));
    expect(JSON.stringify(his.result)).not.toContain("Alice's secret machine");
  });

  test("a downline lists positions and volumes but not members' identities", async () => {
    const admin = await signupAdmin("iso-priv-admin");
    const product = await createProduct(admin.token);
    const alice = await signup("iso-priv-a");
    fund(alice.user.id, 10_000_000);
    await buy(alice, product);
    const [node] = nodeService.listByUser(alice.user.id);

    const res = await run("get_network_downline", { node_id: node.id }, ctxFor(alice));
    const body = JSON.stringify(res.result);
    // The visitor may see the shape and the volume of their network. The
    // people in it did not agree to have their email read out by a chatbot,
    // and the web UI does not show it either.
    expect(body).not.toContain("@");
    expect(body).not.toContain("password");
  });
});

describe("the suite behaves", () => {
  test("every registered tool declares a description and a schema", () => {
    for (const tool of allTools()) {
      expect(`${tool.name}: description`).toBe(
        tool.description?.length > 20 ? `${tool.name}: description` : `${tool.name}: MISSING`
      );
      expect(`${tool.name}: schema`).toBe(
        tool.parameters?.type === "object" ? `${tool.name}: schema` : `${tool.name}: MISSING`
      );
    }
  });

  test("no tool accepts an identity argument from the model", () => {
    // The single rule that keeps ownership honest: whose data this is comes
    // from ctx, never from something the model can write.
    const banned = ["user_id", "owner_id", "customer_id", "as_user", "account_id", "email"];
    for (const tool of allTools()) {
      for (const key of Object.keys(tool.parameters?.properties || {})) {
        expect(`${tool.name}.${key}`).toBe(
          banned.includes(key) ? `${tool.name}.${key} IS AN IDENTITY ARG` : `${tool.name}.${key}`
        );
      }
    }
  });

  test("nothing account-scoped or irreversible is marked public", () => {
    // Asserted as an invariant rather than as an exact list: the list churns
    // every time a harmless public tool is added, and a churning test gets
    // updated reflexively -- which is exactly when it stops catching the one
    // change that mattered.
    const anon = schemasFor({ userId: null, permissions: [] }).map((t) => getTool(t.function.name));

    for (const tool of anon) {
      expect(`${tool.name} reads an account`).toBe(
        tool.name.startsWith("get_my_") || tool.name.startsWith("get_network_")
          ? `${tool.name} IS ACCOUNT-SCOPED BUT PUBLIC`
          : `${tool.name} reads an account`
      );
      expect(`${tool.name} is consequential`).toBe(
        tool.consequential ? `${tool.name} IS CONSEQUENTIAL BUT PUBLIC` : `${tool.name} is consequential`
      );
    }
  });

  test("anonymous callers never reach the agent at all", async () => {
    // The stronger guarantee behind the one above: `agentAvailable` gates on
    // userId, so a visitor with no account gets the retrieval assistant on the
    // path it has always used, with no `tools` array sent upstream.
    const { agentAvailable } = await import("../src/services/agentService.js");
    expect(agentAvailable({ userId: null, permissions: [] })).toBe(false);
    expect(agentAvailable({ userId: "u1", permissions: [] })).toBe(true);
  });

  test("a signed-in customer gets the account tools but nothing staff-gated", () => {
    const names = schemasFor({ userId: "u1", permissions: [] }).map((t) => t.function.name);
    expect(names).toContain("get_my_network");
    expect(names.every((n) => getTool(n).auth !== "permission")).toBe(true);
  });

  test("an empty network answers helpfully instead of with an empty list", async () => {
    // "[]" reads to a model as a failed lookup and it starts guessing. Saying
    // what the emptiness MEANS is what stops that.
    const fresh = await signup("iso-empty");
    const res = await run("get_my_network", {}, ctxFor(fresh));
    expect(res.result.count).toBe(0);
    expect(res.result.note).toContain("no network position yet");
  });

  test("money crosses the boundary pre-formatted", async () => {
    const admin = await signupAdmin("iso-money-admin");
    const product = await createProduct(admin.token);
    const alice = await signup("iso-money");
    fund(alice.user.id, 10_000_000);
    await buy(alice, product);

    const res = await run("get_my_orders", {}, ctxFor(alice));
    const paid = res.result.orders[0].paid;
    // A bare cents integer invites the model to quote it verbatim; a display
    // string plus the raw value lets it both speak and compute.
    expect(paid.display).toMatch(/^\$[\d,]+\.\d{2}$/);
    expect(typeof paid.cents).toBe("number");
  });
});
