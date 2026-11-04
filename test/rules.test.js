// Local tests for firestore.rules. These run ONLY against the emulator
// (started by `firebase emulators:exec` or `firebase emulators:start`),
// never against the real production database — there's no credential
// here that could even reach production.
//
// Run with:  firebase emulators:exec --only firestore "node test/rules.test.js"

const assert = require("assert");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const fs = require("fs");

let testEnv;
let passed = 0, failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log("  PASS  " + name);
    passed++;
  } catch (e) {
    console.log("  FAIL  " + name);
    console.log("        " + e.message);
    failed++;
  }
}

async function main() {
  testEnv = await initializeTestEnvironment({
    projectId: "floor-link-test",
    firestore: {
      rules: fs.readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });

  // --- Seed data as an admin bypassing rules, so tests start from a known state ---
  // Every account needs its users/{uid} document now: the rules look at it for the role
  // and for approval (new self-registered accounts are approved:false until the manager approves).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc("expiry_items/item1").set({
      barcode: "123", productName: "Test Item", status: "active", company: "shoppies",
      createdBy: { userId: "employee-1" }, qty: "5", expiryDate: "2026-12-01", category: "food",
    });
    await db.doc("handovers/h1").set({ company: "shoppies", managerNote: "" });
    await db.doc("catalog/c1").set({ name: "Rice" });
    await db.doc("settings/expiry").set({ days: [7, 3, 1] });
    await db.doc("delivery_shifts/d1").set({ branch: "B", month: "2026-11" });
    await db.doc("voice_messages/v1").set({ recipientIds: ["employee-1"], listened: {}, url: "x" });
    await db.doc("users/admin-1").set({ fullName: "Admin", role: "admin" });
    await db.doc("users/manager-1").set({ fullName: "Mgr", role: "manager" });
    await db.doc("users/employee-1").set({ fullName: "E1", role: "supervisor", company: "shoppies" });
    await db.doc("users/employee-2").set({ fullName: "E2", role: "merchandiser", company: "shoppies" });
    await db.doc("users/viewer-1").set({ fullName: "V", role: "viewer", companies: ["shoppies"] });
    await db.doc("users/delivery-1").set({ fullName: "D", role: "delivery" });
    await db.doc("users/pending-1").set({ fullName: "P", role: "merchandiser", approved: false });
    await db.doc("user_private/employee-1").set({ email: "e1@x.com" });
  });

  const ctx = (uid, claims) => testEnv.authenticatedContext(uid, claims || {}).firestore();
  const admin = ctx("admin-1", { role: "admin" });
  const manager = ctx("manager-1");
  const employee = ctx("employee-1", { role: "supervisor", email: "e1@x.com" });
  const otherEmployee = ctx("employee-2", { role: "merchandiser" });
  const viewer = ctx("viewer-1");
  const delivery = ctx("delivery-1");
  const pending = ctx("pending-1", { email: "p@x.com" });
  const anonUser = ctx("anon-1", { firebase: { sign_in_provider: "anonymous" } });
  const anon = testEnv.unauthenticatedContext().firestore();

  console.log("\nexpiry_items");
  await check("employee can read an item", async () => { await assertSucceeds(employee.doc("expiry_items/item1").get()); });
  await check("signed-out user cannot read", async () => { await assertFails(anon.doc("expiry_items/item1").get()); });
  await check("anonymous (feedback page) user cannot read", async () => { await assertFails(anonUser.doc("expiry_items/item1").get()); });
  await check("employee can create their own item", async () => {
    await assertSucceeds(employee.doc("expiry_items/item2").set({
      barcode: "999", productName: "New Item", status: "active", company: "shoppies",
      createdBy: { userId: "employee-1" }, qty: "1", expiryDate: "2026-12-01" }));
  });
  await check("employee CANNOT create an item claiming to be someone else", async () => {
    await assertFails(employee.doc("expiry_items/item3").set({
      barcode: "111", productName: "Spoofed", status: "active", company: "shoppies",
      createdBy: { userId: "employee-2" }, qty: "1", expiryDate: "2026-12-01" }));
  });
  await check("employee can update quantity", async () => { await assertSucceeds(employee.doc("expiry_items/item1").update({ qty: "3" })); });
  await check("employee CANNOT soft-delete", async () => {
    await assertFails(employee.doc("expiry_items/item1").update({ status: "deleted", deletedInfo: { userId: "employee-1", at: "now" } }));
  });
  await check("employee CANNOT hard-delete", async () => { await assertFails(employee.doc("expiry_items/item1").delete()); });
  await check("admin CAN hard-delete", async () => { await assertSucceeds(admin.doc("expiry_items/item1").delete()); });

  console.log("\nactivity_log");
  await check("employee can log their own activity", async () => {
    await assertSucceeds(employee.collection("activity_log").add({ userId: "employee-1", action: "view", points: 1, at: "2026-01-01" }));
  });
  await check("employee CANNOT log activity as someone else", async () => {
    await assertFails(otherEmployee.collection("activity_log").add({ userId: "employee-1", action: "view", points: 1, at: "2026-01-01" }));
  });
  await check("employee CANNOT read the activity log", async () => { await assertFails(employee.collection("activity_log").get()); });
  await check("admin CAN read the activity log", async () => { await assertSucceeds(admin.collection("activity_log").get()); });

  console.log("\nusers: self-registration waits for approval");
  const fresh = (uid, email) => ctx(uid, { email: email || uid + "@x.com" });
  await check("new user CAN self-register as supervisor with approved:false", async () => {
    await assertSucceeds(fresh("new-1").doc("users/new-1").set({ fullName: "T", role: "supervisor", approved: false }));
  });
  await check("new user CANNOT self-register without approved:false", async () => {
    await assertFails(fresh("new-2").doc("users/new-2").set({ fullName: "T", role: "supervisor" }));
  });
  await check("new user CANNOT self-register as already approved", async () => {
    await assertFails(fresh("new-3").doc("users/new-3").set({ fullName: "T", role: "supervisor", approved: true }));
  });
  await check("new user CANNOT self-assign admin/manager", async () => {
    await assertFails(fresh("new-4").doc("users/new-4").set({ fullName: "T", role: "admin", approved: false }));
    await assertFails(fresh("new-5").doc("users/new-5").set({ fullName: "T", role: "manager", approved: false }));
  });
  await check("new user CANNOT put an email into the public profile", async () => {
    await assertFails(fresh("new-6").doc("users/new-6").set({ fullName: "T", role: "supervisor", approved: false, email: "a@b.c" }));
  });
  await check("pending user can read their own profile", async () => { await assertSucceeds(pending.doc("users/pending-1").get()); });
  await check("pending user CANNOT approve themselves", async () => { await assertFails(pending.doc("users/pending-1").update({ approved: true })); });
  await check("employee CANNOT change their own role / approval", async () => {
    await assertFails(employee.doc("users/employee-1").update({ role: "manager" }));
    await assertFails(employee.doc("users/employee-1").update({ approved: false }));
  });
  await check("manager CAN approve a pending account", async () => { await assertSucceeds(manager.doc("users/pending-1").update({ approved: true })); });
  await check("employee can read colleagues' profiles (names), viewer cannot", async () => {
    await assertSucceeds(employee.doc("users/employee-2").get());
    await assertFails(viewer.doc("users/employee-2").get());
  });

  console.log("\npending (not yet approved) account");
  await testEnv.withSecurityRulesDisabled(async (c) => { await c.firestore().doc("users/pending-1").update({ approved: false }); });
  await check("pending CANNOT read other profiles", async () => { await assertFails(pending.doc("users/employee-2").get()); });
  await check("pending CANNOT read handovers / expiry / catalog / settings", async () => {
    await assertFails(pending.doc("handovers/h1").get());
    await assertFails(pending.doc("expiry_items/item2").get());
    await assertFails(pending.doc("catalog/c1").get());
    await assertFails(pending.doc("settings/expiry").get());
  });
  await check("pending CANNOT write anything", async () => {
    await assertFails(pending.doc("handovers/h9").set({ company: "shoppies" }));
    await assertFails(pending.doc("catalog/c9").set({ name: "x" }));
    await assertFails(pending.doc("fcm_tokens/tok").set({ token: "t", userId: "pending-1", role: "merchandiser" }));
  });

  console.log("\nuser_private (emails)");
  await check("employee CANNOT read another account's email", async () => { await assertFails(otherEmployee.doc("user_private/employee-1").get()); });
  await check("owner reads own, manager reads all", async () => {
    await assertSucceeds(employee.doc("user_private/employee-1").get());
    await assertSucceeds(manager.doc("user_private/employee-1").get());
  });
  await check("self-registration can store its OWN email only", async () => {
    await assertSucceeds(fresh("new-1", "me@x.com").doc("user_private/new-1").set({ email: "Me@x.com" }));
    await assertFails(fresh("new-7", "me@x.com").doc("user_private/new-7").set({ email: "other@x.com" }));
  });
  await check("employee CANNOT change an email afterwards", async () => { await assertFails(employee.doc("user_private/employee-1").update({ email: "z@x.com" })); });

  console.log("\nfcm_tokens (notification addresses)");
  await check("staff can register a token under own id and real role", async () => {
    await assertSucceeds(employee.doc("fcm_tokens/t1").set({ token: "t1", userId: "employee-1", role: "supervisor" }));
  });
  await check("staff CANNOT register as a manager / as someone else", async () => {
    await assertFails(employee.doc("fcm_tokens/t2").set({ token: "t2", userId: "employee-1", role: "manager" }));
    await assertFails(employee.doc("fcm_tokens/t3").set({ token: "t3", userId: "manager-1", role: "supervisor" }));
  });
  await check("staff CANNOT read tokens; manager can", async () => {
    await assertFails(employee.doc("fcm_tokens/t1").get());
    await assertSucceeds(manager.doc("fcm_tokens/t1").get());
  });
  await check("staff CANNOT delete someone else's token, can delete own", async () => {
    await assertFails(otherEmployee.doc("fcm_tokens/t1").delete());
    await assertSucceeds(employee.doc("fcm_tokens/t1").delete());
  });

  console.log("\nhandovers");
  await check("staff can add a handover", async () => { await assertSucceeds(employee.doc("handovers/h2").set({ company: "shoppies" })); });
  await check("staff CANNOT edit or delete a handover", async () => {
    await assertFails(employee.doc("handovers/h1").update({ managerNote: "x" }));
    await assertFails(employee.doc("handovers/h1").delete());
  });
  await check("manager can review/delete a handover", async () => {
    await assertSucceeds(manager.doc("handovers/h1").update({ managerReviewed: true }));
    await assertSucceeds(manager.doc("handovers/h2").delete());
  });
  await check("viewer reads own branch only, never writes", async () => {
    await assertSucceeds(viewer.doc("handovers/h1").get());
    await assertFails(viewer.doc("handovers/h3").set({ company: "shoppies" }));
  });

  console.log("\ndelivery_shifts / catalog / settings");
  await check("delivery account writes shifts; supervisor and merchandiser cannot", async () => {
    await assertSucceeds(delivery.doc("delivery_shifts/d2").set({ branch: "B", month: "2026-11" }));
    await assertFails(employee.doc("delivery_shifts/d3").set({ branch: "B" }));
    await assertFails(otherEmployee.doc("delivery_shifts/d1").delete());
  });
  await check("manager can fix delivery shifts", async () => { await assertSucceeds(manager.doc("delivery_shifts/d1").update({ branch: "C" })); });
  await check("staff add catalog products but cannot delete them", async () => {
    await assertSucceeds(employee.doc("catalog/c2").set({ name: "Tea" }));
    await assertFails(employee.doc("catalog/c1").delete());
    await assertSucceeds(manager.doc("catalog/c1").delete());
  });
  await check("only the manager changes settings; staff and viewer still read", async () => {
    await assertFails(employee.doc("settings/expiry").set({ days: [1] }));
    await assertSucceeds(manager.doc("settings/expiry").set({ days: [5] }));
    await assertSucceeds(employee.doc("settings/expiry").get());
    await assertSucceeds(viewer.doc("settings/expiry").get());
  });
  await check("anonymous cannot read catalog", async () => { await assertFails(anonUser.doc("catalog/c2").get()); });

  console.log("\nvoice_messages");
  await check("recipient can mark own listen, nobody else's", async () => {
    await assertSucceeds(employee.doc("voice_messages/v1").update({ "listened.employee-1": "now" }));
    await assertFails(employee.doc("voice_messages/v1").update({ "listened.employee-2": "now" }));
    await assertFails(otherEmployee.doc("voice_messages/v1").get());
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await testEnv.cleanup();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
