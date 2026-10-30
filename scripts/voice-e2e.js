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
    try {
      const { GoogleAuth } = require("google-auth-library");
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      const c = await new GoogleAuth({ credentials: sa, scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();
      const r = await c.request({ method: "POST", url: "https://logging.googleapis.com/v2/entries:list", data: {
        resourceNames: ["projects/" + sa.project_id], orderBy: "timestamp desc", pageSize: 15,
        filter: 'resource.type="cloud_run_revision" AND resource.labels.service_name=("voicenow" OR "voicereminders") AND timestamp>="' + new Date(Date.now() - 15 * 60000).toISOString() + '"' } });
      (r.data.entries || []).forEach((e) => out.push("LOG " + e.timestamp + " " + e.resource.labels.service_name + " " + (e.textPayload || JSON.stringify(e.jsonPayload || e.httpRequest || {})).slice(0, 300)));
      if (!(r.data.entries || []).length) out.push("LOG: no entries");
    } catch (e) { out.push("log read error: " + e.message.slice(0, 200)); }
  } catch (e) { out.push("ERROR: " + (e && e.message)); }
  fs.mkdirSync("../diag", { recursive: true });
  fs.writeFileSync("../diag/voice-e2e.txt", out.join("\n") + "\n");
  console.log(out.join("\n"));
})();
