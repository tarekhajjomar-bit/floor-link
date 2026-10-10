// Floor Link — notification sender.
//
// This script runs OUTSIDE the browser, on GitHub Actions' free schedule
// runner (not inside Firebase, since that would require the paid Blaze
// plan). It reads Firestore directly using a service account, decides
// what needs a push notification, and sends it via Firebase Cloud
// Messaging — all free, no billing account needed anywhere.
//
// Usage: node notify.js <mode>
//   mode is one of: handover | feedback | supervisor-reminder | expiry-check | expiry-summary | merchandiser-reminder
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

// Manager accounts are stored with role "admin" since the move to Firebase Auth
// (older accounts said "manager"). Every manager notification goes to both.
const MANAGER_ROLES = ["admin", "manager"];

/** Returns the FCM tokens for accounts matching a role, or a list of roles (and optionally a specific userId). */
async function getTokens({ role, userId } = {}) {
  let query = db.collection("fcm_tokens");
  if (Array.isArray(role)) query = query.where("role", "in", role);
  else if (role) query = query.where("role", "==", role);
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
        // The app stores each token under an encoded doc id, so delete by the token field.
        db.collection("fcm_tokens").where("token", "==", tokens[i]).get()
          .then((q) => q.forEach((d) => d.ref.delete()))
          .catch(() => {});
      }
    }
  });
}

const BRANCH_NAMES = {
  shoppies: "شوبيز",
  omar_mina: "الحاج عمر — الميناء",
  omar_abrin: "الحاج عمر — عبرين"
};
const branchName = (id) => BRANCH_NAMES[id] || id || "";

/** Type 1 — someone just submitted a handover (opening / handover / closing): tell managers. */
async function checkNewHandovers() {
  const snap = await db.collection("handovers").where("notifiedAdmin", "==", false).get();
  if (snap.empty) { console.log("No new un-notified handovers."); return; }
  const managerTokens = await getTokens({ role: MANAGER_ROLES });
  console.log(`Manager devices: ${managerTokens.length}`);
  for (const doc of snap.docs) {
    const d = doc.data();
    const type = d.entryType || d.shiftType || "handover";
    const title = type === "opening" ? "🔓 فتح وردية" : type === "closing" ? "🔒 إقفال" : "🔁 تسليم وردية";
    let body = `${d.outgoingName || "مشرف"}`;
    if (type === "handover" && d.incomingName) body += ` ← ${d.incomingName}`;
    body += ` · ${branchName(d.company)}`;
    if (d.time) body += ` · ${d.time}`;
    if (d.pending && d.pending.urgent) body += "\n🚨 في شي مستعجل";
    else if (d.status === "issues") body += "\n⚠️ في مشاكل بالتسليم";
    await sendToTokens(managerTokens, title, body, { type: "handover", id: doc.id });
    await doc.ref.update({ notifiedAdmin: true });
  }
}

/** Type 1b — someone just scanned / added new products in Expiry Control: tell managers.
 * Grouped per person and branch, so scanning 20 items sends one notification, not 20.
 * Looks at items added in the last 6 hours that haven't been announced yet, so it also
 * works for phones still running an older copy of the app. */
async function checkNewExpiryItems() {
  const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const snap = await db.collection("expiry_items").where("createdAt", ">=", since).get();
  const fresh = snap.docs.filter((d) => d.data().notifiedAdmin !== true);
  if (!fresh.length) { console.log("No new expiry items."); return; }
  const managerTokens = await getTokens({ role: MANAGER_ROLES });
  console.log(`New expiry items: ${fresh.length} · Manager devices: ${managerTokens.length}`);

  const groups = {};
  fresh.forEach((doc) => {
    const d = doc.data();
    const who = (d.createdBy && (d.createdBy.fullName || d.createdBy.username)) || "موظف";
    const key = who + "|" + (d.company || "");
    (groups[key] = groups[key] || { who, company: d.company, items: [] }).items.push(d);
  });

  for (const g of Object.values(groups)) {
    const n = g.items.length;
    const title = n === 1 ? "📦 منتج جديد بالإكسبايري" : `📦 ${n} منتجات جديدة بالإكسبايري`;
    const lines = g.items.slice(0, 3).map((d) => `• ${d.productName || d.barcode} — ${d.expiryDate || ""}`);
    if (n > 3) lines.push(`• و${n - 3} غيرهن`);
    const body = `${g.who} · ${branchName(g.company)}\n${lines.join("\n")}`;
    await sendToTokens(managerTokens, title, body, { type: "expiry-new" });
  }

  const batch = db.batch();
  fresh.forEach((doc) => batch.update(doc.ref, { notifiedAdmin: true }));
  await batch.commit();
}

/** Type 1b (daily) — one end-of-day summary of who added items to Expiry Control,
 * instead of a notification for every scan (the manager found those too noisy, Oct 2026).
 * Covers everything added in the last 26 hours that hasn't been in a summary yet,
 * so a late or skipped GitHub run never loses items. */
async function sendDailyExpirySummary() {
  const since = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
  const snap = await db.collection("expiry_items").where("createdAt", ">=", since).get();
  const fresh = snap.docs.filter((d) => d.data().inDailySummary !== true);
  if (!fresh.length) { console.log("No new expiry items today — no summary sent."); return; }
  const managerTokens = await getTokens({ role: MANAGER_ROLES });
  console.log(`Expiry items for the summary: ${fresh.length} · Manager devices: ${managerTokens.length}`);

  const groups = {};
  fresh.forEach((doc) => {
    const d = doc.data();
    const who = (d.createdBy && (d.createdBy.fullName || d.createdBy.username)) || "موظف";
    const key = who + "|" + (d.company || "");
    (groups[key] = groups[key] || { who, company: d.company, n: 0 }).n += 1;
  });
  const list = Object.values(groups).sort((a, b) => b.n - a.n);
  const lines = list.slice(0, 8).map((g) => `• ${g.who} (${branchName(g.company)}): ${g.n} ${g.n === 1 ? "منتج" : "منتجات"}`);
  if (list.length > 8) lines.push(`• و${list.length - 8} غيرهن`);
  const title = `📦 ملخّص الإكسبايري اليوم: ${fresh.length} ${fresh.length === 1 ? "منتج" : "منتجات"}`;
  await sendToTokens(managerTokens, title, lines.join("\n"), { type: "expiry-summary" });

  // Firestore batches hold up to 500 writes.
  for (let i = 0; i < fresh.length; i += 450) {
    const batch = db.batch();
    fresh.slice(i, i + 450).forEach((doc) => batch.update(doc.ref, { inDailySummary: true, notifiedAdmin: true }));
    await batch.commit();
  }
}

/** Type 1c — customer feedback from the QR page: tell managers.
 * Every complaint gets its own notification (it needs action). Ratings are
 * grouped per branch, so a busy hour sends one message, not ten. A low rating
 * (1 or 2 stars) is always called out. Looks at the last 6 hours, like expiry. */
async function checkNewFeedback() {
  const since = admin.firestore.Timestamp.fromMillis(Date.now() - 6 * 3600 * 1000);
  const snap = await db.collection("feedback").where("createdAt", ">=", since).get();
  const fresh = snap.docs.filter((d) => d.data().notifiedAdmin !== true);
  if (!fresh.length) { console.log("No new feedback."); return; }
  const managerTokens = await getTokens({ role: MANAGER_ROLES });
  console.log(`New feedback: ${fresh.length} · Manager devices: ${managerTokens.length}`);

  const where = (d) => d.type === "store" ? "بالمحل" : "دليفري";
  const short = (txt, n) => { txt = String(txt || "").trim().replace(/\s+/g, " "); return txt.length > n ? txt.slice(0, n) + "…" : txt; };
  const starsOf = (n) => "★".repeat(n) + "☆".repeat(5 - n);

  const reviewsByBranch = {};
  for (const doc of fresh) {
    const d = doc.data();
    if (d.kind === "complaint") {
      let body = `${branchName(d.branch)} · ${where(d)}\n${short(d.text, 140)}`;
      if (d.wantsContact) body += `\n📞 بدّو تتواصل معو: ${[d.contactName, d.contactInfo].filter(Boolean).join(" · ")}`;
      await sendToTokens(managerTokens, "🚨 شكوى جديدة", body, { type: "feedback", id: doc.id });
    } else {
      (reviewsByBranch[d.branch] = reviewsByBranch[d.branch] || []).push(d);
    }
  }

  for (const [branch, list] of Object.entries(reviewsByBranch)) {
    const low = list.filter((d) => (d.stars || 0) <= 2);
    let title, body;
    if (list.length === 1) {
      const d = list[0];
      title = d.stars <= 2 ? "⚠️ تقييم منخفض" : "⭐ تقييم جديد";
      body = `${branchName(branch)} · ${where(d)} · ${starsOf(d.stars || 0)}`;
      if (d.text) body += `\n${short(d.text, 120)}`;
    } else {
      const avg = list.reduce((a, d) => a + (d.stars || 0), 0) / list.length;
      title = low.length ? `⚠️ ${list.length} تقييمات جديدة (${low.length} منخفضة)` : `⭐ ${list.length} تقييمات جديدة`;
      body = `${branchName(branch)} · المعدّل ${avg.toFixed(1)} من 5`;
      const withText = low.concat(list.filter((d) => d.stars > 2)).filter((d) => d.text).slice(0, 2);
      withText.forEach((d) => { body += `\n${starsOf(d.stars || 0)} ${short(d.text, 70)}`; });
    }
    await sendToTokens(managerTokens, title, body, { type: "feedback" });
  }

  const batch = db.batch();
  fresh.forEach((doc) => batch.update(doc.ref, { notifiedAdmin: true }));
  await batch.commit();
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
  const managerTokens = await getTokens({ role: MANAGER_ROLES });
  console.log(`Manager devices: ${managerTokens.length}`);
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
          `${d.productName || d.barcode} — ${daysLeft < 0 ? "منتهي" : daysLeft === 0 ? "بينتهي اليوم" : "باقي " + daysLeft + " يوم"} (${branchName(d.company) || d.branch || ""})`,
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

/** Test mode — sends one notification to every registered token, no
 * matter what's in the data. Use this to verify the whole pipeline
 * (service account auth → FCM send → device receives it) actually works,
 * separately from whether any real handover/expiry condition is true. */
async function sendTestNotification() {
  const snap = await db.collection("fcm_tokens").get();
  const tokens = [...new Set(snap.docs.map((d) => d.data().token).filter(Boolean))];
  if (!tokens.length) {
    console.log("No tokens registered in fcm_tokens at all — nothing to send to.");
    return;
  }
  console.log(`Found ${tokens.length} registered token(s). Sending test push...`);
  snap.docs.forEach((d) => {
    const x = d.data();
    console.log(`  - ${x.fullName || x.username || "?"} | role: ${x.role || "?"} | updated: ${x.updatedAt || "?"}`);
  });
  await sendToTokens(
    tokens,
    "🔔 Floor Link — Test",
    "إذا وصلك هذا الإشعار، يعني النظام شغال تمام.",
    { type: "test", sentAt: new Date().toISOString() }
  );
}

const mode = process.argv[2];
const modes = {
  // Runs every 10 minutes (notify-handover.yml): new handovers and customer feedback.
  // New expiry items are no longer announced one by one; see "expiry-summary" (once a day).
  "handover": async () => { await checkNewHandovers(); await checkNewFeedback(); },
  "expiry-summary": sendDailyExpirySummary,
  "feedback": checkNewFeedback,
  "new-items": checkNewExpiryItems,
  "supervisor-reminder": checkSupervisorReminders,
  "expiry-check": checkExpiry,
  "merchandiser-reminder": merchandiserReminder,
  "test": sendTestNotification
};

if (!modes[mode]) {
  console.error(`Unknown mode "${mode}". Expected one of: ${Object.keys(modes).join(", ")}`);
  process.exit(1);
}

console.log(`Running mode: ${mode}`);
modes[mode]()
  .then(() => { console.log("Done."); process.exit(0); })
  .catch((err) => { console.error("Failed:", err); process.exit(1); });
