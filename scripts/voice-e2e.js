// Test: create an empty-recipient voice message, check the Cloud Function marked it notified, delete it.
const fs = require("fs"), admin = require("firebase-admin");
(async () => {
  const out = [];
  try {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    const db = admin.firestore();
    const ref = await db.collection("voice_messages").add({ from: { userId: "test", fullName: "TEST" }, recipientIds: [], url: "", listened: {}, notified: false, createdAt: new Date().toISOString() });
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const d = (await ref.get()).data();
      if (d.notified) { out.push("OK: voiceNow ran after ~" + (i + 1) * 5 + "s: " + JSON.stringify({ notified: d.notified, pushCount: d.pushCount, lastPushAt: d.lastPushAt })); break; }
      if (i === 11) out.push("FAIL: not notified after 60s");
    }
    await ref.delete();
  } catch (e) { out.push("ERROR: " + (e && e.message)); }
  fs.mkdirSync("../diag", { recursive: true });
  fs.writeFileSync("../diag/voice-e2e.txt", out.join("\n") + "\n");
  console.log(out.join("\n"));
})();
