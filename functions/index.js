// Floor Link — instant voice-message push (Oct 2026).
// The GitHub cron that sends the other notifications runs only every few hours, so voice
// messages get their own Cloud Functions:
//   1) the moment a voice message is created -> push to every recipient;
//   2) every 5 minutes -> push again (every 10 min, up to 5 more times, for 24 h) to whoever
//      has not listened yet.
const admin = require("firebase-admin");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");

admin.initializeApp();
const db = admin.firestore();
const REGION = process.env.FN_REGION || "us-central1";
setGlobalOptions({ region: REGION, maxInstances: 5 });

const MAX_REMINDERS = 5, REMIND_EVERY_MS = 10 * 60 * 1000, WINDOW_MS = 24 * 3600 * 1000;

async function tokensFor(userIds) {
  const newest = {};
  for (let i = 0; i < userIds.length; i += 10) {
    const snap = await db.collection("fcm_tokens").where("userId", "in", userIds.slice(i, i + 10)).get();
    snap.docs.forEach((d) => {
      const x = d.data();
      if (!x.token) return;
      const cur = newest[x.userId];
      if (!cur || String(x.updatedAt || "") > String(cur.updatedAt || "")) newest[x.userId] = x;
    });
  }
  return Object.values(newest).map((x) => x.token);
}

async function push(userIds, title, body, id) {
  const tokens = await tokensFor(userIds);
  if (!tokens.length) return 0;
  const res = await admin.messaging().sendEachForMulticast({
    notification: { title, body },
    data: { type: "voice", id },
    tokens,
  });
  await Promise.all(res.responses.map((r, i) => {
    const c = r.error && r.error.code;
    if (c === "messaging/registration-token-not-registered" || c === "messaging/invalid-registration-token") {
      return db.collection("fcm_tokens").where("token", "==", tokens[i]).get().then((q) => Promise.all(q.docs.map((d) => d.ref.delete()))).catch(() => {});
    }
  }));
  return res.successCount;
}

exports.voiceNow = onDocumentCreated("voice_messages/{id}", async (event) => {
  const d = event.data.data();
  const ids = (d.recipientIds || []).slice(0, 200);
  const sent = await push(ids, "🎙 رسالة صوتية جديدة", `من ${(d.from && d.from.fullName) || "الإدارة"} — افتح Floor Link للسماع`, event.params.id);
  await event.data.ref.update({ notified: true, pushCount: 0, lastPushAt: Date.now(), firstPushOk: sent });
});

exports.voiceReminders = onSchedule("every 5 minutes", async () => {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const snap = await db.collection("voice_messages").where("createdAt", ">", since).get();
  for (const doc of snap.docs) {
    const d = doc.data();
    if (!d.notified || (d.pushCount || 0) >= MAX_REMINDERS) continue;
    if (Date.now() - (d.lastPushAt || 0) < REMIND_EVERY_MS) continue;
    const heard = d.listened || {};
    const waiting = (d.recipientIds || []).filter((u) => !heard[u]);
    if (!waiting.length) { await doc.ref.update({ pushCount: MAX_REMINDERS }); continue; }
    await push(waiting, "🔴 رسالة صوتية لم تسمعها بعد", `من ${(d.from && d.from.fullName) || "الإدارة"} — افتح Floor Link واسمعها`, doc.id);
    await doc.ref.update({ pushCount: (d.pushCount || 0) + 1, lastPushAt: Date.now() });
  }
});
