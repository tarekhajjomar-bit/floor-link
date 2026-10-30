// One-off: delete Firebase Auth accounts that have no profile in users/ (accounts the manager
// deleted in the app earlier; their emails stay "already in use"). Skips accounts newer than 1 hour.
// DRY=1 only lists. Report: ../diag/orphans.txt
const fs = require("fs");
const admin = require("firebase-admin");
(async () => {
  const out = [];
  try {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    const db = admin.firestore(), DRY = process.env.DRY === "1";
    let token;
    do {
      const r = await admin.auth().listUsers(1000, token);
      for (const u of r.users) {
        if (!u.email) continue; // anonymous visitors (customer feedback page): leave alone
        if ((await db.doc("users/" + u.uid).get()).exists) continue;
        const age = Date.now() - new Date(u.metadata.creationTime).getTime();
        const line = `orphan ${u.email || "(no email)"} uid=${u.uid} created=${u.metadata.creationTime} lastSignIn=${u.metadata.lastSignInTime || "never"}`;
        if (age < 3600000) { out.push(line + " -> SKIPPED (new)"); continue; }
        if (!DRY) await admin.auth().deleteUser(u.uid);
        out.push(line + (DRY ? " -> would delete" : " -> deleted"));
      }
      token = r.pageToken;
    } while (token);
  } catch (e) { out.push("ERROR: " + (e && e.message)); }
  fs.mkdirSync("../diag", { recursive: true });
  fs.writeFileSync("../diag/orphans.txt", new Date().toISOString() + "\n" + out.join("\n") + "\n");
  console.log(out.join("\n"));
})();
