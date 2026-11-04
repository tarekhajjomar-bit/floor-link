// One-off: move every account's email out of users/{uid} (readable by all staff) into
// user_private/{uid} (manager only); fill any missing one from Firebase Auth. DRY=1 only reports.
const fs = require("fs");
const admin = require("firebase-admin");
(async () => {
  const out = [];
  try {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    const db = admin.firestore(), DRY = process.env.DRY === "1", FV = admin.firestore.FieldValue;
    const users = await db.collection("users").get();
    let moved = 0, filled = 0, missing = 0;
    for (const d of users.docs) {
      const x = d.data();
      let email = x.email;
      if (!email) { try { email = (await admin.auth().getUser(d.id)).email; filled++; } catch (e) { email = null; } }
      if (!email) { missing++; continue; }
      if (!DRY) {
        await db.doc("user_private/" + d.id).set({ email: String(email).toLowerCase() });
        if (x.email) await d.ref.update({ email: FV.delete() });
      }
      if (x.email) moved++;
    }
    out.push(`users: ${users.size}, emails moved: ${moved}, filled from Auth: ${filled}, no email anywhere: ${missing}${DRY ? " (dry run)" : ""}`);
    const left = (await db.collection("users").get()).docs.filter((d) => d.data().email).length;
    out.push("users docs still holding an email field: " + left);
  } catch (e) { out.push("ERROR: " + (e && e.message)); }
  fs.mkdirSync("../diag", { recursive: true });
  fs.writeFileSync("../diag/moveemails.txt", out.join("\n") + "\n");
  console.log(out.join("\n"));
})();
