// Read-only: inspect recent voice messages and analyse their audio (size, codec, loudness).
const fs = require("fs"), cp = require("child_process"), admin = require("firebase-admin");
(async () => {
  const out = [];
  try {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(sa), storageBucket: sa.project_id + ".firebasestorage.app" });
    const snap = await admin.firestore().collection("voice_messages").orderBy("createdAt", "desc").limit(8).get();
    const bucket = admin.storage().bucket();
    fs.mkdirSync("/tmp/v", { recursive: true });
    for (const d of snap.docs) {
      const m = d.data();
      out.push(`--- ${d.id} to=${m.audienceLabel} at=${m.createdAt} dur=${m.durationSec}s mime=${m.mime} recips=${(m.recipientIds || []).length}`);
      out.push(`notified=${m.notified} listened=${JSON.stringify(m.listened || {})}`);
      for (const rid of (m.recipientIds || []).slice(0, 10)) {
        const tk = await admin.firestore().collection("fcm_tokens").where("userId", "==", rid).get();
        out.push(`  recipient ${rid}: ${tk.size} token(s) ` + tk.docs.map((x) => (x.data().platform || "?") + "@" + (x.data().updatedAt || "?")).join(", "));
      }
      const path = decodeURIComponent((m.url.split("/o/")[1] || "").split("?")[0]);
      const [md] = await bucket.file(path).getMetadata().catch((e) => [{ err: e.message }]);
      out.push(`file ${path} size=${md.size} type=${md.contentType} ${md.err || ""}`);
      if (md.err) continue;
      const local = "/tmp/v/" + d.id + "." + path.split(".").pop();
      await bucket.file(path).download({ destination: local });
      try { out.push(cp.execSync(`ffprobe -v error -show_entries stream=codec_name,sample_rate,channels:format=duration,size -of default=nw=1 ${local} 2>&1`).toString().trim().replace(/\n/g, " | ")); } catch (e) { out.push("ffprobe: " + e.message.slice(0, 200)); }
      try { out.push("volume: " + cp.execSync(`ffmpeg -hide_banner -i ${local} -af volumedetect -f null - 2>&1 | grep -E "mean_volume|max_volume|Duration"`).toString().trim().replace(/\n/g, " | ")); } catch (e) { out.push("volumedetect failed: " + e.message.slice(0, 200)); }
    }
  } catch (e) { out.push("ERROR: " + (e && e.message)); }
  fs.mkdirSync("../diag", { recursive: true });
  fs.writeFileSync("../diag/voice.txt", new Date().toISOString() + "\n" + out.join("\n") + "\n");
  console.log(out.join("\n"));
})();
