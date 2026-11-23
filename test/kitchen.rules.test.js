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
  });

  const as = (uid, claims) => env.authenticatedContext(uid, claims || {}).firestore();
  const owner = as("tarek", { role: "admin" });
  const sup = as("super1", { role: "supervisor" });
  const chef = as("chef1", { role: "kitchen" });
  const cook = as("cook1", { role: "kitchen" });
  const old = as("oldchef", { role: "kitchen" });
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
