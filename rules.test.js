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
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc("expiry_items/item1").set({
      barcode: "123", productName: "Test Item", status: "active",
      createdBy: { userId: "employee-1" }, qty: "5", expiryDate: "2026-12-01",
      category: "food",
    });
  });

  const admin = testEnv.authenticatedContext("admin-1", { role: "admin" }).firestore();
  const employee = testEnv.authenticatedContext("employee-1", { role: "supervisor" }).firestore();
  const otherEmployee = testEnv.authenticatedContext("employee-2", { role: "merchandiser" }).firestore();
  const anon = testEnv.unauthenticatedContext().firestore();

  console.log("\nexpiry_items");
  await check("employee can read an item", async () => {
    await assertSucceeds(employee.doc("expiry_items/item1").get());
  });
  await check("signed-out user cannot read", async () => {
    await assertFails(anon.doc("expiry_items/item1").get());
  });
  await check("employee can create their own item", async () => {
    await assertSucceeds(employee.doc("expiry_items/item2").set({
      barcode: "999", productName: "New Item", status: "active",
      createdBy: { userId: "employee-1" }, qty: "1", expiryDate: "2026-12-01",
    }));
  });
  await check("employee CANNOT create an item claiming to be someone else", async () => {
    await assertFails(employee.doc("expiry_items/item3").set({
      barcode: "111", productName: "Spoofed", status: "active",
      createdBy: { userId: "employee-2" }, qty: "1", expiryDate: "2026-12-01",
    }));
  });
  await check("employee can update quantity (non-destructive field)", async () => {
    await assertSucceeds(employee.doc("expiry_items/item1").update({ qty: "3" }));
  });
  await check("employee CANNOT soft-delete (set status)", async () => {
    await assertFails(employee.doc("expiry_items/item1").update({
      status: "deleted", deletedInfo: { userId: "employee-1", at: "now" },
    }));
  });
  await check("admin CAN soft-delete", async () => {
    await assertSucceeds(admin.doc("expiry_items/item1").update({
      status: "deleted", deletedInfo: { userId: "admin-1", at: "now" },
    }));
  });
  await check("employee CANNOT hard-delete the document", async () => {
    await assertFails(employee.doc("expiry_items/item1").delete());
  });
  await check("admin CAN hard-delete the document", async () => {
    await assertSucceeds(admin.doc("expiry_items/item1").delete());
  });

  console.log("\nactivity_log");
  await check("employee can log their own activity", async () => {
    await assertSucceeds(employee.collection("activity_log").add({
      userId: "employee-1", action: "view", points: 1, at: "2026-01-01",
    }));
  });
  await check("employee CANNOT log activity as someone else", async () => {
    await assertFails(otherEmployee.collection("activity_log").add({
      userId: "employee-1", action: "view", points: 1, at: "2026-01-01",
    }));
  });
  await check("employee CANNOT read the activity log", async () => {
    await assertFails(employee.collection("activity_log").get());
  });
  await check("admin CAN read the activity log", async () => {
    await assertSucceeds(admin.collection("activity_log").get());
  });

  console.log("\nusers");
  await check("a new user can create their own profile as supervisor", async () => {
    await assertSucceeds(testEnv.authenticatedContext("new-user", {}).firestore()
      .doc("users/new-user").set({ fullName: "Test", role: "supervisor" }));
  });
  await check("a new user CANNOT self-assign the admin role", async () => {
    await assertFails(testEnv.authenticatedContext("sneaky-user", {}).firestore()
      .doc("users/sneaky-user").set({ fullName: "Sneaky", role: "admin" }));
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await testEnv.cleanup();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
