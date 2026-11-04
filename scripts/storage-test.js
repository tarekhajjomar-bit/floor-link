// Test: who can upload to Storage with the new rules (approved staff yes; unknown / pending / anonymous no).
const fs = require("fs"), admin = require("firebase-admin");
const { initializeApp } = require("firebase/app");
const { getAuth, signInWithCustomToken, signInAnonymously } = require("firebase/auth");
const { getStorage, ref, uploadBytes, getDownloadURL } = require("firebase/storage");
(async () => {
  const out = [];
  const html = fs.readFileSync("../index.html", "utf8");
  const pick = (k) => (html.match(new RegExp(k + ':\\s*"([^"]+)"')) || [])[1];
  const cfg = { apiKey: pick("apiKey"), projectId: pick("projectId"), storageBucket: pick("storageBucket"), appId: pick("appId"), authDomain: pick("authDomain") };
  try {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)), storageBucket: cfg.storageBucket });
    const db = admin.firestore(), bucket = admin.storage().bucket();
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const uploaded = [];
    async function attempt(label, signIn, expectOk) {
      const app = initializeApp(cfg, label + Date.now());
      const auth = getAuth(app);
      try {
        await signIn(auth);
        const path = "photos/sectest_" + label + "_" + Date.now() + ".png";
        const r = ref(getStorage(app), path);
        await uploadBytes(r, png, { contentType: "image/png" });
        uploaded.push(path);
        await getDownloadURL(r);
        out.push((expectOk ? "OK  " : "FAIL") + " " + label + ": upload allowed" + (expectOk ? "" : "  <-- should have been refused"));
      } catch (e) {
        out.push((expectOk ? "FAIL" : "OK  ") + " " + label + ": refused (" + (e.code || e.message) + ")" + (expectOk ? "  <-- should have worked" : ""));
      }
    }
    const users = await db.collection("users").get();
    const staff = users.docs.find((d) => ["supervisor", "merchandiser"].includes(d.data().role) && d.data().approved !== false);
    await attempt("approved-staff", async (a) => signInWithCustomToken(a, await admin.auth().createCustomToken(staff.id)), true);
    await attempt("unknown-uid", async (a) => signInWithCustomToken(a, await admin.auth().createCustomToken("sectest-nodoc")), false);
    await db.doc("users/sectest-pending").set({ fullName: "SecTest", role: "merchandiser", approved: false });
    await attempt("pending-account", async (a) => signInWithCustomToken(a, await admin.auth().createCustomToken("sectest-pending")), false);
    await db.doc("users/sectest-pending").delete();
    await attempt("anonymous", (a) => signInAnonymously(a), false);
    for (const p of uploaded) await bucket.file(p).delete({ ignoreNotFound: true }).catch(() => {});
  } catch (e) { out.push("ERROR: " + (e && e.message)); }
  fs.mkdirSync("../diag", { recursive: true });
  fs.writeFileSync("../diag/storagetest.txt", out.join("\n") + "\n");
  console.log(out.join("\n"));
  process.exit(0);
})();
