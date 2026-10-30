// One-off: copy each Firebase Auth account's email into its users/{uid} document (if missing).
// Env DRY=1 only reports. Report: ../diag/emails.txt
const fs = require("fs");
const admin = require("firebase-admin");
(async () => {
  const out = [];
  try {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    const db = admin.firestore(), DRY = process.env.DRY === "1";
    let token, n = 0, set = 0, noDoc = 0, noEmail = 0;
    do {
      const r = await admin.auth().listUsers(1000, token);
      for (const u of r.users) {
        n++;
        if (!u.email) { noEmail++; continue; }
        const ref = db.doc("users/" + u.uid), snap = await ref.get();
        if (!snap.exists) { noDoc++; continue; }
        if (!snap.data().email) { if (!DRY) await ref.update({ email: u.email.toLowerCase() }); set++; }
      }
      token = r.pageToken;
    } while (token);
    out.push(`auth accounts: ${n}, emails ${DRY ? "to write" : "written"}: ${set}, no profile doc: ${noDoc}, no email: ${noEmail}`);
  } catch (e) { out.push("ERROR: " + (e && e.message)); }
  fs.mkdirSync("../diag", { recursive: true });
  fs.writeFileSync("../diag/emails.txt", new Date().toISOString() + "\n" + out.join("\n") + "\n");
  console.log(out.join("\n"));
})();
