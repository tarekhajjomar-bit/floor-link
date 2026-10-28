// Checks the Firebase Storage bucket; if it exists, publishes storage.rules and
// sets the 30-day auto-delete rule on photos/. Reports to ../diag/storage.txt.
const fs = require("fs");
const admin = require("firebase-admin");
(async () => {
  const out = [];
  try {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(sa), storageBucket: "floor-link.firebasestorage.app" });
    const bucket = admin.storage().bucket();
    let exists = false;
    try { [exists] = await bucket.exists(); } catch (e) { out.push("exists() error: " + e.message); }
    out.push("bucket " + bucket.name + " exists: " + exists);
    if (!exists && process.env.TRY_CREATE === "1") {
      try { await bucket.create({ location: "EUROPE-WEST1" }); out.push("created bucket"); exists = true; }
      catch (e) { out.push("create error: " + e.message); }
    }
    if (exists) {
      const rules = fs.readFileSync("../storage.rules", "utf8");
      try {
        await admin.securityRules().releaseStorageRulesetFromSource(rules, bucket.name);
        out.push("storage rules released");
      } catch (e) { out.push("rules error: " + e.message); }
      try {
        const [md0] = await bucket.getMetadata();
        const has = ((md0.lifecycle && md0.lifecycle.rule) || []).some((x) => x.condition && x.condition.age === 30 && (x.condition.matchesPrefix || []).includes("photos/"));
        if (!has) await bucket.addLifecycleRule({ action: { type: "Delete" }, condition: { age: 30, matchesPrefix: ["photos/"] } });
        out.push("lifecycle rule added");
      } catch (e) { out.push("lifecycle error: " + e.message); }
      try { const [md] = await bucket.getMetadata(); out.push("lifecycle now: " + JSON.stringify(md.lifecycle || null)); } catch (e) { out.push("metadata error: " + e.message); }
    }
  } catch (e) { out.push("ERROR: " + (e && e.message)); }
  fs.mkdirSync("../diag", { recursive: true });
  fs.writeFileSync("../diag/storage.txt", new Date().toISOString() + "\n" + out.join("\n") + "\n");
  console.log(out.join("\n"));
})();
