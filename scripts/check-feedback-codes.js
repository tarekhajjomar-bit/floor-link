// Lists the customer-feedback QR codes (id, branch, type, place, active) and
// how many replies each has. Read-only. Run from Actions → "Check — feedback codes".
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
(async () => {
  const codes = await db.collection("feedback_codes").get();
  const fb = await db.collection("feedback").get();
  const n = {};
  fb.docs.forEach((d) => { const c = d.data().codeId; n[c] = (n[c] || 0) + 1; });
  console.log(`Codes: ${codes.size} · Replies: ${fb.size}`);
  codes.docs.forEach((d) => {
    const x = d.data();
    const line = `${d.id} | branch=${x.branch} | type=${x.type} | place=${x.place} | active=${JSON.stringify(x.active)} (${typeof x.active}) | replies=${n[d.id] || 0} | created=${x.createdAt}`;
    console.log(line); console.log("::notice::" + line);
  });
  process.exit(0);
})().catch((e) => { console.error(e); console.log("::error::" + e.message); process.exit(1); });
