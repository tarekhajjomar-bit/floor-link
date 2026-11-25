// Tests for the Kitchen OS part of firestore.rules (Nov 2026).
// Emulator only — never production. Run with:
//   firebase emulators:exec --only firestore "node test/kitchen.rules.test.js"

const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const fs = require("fs");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); console.log("  PASS  " + name); passed++; }
  catch (e) { console.log("  FAIL  " + name + "\n        " + e.message); failed++; }
}

async function main() {
  const env = await initializeTestEnvironment({
    projectId: "floor-link-test",
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });

  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Floor Link accounts
    await db.doc("users/tarek").set({ role: "admin" });
    await db.doc("users/super1").set({ role: "supervisor" });
    await db.doc("users/chef1").set({ role: "kitchen" });
    await db.doc("users/cook1").set({ role: "kitchen" });
    // Kitchen roles
    await db.doc("kitchen_members/tarek").set({ role: "owner" });
    await db.doc("kitchen_members/chef1").set({ role: "chef" });
    await db.doc("kitchen_members/cook1").set({ role: "cook" });
    await db.doc("kitchen_members/oldchef").set({ role: "chef", active: false });
    await db.doc("users/oldchef").set({ role: "kitchen" });
    // Floor Link data
    await db.doc("catalog/p1").set({ name: "Milk" });
    await db.doc("handovers/h1").set({ company: "shoppies" });
    // Kitchen data
    await db.doc("kitchen_ingredients/i1").set({ name: "برغل" });
    await db.doc("kitchen_recipes/r1").set({ name: "كبة", officialVersion: 1, latestVersion: 2 });
    await db.doc("kitchen_recipes/r1/versions/1").set({ n: 1, status: "approved", proposedBy: "chef1", lines: [] });
    await db.doc("kitchen_recipes/r1/versions/2").set({ n: 2, status: "proposed", proposedBy: "chef1", lines: [] });
    await db.doc("kitchen_costs/thighs").set({ price: 4 });
    await db.doc("kitchen_pricing/r1").set({ sellingPrice: 6 });
    await db.doc("kitchen_members/acc1").set({ role: "accountant" });
    await db.doc("kitchen_members/rec1").set({ role: "receiving" });
    await db.doc("kitchen_deliveries/d1").set({ status: "awaiting_qc", createdBy: "rec1", lines: [] });
    await db.doc("kitchen_deliveries/d2").set({ status: "done", createdBy: "rec1", qcBy: "chef1", lines: [] });
    await db.doc("kitchen_claims/cl1").set({ status: "open", createdBy: "chef1", lines: [] });
    await db.doc("kitchen_claims/cl2").set({ status: "replaced", createdBy: "chef1", lines: [] });
    await db.doc("kitchen_requests/q1").set({ status: "requested", createdBy: "chef1", lines: [{ qty: 1 }] });
    await db.doc("kitchen_requests/q2").set({ status: "ordered", createdBy: "chef1", lines: [] });
    await db.doc("kitchen_counts/k1").set({ status: "submitted", createdBy: "chef1", lines: [] });
    await db.doc("kitchen_batches/b2").set({ status: "available", qty: 5000, remaining: 5000, ingredientId: "onion" });
    await db.doc("kitchen_batches/b3").set({ status: "hold", qty: 5000, remaining: 5000, ingredientId: "onion" });
    await db.doc("kitchen_waste/w1").set({ by: "chef1", qty: 10, key: "onion" });
    await db.doc("kitchen_batches/b1").set({ status: "available", qty: 40000, remaining: 40000, ingredientId: "lamb" });
  });

  const as = (uid, claims) => env.authenticatedContext(uid, claims || {}).firestore();
  const owner = as("tarek", { role: "admin" });
  const sup = as("super1", { role: "supervisor" });
  const chef = as("chef1", { role: "kitchen" });
  const cook = as("cook1", { role: "kitchen" });
  const old = as("oldchef", { role: "kitchen" });
  const acc = as("acc1", {});
  const rec = as("rec1", {});
  const anon = env.authenticatedContext("anon1", { firebase: { sign_in_provider: "anonymous" } }).firestore();

  console.log("Floor Link staff and kitchen data");
  await check("supervisor cannot read kitchen recipes", () => assertFails(sup.doc("kitchen_recipes/r1").get()));
  await check("supervisor cannot read kitchen ingredients", () => assertFails(sup.doc("kitchen_ingredients/i1").get()));
  await check("supervisor cannot create kitchen data", () => assertFails(sup.doc("kitchen_ingredients/x").set({ name: "x" })));
  await check("supervisor cannot give himself a kitchen role", () => assertFails(sup.doc("kitchen_members/super1").set({ role: "owner" })));
  await check("supervisor still reads catalog (unchanged)", () => assertSucceeds(sup.doc("catalog/p1").get()));
  await check("anonymous visitor reads nothing in the kitchen", () => assertFails(anon.doc("kitchen_recipes/r1").get()));
  await check("unknown kitchen_* collection is closed", () => assertFails(owner.doc("kitchen_secret/x").get()));

  console.log("Kitchen accounts and Floor Link data");
  await check("chef cannot read Floor Link catalog", () => assertFails(chef.doc("catalog/p1").get()));
  await check("chef cannot read handovers", () => assertFails(chef.doc("handovers/h1").get()));
  await check("chef cannot write catalog", () => assertFails(chef.doc("catalog/p2").set({ name: "x" })));
  await check("chef can read his own users doc", () => assertSucceeds(chef.doc("users/chef1").get()));
  await check("chef cannot change his own Floor Link role", () => assertFails(chef.doc("users/chef1").update({ role: "admin" })));

  console.log("Recipes and versions");
  await check("chef reads recipes", () => assertSucceeds(chef.doc("kitchen_recipes/r1").get()));
  await check("chef reads a proposal", () => assertSucceeds(chef.doc("kitchen_recipes/r1/versions/2").get()));
  await check("cook reads the approved version", () => assertSucceeds(cook.doc("kitchen_recipes/r1/versions/1").get()));
  await check("cook cannot read a proposal", () => assertFails(cook.doc("kitchen_recipes/r1/versions/2").get()));
  await check("cook cannot add an ingredient", () => assertFails(cook.doc("kitchen_ingredients/i2").set({ name: "x" })));
  await check("inactive chef reads nothing", () => assertFails(old.doc("kitchen_recipes/r1").get()));
  await check("chef creates a recipe without an official version", () =>
    assertSucceeds(chef.doc("kitchen_recipes/r2").set({ name: "شيش برك", officialVersion: null, latestVersion: 1 })));
  await check("chef cannot create a recipe that is already official", () =>
    assertFails(chef.doc("kitchen_recipes/r3").set({ name: "x", officialVersion: 1 })));
  await check("chef proposes a version as himself", () =>
    assertSucceeds(chef.doc("kitchen_recipes/r2/versions/1").set({ n: 1, status: "proposed", proposedBy: "chef1", lines: [] })));
  await check("chef cannot propose in someone else's name", () =>
    assertFails(chef.doc("kitchen_recipes/r2/versions/2").set({ n: 2, status: "proposed", proposedBy: "tarek", lines: [] })));
  await check("chef cannot create an approved version", () =>
    assertFails(chef.doc("kitchen_recipes/r2/versions/3").set({ n: 3, status: "approved", proposedBy: "chef1", lines: [] })));
  await check("chef cannot approve his proposal", () =>
    assertFails(chef.doc("kitchen_recipes/r1/versions/2").update({ status: "approved" })));
  await check("chef cannot make a version official on the recipe", () =>
    assertFails(chef.doc("kitchen_recipes/r1").update({ officialVersion: 2 })));
  await check("chef edits his own proposal", () =>
    assertSucceeds(chef.doc("kitchen_recipes/r1/versions/2").update({ reason: "أوضح" })));
  await check("nobody edits an approved version", () =>
    assertFails(owner.doc("kitchen_recipes/r1/versions/1").update({ lines: [{ qty: 5 }] })));

  console.log("Owner approval");
  await check("owner approves the proposal", () =>
    assertSucceeds(owner.doc("kitchen_recipes/r1/versions/2").update({ status: "approved", approvedBy: "tarek" })));
  await check("owner archives the old version (status only)", () =>
    assertSucceeds(owner.doc("kitchen_recipes/r1/versions/1").update({ status: "archived", archivedAt: 1, archivedBy: "tarek" })));
  await check("owner sets the official version", () =>
    assertSucceeds(owner.doc("kitchen_recipes/r1").update({ officialVersion: 2, approvedBy: "tarek", approvedAt: 1 })));
  await check("approved version cannot go back to proposed", () =>
    assertFails(owner.doc("kitchen_recipes/r1/versions/2").update({ status: "proposed" })));

  console.log("Prices, cleaning log, selling prices");
  await check("owner reads purchase prices", () => assertSucceeds(owner.doc("kitchen_costs/thighs").get()));
  await check("owner sets a purchase price", () => assertSucceeds(owner.doc("kitchen_costs/thighs").set({ price: 4.2 })));
  await check("accountant reads purchase prices", () => assertSucceeds(acc.doc("kitchen_costs/thighs").get()));
  await check("accountant cannot change purchase prices", () => assertFails(acc.doc("kitchen_costs/thighs").set({ price: 1 })));
  await check("chef cannot see purchase prices", () => assertFails(chef.doc("kitchen_costs/thighs").get()));
  await check("cook cannot see purchase prices", () => assertFails(cook.doc("kitchen_costs/thighs").get()));
  await check("supervisor cannot see purchase prices", () => assertFails(sup.doc("kitchen_costs/thighs").get()));
  await check("cook logs a cleaning in his name", () =>
    assertSucceeds(cook.doc("kitchen_cleaning/c1").set({ by: "cook1", ingredientId: "thighs", before: 10000, after: 8900 })));
  await check("cook cannot log in someone else's name", () =>
    assertFails(cook.doc("kitchen_cleaning/c2").set({ by: "chef1", ingredientId: "thighs", before: 10000, after: 8900 })));
  await check("after cannot be heavier than before", () =>
    assertFails(cook.doc("kitchen_cleaning/c3").set({ by: "cook1", ingredientId: "thighs", before: 10000, after: 12000 })));
  await check("weights must be numbers", () =>
    assertFails(cook.doc("kitchen_cleaning/c4").set({ by: "cook1", ingredientId: "thighs", before: "10", after: 8 })));
  await check("cook cannot edit a cleaning entry", () => assertFails(cook.doc("kitchen_cleaning/c1").update({ after: 9900 })));
  await check("chef reads the cleaning log", () => assertSucceeds(chef.doc("kitchen_cleaning/c1").get()));
  await check("owner corrects a cleaning entry", () => assertSucceeds(owner.doc("kitchen_cleaning/c1").update({ after: 8800 })));
  await check("supervisor cannot read the cleaning log", () => assertFails(sup.doc("kitchen_cleaning/c1").get()));
  await check("owner sets a selling price", () => assertSucceeds(owner.doc("kitchen_pricing/r1").set({ sellingPrice: 6.25 })));
  await check("chef cannot read selling prices", () => assertFails(chef.doc("kitchen_pricing/r1").get()));
  await check("accountant cannot change selling prices", () => assertFails(acc.doc("kitchen_pricing/r1").set({ sellingPrice: 1 })));

  console.log("Receiving, quality check, stock");
  await check("receiving records a delivery", () => assertSucceeds(rec.doc("kitchen_deliveries/d3").set({ status: "awaiting_qc", createdBy: "rec1", lines: [] })));
  await check("receiving cannot mark a delivery as checked", () => assertFails(rec.doc("kitchen_deliveries/d1").update({ status: "done", qcBy: "rec1" })));
  await check("receiving fixes a line before the check", () => assertSucceeds(rec.doc("kitchen_deliveries/d1").update({ invoiceNo: "4471" })));
  await check("cook cannot record deliveries", () => assertFails(cook.doc("kitchen_deliveries/d4").set({ status: "awaiting_qc", createdBy: "cook1", lines: [] })));
  await check("chef closes the quality check", () => assertSucceeds(chef.doc("kitchen_deliveries/d1").update({ status: "done", qcBy: "chef1" })));
  await check("a checked delivery cannot change", () => assertFails(owner.doc("kitchen_deliveries/d2").update({ invoiceNo: "x" })));
  await check("chef creates the accepted batch", () => assertSucceeds(chef.doc("kitchen_batches/d1_0").set({ status: "available", qty: 40000, remaining: 40000, ingredientId: "lamb" })));
  await check("the same line cannot be added twice", () => assertFails(chef.doc("kitchen_batches/d1_0").set({ status: "available", qty: 40000, remaining: 40000, ingredientId: "lamb" })));
  await check("a batch cannot start with a different remaining", () => assertFails(chef.doc("kitchen_batches/d1_1").set({ status: "available", qty: 10, remaining: 50 })));
  await check("receiving cannot create stock", () => assertFails(rec.doc("kitchen_batches/x1").set({ status: "available", qty: 10, remaining: 10 })));
  await check("chef puts a batch on hold", () => assertSucceeds(chef.doc("kitchen_batches/b1").update({ status: "hold", holdReason: "رائحة", holdBy: "chef1" })));
  await check("chef cannot release a hold", () => assertFails(chef.doc("kitchen_batches/b1").update({ status: "available" })));
  await check("owner decides on a held batch", () => assertSucceeds(owner.doc("kitchen_batches/b1").update({ status: "discarded", remaining: 0 })));
  await check("cook reads stock", () => assertSucceeds(cook.doc("kitchen_batches/b1").get()));
  await check("supervisor cannot read stock", () => assertFails(sup.doc("kitchen_batches/b1").get()));
  await check("nobody deletes a batch", () => assertFails(owner.doc("kitchen_batches/b1").delete()));

  console.log("Claims, purchase requests, stock counts");
  await check("chef opens a claim at the quality check", () => assertSucceeds(chef.doc("kitchen_claims/d1").set({ status: "open", createdBy: "chef1", lines: [] })));
  await check("a claim cannot start closed", () => assertFails(chef.doc("kitchen_claims/x9").set({ status: "refunded", createdBy: "chef1" })));
  await check("receiving cannot open a claim", () => assertFails(rec.doc("kitchen_claims/x8").set({ status: "open", createdBy: "rec1" })));
  await check("accountant reads claims", () => assertSucceeds(acc.doc("kitchen_claims/cl1").get()));
  await check("cook cannot read claims", () => assertFails(cook.doc("kitchen_claims/cl1").get()));
  await check("chef cannot close a claim", () => assertFails(chef.doc("kitchen_claims/cl1").update({ status: "dropped", closedBy: "chef1" })));
  await check("owner cannot change claim items when closing", () => assertFails(owner.doc("kitchen_claims/cl1").update({ status: "replaced", closedBy: "tarek", lines: [{ qty: 9 }] })));
  await check("owner closes a claim", () => assertSucceeds(owner.doc("kitchen_claims/cl1").update({ status: "replaced", closedBy: "tarek", closeNote: "" })));
  await check("a closed claim never changes", () => assertFails(owner.doc("kitchen_claims/cl2").update({ status: "refunded", closedBy: "tarek" })));
  await check("chef sends a purchase request", () => assertSucceeds(chef.doc("kitchen_requests/q3").set({ status: "requested", createdBy: "chef1", lines: [] })));
  await check("cook cannot send a purchase request", () => assertFails(cook.doc("kitchen_requests/q4").set({ status: "requested", createdBy: "cook1", lines: [] })));
  await check("receiving cannot mark a new request ordered", () => assertFails(rec.doc("kitchen_requests/q1").update({ status: "ordered", orderedBy: "rec1" })));
  await check("nobody changes the items of a request", () => assertFails(owner.doc("kitchen_requests/q1").update({ status: "ordered", orderedBy: "tarek", lines: [] })));
  await check("owner marks a request ordered", () => assertSucceeds(owner.doc("kitchen_requests/q1").update({ status: "ordered", orderedBy: "tarek", orderedAt: 1 })));
  await check("receiving marks an ordered request arrived", () => assertSucceeds(rec.doc("kitchen_requests/q2").update({ status: "received", receivedBy: "rec1", receivedAt: 1 })));
  await check("chef cancels his own new request", () => assertSucceeds(chef.doc("kitchen_requests/q3").update({ status: "cancelled", cancelledBy: "chef1" })));
  await check("chef sends a stock count", () => assertSucceeds(chef.doc("kitchen_counts/k2").set({ status: "submitted", createdBy: "chef1", lines: [] })));
  await check("chef cannot apply a count", () => assertFails(chef.doc("kitchen_counts/k1").update({ status: "applied", decidedBy: "chef1" })));
  await check("owner cannot change the counted numbers", () => assertFails(owner.doc("kitchen_counts/k1").update({ status: "applied", decidedBy: "tarek", lines: [{ counted: 1 }] })));
  await check("owner applies a count", () => assertSucceeds(owner.doc("kitchen_counts/k1").update({ status: "applied", decidedBy: "tarek", decidedAt: 1 })));
  await check("an applied count cannot be applied again", () => assertFails(owner.doc("kitchen_counts/k1").update({ status: "rejected", decidedBy: "tarek" })));
  await check("cook cannot read counts", () => assertFails(cook.doc("kitchen_counts/k1").get()));
  await check("owner corrects a batch from a count", () => assertSucceeds(owner.doc("kitchen_batches/d1_0").update({ remaining: 38500, countId: "k1" })));
  await check("chef cannot correct a batch quantity", () => assertFails(chef.doc("kitchen_batches/d1_0").update({ remaining: 1 })));

  console.log("Production plan, production, waste");
  await check("chef saves the day's plan", () => assertSucceeds(chef.doc("kitchen_plans/2026-11-26").set({ lines: [], updatedBy: "chef1" })));
  await check("cook cannot change the plan", () => assertFails(cook.doc("kitchen_plans/2026-11-26").set({ lines: [], updatedBy: "cook1" })));
  await check("cook reads the plan", () => assertSucceeds(cook.doc("kitchen_plans/2026-11-26").get()));
  await check("cook takes from an available batch", () => assertSucceeds(cook.doc("kitchen_batches/b2").update({ remaining: 4200, lastUsedBy: "cook1", lastUsedAt: 1 })));
  await check("cook cannot add to a batch", () => assertFails(cook.doc("kitchen_batches/b2").update({ remaining: 9000, lastUsedBy: "cook1" })));
  await check("cook cannot use a held batch", () => assertFails(cook.doc("kitchen_batches/b3").update({ remaining: 100, lastUsedBy: "cook1" })));
  await check("cook cannot change other batch fields", () => assertFails(cook.doc("kitchen_batches/b2").update({ remaining: 4000, lastUsedBy: "cook1", expiry: "2030-01-01" })));
  await check("cook records a production", () => assertSucceeds(cook.doc("kitchen_production/p1").set({ by: "cook1", recipeId: "r1", qty: 10 })));
  await check("nobody edits a production", () => assertFails(owner.doc("kitchen_production/p1").update({ qty: 1 })));
  await check("cook creates the production output batch", () => assertSucceeds(cook.doc("kitchen_batches/p1_out").set({ status: "available", qty: 10, remaining: 10, productionId: "p1", ingredientId: "rcp_r1" })));
  await check("cook cannot create other stock", () => assertFails(cook.doc("kitchen_batches/x7").set({ status: "available", qty: 10, remaining: 10 })));
  await check("cook logs waste", () => assertSucceeds(cook.doc("kitchen_waste/w2").set({ by: "cook1", qty: 500, key: "onion" })));
  await check("cook cannot read the waste report", () => assertFails(cook.doc("kitchen_waste/w1").get()));
  await check("accountant reads waste", () => assertSucceeds(acc.doc("kitchen_waste/w1").get()));
  await check("nobody edits waste", () => assertFails(owner.doc("kitchen_waste/w1").update({ qty: 0 })));
  await check("supervisor cannot read production", () => assertFails(sup.doc("kitchen_production/p1").get()));

  console.log("Team and audit");
  await check("owner adds a team member", () => assertSucceeds(owner.doc("kitchen_members/new1").set({ role: "cook" })));
  await check("chef cannot change roles", () => assertFails(chef.doc("kitchen_members/cook1").update({ role: "owner" })));
  await check("chef writes an audit line as himself", () =>
    assertSucceeds(chef.doc("kitchen_audit/a1").set({ by: "chef1", action: "propose" })));
  await check("chef cannot read the audit log", () => assertFails(chef.doc("kitchen_audit/a1").get()));
  await check("nobody edits the audit log", () => assertFails(owner.doc("kitchen_audit/a1").update({ action: "x" })));

  await env.cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
