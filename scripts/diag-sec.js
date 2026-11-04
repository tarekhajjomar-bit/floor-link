// Read-only: who writes delivery_shifts, roles distribution, old username accounts (for the security review).
const fs = require("fs"), admin = require("firebase-admin");
(async () => {
  const out = [];
  try {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    const db = admin.firestore();
    const ds = await db.collection("delivery_shifts").orderBy("month", "desc").limit(5).get();
    ds.docs.forEach((d) => { const x = d.data(); out.push("delivery_shifts " + d.id.slice(0, 12) + " keys=" + Object.keys(x).join(",") + " by=" + JSON.stringify(x.createdBy || x.by || x.user || x.driver || null).slice(0, 80)); });
    const us = await db.collection("users").get();
    const roles = {}, legacy = []; let noEmail = 0;
    us.docs.forEach((d) => { const x = d.data(); roles[x.role] = (roles[x.role] || 0) + 1; if (x.username && !x.migratedToUid) legacy.push(x.role); if (!x.email) noEmail++; });
    out.push("users: " + us.size + " roles=" + JSON.stringify(roles) + " legacy(non-migrated username docs)=" + legacy.length + " withoutEmailField=" + noEmail);
    const dl = us.docs.filter((d) => d.data().role === "delivery").length;
    out.push("delivery-role accounts: " + dl);
    const s = await db.collection("settings").get(); out.push("settings docs: " + s.docs.map((d) => d.id).join(","));
  } catch (e) { out.push("ERROR: " + (e && e.message)); }
  fs.mkdirSync("../diag", { recursive: true });
  fs.writeFileSync("../diag/sec.txt", out.join("\n") + "\n");
  console.log(out.join("\n"));
})();
