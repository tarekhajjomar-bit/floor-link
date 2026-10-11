// Security tests for the payroll / HR / account rules (emulator only).
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const fs = require("fs");
const path = require("path");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); console.log("  PASS  " + name); passed++; }
  catch (e) { console.log("  FAIL  " + name + "\n        " + (e.message || e)); failed++; }
}

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: "floor-link-test",
    firestore: { rules: fs.readFileSync(process.argv[2], "utf8"), host: "127.0.0.1", port: 8080 },
  });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc("users/owner").set({ role: "admin", fullName: "Tarek" });
    await db.doc("users/hr1").set({ role: "hr", fullName: "HR" });
    await db.doc("users/sup1").set({ role: "supervisor", fullName: "Sup", company: "shoppies" });
    await db.doc("users/view1").set({ role: "viewer", companies: ["omar_mina"] });
    await db.doc("users/mgr2").set({ role: "admin", fullName: "Other manager" });
    await db.doc("users/legacy").set({ role: "supervisor", username: "old" });
    await db.doc("pay_staff/114").set({ name: "Ibrahim", baseSalary: 600, advanceLimit: 100 });
    await db.doc("pay_staff/115").set({ name: "NoLimit", baseSalary: 500 });
    await db.doc("hr_staff/114").set({ name: "Ibrahim", did: "114" });
    await db.doc("pay_warnings/w1").set({ did: "114", reason: "late" });
    await db.doc("attendance_days/2026-10-10").set({ rows: [] });
    await db.doc("pay_discounts/d0").set({ did: "114", amount: 10, month: "2026-10", by: "hr1" });
    await db.doc("pay_requests/r0").set({ did: "114", amount: 300, month: "2026-10", by: "hr1", status: "pending" });
  });

  const owner = testEnv.authenticatedContext("owner", { role: "admin", email: "tarek.hajjomar@gmail.com" }).firestore();
  const mgr2 = testEnv.authenticatedContext("mgr2", { role: "admin", email: "someone@else.com" }).firestore();
  const hr = testEnv.authenticatedContext("hr1", { role: "hr", email: "hr@shop.com" }).firestore();
  const sup = testEnv.authenticatedContext("sup1", { role: "supervisor", email: "sup@shop.com" }).firestore();
  const viewer = testEnv.authenticatedContext("view1", { email: "v@shop.com" }).firestore();
  const newbie = testEnv.authenticatedContext("newuid", { email: "new@shop.com" }).firestore();

  console.log("\nsalaries are the owner's only");
  await check("owner reads a salary", () => assertSucceeds(owner.doc("pay_staff/114").get()));
  await check("owner writes a salary", () => assertSucceeds(owner.doc("pay_staff/114").update({ baseSalary: 650 })));
  await check("HR cannot read a salary", () => assertFails(hr.doc("pay_staff/114").get()));
  await check("another manager cannot read a salary", () => assertFails(mgr2.doc("pay_staff/114").get()));
  await check("supervisor cannot read a salary", () => assertFails(sup.doc("pay_staff/114").get()));
  await check("supervisor cannot write a salary", () => assertFails(sup.doc("pay_staff/999").set({ baseSalary: 1 })));
  await check("HR cannot read warnings", () => assertFails(hr.doc("pay_warnings/w1").get()));
  await check("HR cannot read month closing", () => assertFails(hr.doc("pay_months/2026-10").get()));
  await check("HR reads employee names", () => assertSucceeds(hr.doc("hr_staff/114").get()));
  await check("HR cannot edit employee names", () => assertFails(hr.doc("hr_staff/114").update({ name: "x" })));
  await check("supervisor cannot read employee names", () => assertFails(sup.doc("hr_staff/114").get()));

  console.log("\nattendance");
  await check("HR reads attendance", () => assertSucceeds(hr.doc("attendance_days/2026-10-10").get()));
  await check("owner reads attendance", () => assertSucceeds(owner.doc("attendance_days/2026-10-10").get()));
  await check("supervisor cannot read attendance", () => assertFails(sup.doc("attendance_days/2026-10-10").get()));

  console.log("\nadvances and the hidden limit (limit 100)");
  const advance = (db, id, amount, totalBefore, did = "114") => {
    const b = db.batch();
    b.set(db.doc("pay_advances/" + id), { did, month: "2026-10", amount, by: "hr1", approvedOver: false });
    b.set(db.doc("pay_adv_totals/" + did + "_2026-10"), { did, month: "2026-10", total: totalBefore + amount, lastId: id });
    return b.commit();
  };
  await check("HR gives 60 (under the limit)", () => assertSucceeds(advance(hr, "a1", 60, 0)));
  await check("HR gives 30 more (total 90)", () => assertSucceeds(advance(hr, "a2", 30, 60)));
  await check("HR cannot give 20 more (total 110 > limit)", () => assertFails(advance(hr, "a3", 20, 90)));
  await check("HR cannot lie about the old total", () => assertFails(advance(hr, "a4", 20, 0)));
  await check("HR cannot add an advance without the total", () =>
    assertFails(hr.doc("pay_advances/a5").set({ did: "114", month: "2026-10", amount: 5, by: "hr1", approvedOver: false })));
  await check("HR cannot lower the total by hand", () =>
    assertFails(hr.doc("pay_adv_totals/114_2026-10").set({ did: "114", month: "2026-10", total: 0, lastId: "a2" })));
  await check("HR cannot mark an advance as approved over the limit", () => {
    const b = hr.batch();
    b.set(hr.doc("pay_advances/a6"), { did: "114", month: "2026-10", amount: 5, by: "hr1", approvedOver: true });
    b.set(hr.doc("pay_adv_totals/114_2026-10"), { did: "114", month: "2026-10", total: 95, lastId: "a6" });
    return assertFails(b.commit());
  });
  await check("HR cannot give any advance when no limit is set", () => assertFails(advance(hr, "a7", 1, 0, "115")));
  await check("HR cannot delete an advance", () => assertFails(hr.doc("pay_advances/a1").delete()));
  await check("HR reads advances", () => assertSucceeds(hr.doc("pay_advances/a1").get()));
  await check("supervisor cannot read advances", () => assertFails(sup.doc("pay_advances/a1").get()));
  await check("owner can give over the limit", () => {
    const b = owner.batch();
    b.set(owner.doc("pay_advances/o1"), { did: "114", month: "2026-10", amount: 500, by: "owner", approvedOver: true });
    b.set(owner.doc("pay_adv_totals/114_2026-10"), { did: "114", month: "2026-10", total: 590, lastId: "o1" });
    return assertSucceeds(b.commit());
  });
  await check("owner deletes an advance", () => assertSucceeds(owner.doc("pay_advances/a2").delete()));

  console.log("\ndiscounts and over-limit requests");
  await check("HR adds a discount", () => assertSucceeds(hr.doc("pay_discounts/d1").set({ did: "114", amount: 15, month: "2026-10", by: "hr1" })));
  await check("HR cannot add a discount in someone else's name", () => assertFails(hr.doc("pay_discounts/d2").set({ did: "114", amount: 15, month: "2026-10", by: "owner" })));
  await check("HR cannot delete a discount", () => assertFails(hr.doc("pay_discounts/d0").delete()));
  await check("supervisor cannot add a discount", () => assertFails(sup.doc("pay_discounts/d3").set({ did: "114", amount: 1, month: "2026-10", by: "sup1" })));
  await check("HR sends an over-limit request", () => assertSucceeds(hr.doc("pay_requests/r1").set({ did: "114", amount: 300, month: "2026-10", by: "hr1", status: "pending" })));
  await check("HR cannot approve its own request", () => assertFails(hr.doc("pay_requests/r0").update({ status: "approved" })));
  await check("HR cannot send a pre-approved request", () => assertFails(hr.doc("pay_requests/r2").set({ did: "114", amount: 300, month: "2026-10", by: "hr1", status: "approved" })));
  await check("owner approves a request", () => assertSucceeds(owner.doc("pay_requests/r0").update({ status: "approved" })));

  console.log("\naccounts can no longer be changed by employees");
  await check("supervisor cannot make itself HR", () => assertFails(sup.doc("users/sup1").update({ role: "hr" })));
  await check("supervisor cannot make itself admin", () => assertFails(sup.doc("users/sup1").update({ role: "admin" })));
  await check("supervisor cannot edit another account", () => assertFails(sup.doc("users/hr1").update({ fullName: "x" })));
  await check("supervisor cannot create an admin account", () => assertFails(sup.doc("users/evil").set({ role: "admin" })));
  await check("viewer cannot widen its own branches", () => assertFails(viewer.doc("users/view1").update({ companies: ["omar_mina", "shoppies"] })));
  await check("employee can still update its own last login", () => assertSucceeds(sup.doc("users/sup1").update({ lastLoginAt: "2026-10-11" })));
  await check("employee can still sign itself up as supervisor", () => assertSucceeds(newbie.doc("users/newuid").set({ role: "supervisor", fullName: "N" })));
  await check("new sign-in can mark its old account as migrated", () => assertSucceeds(newbie.doc("users/legacy").update({ migratedToUid: "newuid" })));
  await check("manager creates an HR account", () => assertSucceeds(mgr2.doc("users/hr2").set({ role: "hr", fullName: "HR 2" })));
  await check("manager changes a role", () => assertSucceeds(owner.doc("users/sup1").update({ role: "merchandiser" })));
  await check("employees can still read the account list", () => assertSucceeds(sup.doc("users/hr1").get()));

  console.log(`\n${passed} passed, ${failed} failed`);
  await testEnv.cleanup();
  process.exit(failed ? 1 : 0);
})();
