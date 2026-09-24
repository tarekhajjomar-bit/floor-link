// Floor Link — notification sender.
//
// This script runs OUTSIDE the browser, on GitHub Actions' free schedule
// runner (not inside Firebase, since that would require the paid Blaze
// plan). It reads Firestore directly using a service account, decides
// what needs a push notification, and sends it via Firebase Cloud
// Messaging — all free, no billing account needed anywhere.
//
// Usage: node notify.js <mode>
//   mode is one of: handover | supervisor-reminder | expiry-check | merchandiser-reminder
//
// Required environment variable:
//   FIREBASE_SERVICE_ACCOUNT — the full JSON key of a Firebase service
//   account, as a single-line string (see SETUP.md for how to get this
//   and store it as a GitHub secret — never commit it to the repo).

const admin = require("firebase-admin");

function init() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.error("Missing FIREBASE_SERVICE_ACCOUNT environment variable.");
    process.exit(1);
  }
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch (e) {
    console.error("FIREBASE_SERVICE_ACCOUNT is not valid JSON:", e.message);
    process.exit(1);
  }
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

init();
const db = admin.firestore();
const messaging = admin.messaging();

/** Returns the FCM tokens for accounts matching a role (and optionally a specific userId). */
async function getTokens({ role, userId } = {}) {
  let query = db.collection("fcm_tokens");
  if (role) query = query.where("role", "==", role);
  if (userId) query = query.where("userId", "==", userId);
  const snap = await query.get();
  return [...new Set(snap.docs.map((d) => d.data().token).filter(Boolean))];
}

/** Sends one notification to a list of tokens, and cleans up any tokens Firebase reports as dead. */
async function sendToTokens(tokens, title, body, data) {
  if (!tokens || !tokens.length) return;
  const message = {
    notification: { title, body },
    data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
    tokens
  };
  const res = await messaging.sendEachForMulticast(message);
  console.log(`  → sent ${res.successCount}/${tokens.length} ("${title}")`);
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error && r.error.code;
      console.log(`    token ${i} failed: ${code}`);
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
        db.collection("fcm_tokens").doc(tokens[i]).delete().catch(() => {});
      }
    }
  });
}

/** Type 1 — a supervisor just submitted a handover: tell managers. */
async function checkNewHandovers() {
  const snap = await db.collection("handovers").where("notifiedAdmin", "==", false).get();
  if (snap.empty) { console.log("No new un-notified handovers."); return; }
  const managerTokens = await getTokens({ role: "manager" });
  for (const doc of snap.docs) {
    const d = doc.data();
    await sendToTokens(
      managerTokens,
      "تسليم وردية جديد",
      `${d.outgoingName || "مشرف"} سجّل تسليم بفرع ${d.company || ""}`,
      { type: "handover", id: doc.id }
    );
    await doc.ref.update({ notifiedAdmin: true });
  }
}

/** Type 2 — once a day, remind supervisors who haven't logged a handover today. */
async function checkSupervisorReminders() {
  const today = new Date().toISOString().slice(0, 10);
  const usersSnap = await db.collection("users")
    .where("role", "==", "supervisor")
    .where("disabled", "==", false)
    .get();
  const handoversSnap = await db.collection("handovers").where("date", "==", today).get();
  const submittedUserIds = new Set(handoversSnap.docs.map((d) => d.data().submittedByUserId).filter(Boolean));

  for (const userDoc of usersSnap.docs) {
    if (submittedUserIds.has(userDoc.id)) continue;
    const tokens = await getTokens({ userId: userDoc.id });
    await sendToTokens(
      tokens,
      "تذكير بالهاند أوفر",
      "لسا ما سجّلت تسليم وردية اليوم",
      { type: "supervisor-reminder" }
    );
  }
}

/** Type 3 — expiry alerts: notify managers as items cross the configured day thresholds. */
async function checkExpiry() {
  const thresholdsDoc = await db.doc("settings/expiry").get();
  const thresholds = (thresholdsDoc.exists && Array.isArray(thresholdsDoc.data().days) && thresholdsDoc.data().days.length)
    ? thresholdsDoc.data().days
    : [7, 3, 1];

  const itemsSnap = await db.collection("expiry_items").where("status", "==", "active").get();
  const managerTokens = await getTokens({ role: "manager" });
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  for (const doc of itemsSnap.docs) {
    const d = doc.data();
    if (!d.expiryDate) continue;
    const exp = new Date(d.expiryDate + "T00:00:00");
    const daysLeft = Math.round((exp - now) / 86400000);
    const notified = Array.isArray(d.notifiedThresholds) ? d.notifiedThresholds : [];

    for (const th of thresholds) {
      if (daysLeft <= th && !notified.includes(th)) {
        await sendToTokens(
          managerTokens,
          "منتج قرّب ينتهي",
          `${d.productName || d.barcode} — باقي ${daysLeft} يوم (${d.branch || ""})`,
          { type: "expiry", id: doc.id }
        );
        await doc.ref.update({ notifiedThresholds: admin.firestore.FieldValue.arrayUnion(th) });
      }
    }
  }
}

/** Type 4 — periodic nudge for merchandisers to log shortages / place reorders. */
async function merchandiserReminder() {
  const tokens = await getTokens({ role: "merchandiser" });
  await sendToTokens(
    tokens,
    "تذكير",
    "لا تنسى تسجّل النواقص وتعمل طلبية لأي صنف قرب يخلص",
    { type: "merchandiser-reminder" }
  );
}

const mode = process.argv[2];
const modes = {
  "handover": checkNewHandovers,
  "supervisor-reminder": checkSupervisorReminders,
  "expiry-check": checkExpiry,
  "merchandiser-reminder": merchandiserReminder
};

if (!modes[mode]) {
  console.error(`Unknown mode "${mode}". Expected one of: ${Object.keys(modes).join(", ")}`);
  process.exit(1);
}

console.log(`Running mode: ${mode}`);
modes[mode]()
  .then(() => { console.log("Done."); process.exit(0); })
  .catch((err) => { console.error("Failed:", err); process.exit(1); });
