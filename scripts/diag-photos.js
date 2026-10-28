// Read-only check: fetch recent photo URLs and an upload test, report status/size.
const fs = require("fs");
const admin = require("firebase-admin");
const urls = [];
function walk(v) {
  if (typeof v === "string") { if (/^https?:\/\/i\.ibb\.co\//.test(v)) urls.push(v); }
  else if (Array.isArray(v)) v.forEach(walk);
  else if (v && typeof v === "object") Object.values(v).forEach(walk);
}
(async () => {
  const out = [];
  try {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    const db = admin.firestore();
    const snap = await db.collection("handovers").orderBy("createdAt", "desc").limit(60).get();
    snap.docs.forEach((d) => walk(d.data()));
    const uniq = [...new Set(urls)];
    out.push("photo urls found: " + uniq.length);
    const stat = {};
    const sample = [];
    for (const u of uniq.slice(0, 120)) {
      try {
        const r = await fetch(u, { redirect: "follow" });
        const b = Buffer.from(await r.arrayBuffer());
        const key = r.status + " " + (r.headers.get("content-type") || "") + " size~" + Math.round(b.length / 1000) + "k";
        stat[r.status] = (stat[r.status] || 0) + 1;
        if (sample.length < 12) sample.push(u + " -> " + key);
      } catch (e) { stat.err = (stat.err || 0) + 1; if (sample.length < 12) sample.push(u + " -> " + e.message); }
    }
    out.push("status counts: " + JSON.stringify(stat));
    out.push(...sample);
    const px = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    for (const K of ["65f47cfbdd68220add021626940dd010", "65889477016756c13a167bb8606690cd"]) {
      const fd = new FormData(); fd.append("image", px);
      const r = await fetch("https://api.imgbb.com/1/upload?expiration=60&key=" + K, { method: "POST", body: fd });
      out.push("upload test key " + K.slice(0, 6) + ": " + r.status + " " + (await r.text()).slice(0, 160));
    }
  } catch (e) { out.push("ERROR: " + (e && e.message)); }
  fs.mkdirSync("../diag", { recursive: true });
  fs.writeFileSync("../diag/photos.txt", new Date().toISOString() + "\n" + out.join("\n") + "\n");
  console.log(out.join("\n"));
})();
