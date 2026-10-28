// Signs in like an app user (custom token) and uploads a tiny image with the
// client SDK, to see exactly what the Storage rules / bucket answer.
const fs = require("fs");
const admin = require("firebase-admin");
(async () => {
  const out = [];
  try {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    const users = await admin.firestore().collection("users").where("role", "==", "supervisor").limit(1).get();
    const uid = users.docs[0].id;
    out.push("using supervisor uid " + uid.slice(0, 6) + "…");
    const token = await admin.auth().createCustomToken(uid);
    const { initializeApp } = require("firebase/app");
    const { getAuth, signInWithCustomToken } = require("firebase/auth");
    const { getStorage, ref, uploadBytes, getDownloadURL } = require("firebase/storage");
    const app = initializeApp({ apiKey: "AIzaSyD_lwucPFiMylSs3G0lTYbbn_wcNwwhKg8", authDomain: "floor-link.firebaseapp.com", projectId: "floor-link", storageBucket: "floor-link.firebasestorage.app", appId: "1:1002443478349:web:9b103544895158c3775304" });
    await signInWithCustomToken(getAuth(app), token);
    out.push("signed in");
    const px = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const st = getStorage(app);
    for (const p of ["photos/diag/test.jpg", "catalog/diag/test.jpg"]) {
      try {
        const r = ref(st, p);
        const snap = await uploadBytes(r, px, { contentType: "image/jpeg" });
        const url = await getDownloadURL(snap.ref);
        const g = await fetch(url);
        out.push(p + " OK; download " + g.status + " " + g.headers.get("content-type"));
      } catch (e) { out.push(p + " FAIL: " + (e.code || "") + " " + (e.message || "").slice(0, 300) + " " + JSON.stringify(e.customData || {}).slice(0, 300)); }
    }
  } catch (e) { out.push("ERROR: " + (e && e.message)); }
  fs.mkdirSync("../diag", { recursive: true });
  fs.writeFileSync("../diag/storage-upload.txt", new Date().toISOString() + "\n" + out.join("\n") + "\n");
  console.log(out.join("\n"));
  process.exit(0);
})();
