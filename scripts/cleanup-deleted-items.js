// One-off: really delete expiry items that were only hidden (status "deleted").
// Env DRY=1 only counts. Report: ../diag/cleanup.txt
const fs = require("fs");
const admin = require("firebase-admin");
(async () => {
  const out = [];
  try {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    const db = admin.firestore();
    const DRY = process.env.DRY === "1";
    const all = await db.collection("expiry_items").get();
    const byStatus = {};
    const del = [];
    all.docs.forEach((d) => { const s = d.data().status || "(none)"; byStatus[s] = (byStatus[s] || 0) + 1; if (s === "deleted") del.push(d.ref); });
    out.push("expiry_items total " + all.size + " by status: " + JSON.stringify(byStatus));
    if (!DRY) {
      for (let i = 0; i < del.length; i += 400) {
        const b = db.batch(); del.slice(i, i + 400).forEach((r) => b.delete(r)); await b.commit();
      }
    }
    out.push((DRY ? "would delete " : "deleted ") + del.length + " hidden items");
  } catch (e) { out.push("ERROR: " + (e && e.message)); }
  fs.mkdirSync("../diag", { recursive: true });
  fs.writeFileSync("../diag/cleanup.txt", new Date().toISOString() + "\n" + out.join("\n") + "\n");
  console.log(out.join("\n"));
})();
