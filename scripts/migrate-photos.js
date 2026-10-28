// One-off: copy every photo still available on ImgBB into Firebase Storage and
// point the records at the copy. Photos ImgBB already replaced with its
// "service unavailable" image (HTTP 503) can't be recovered and are left as is.
// Env: DRY=1 only counts. Report goes to ../diag/migrate.txt.
const fs = require("fs");
const crypto = require("crypto");
const admin = require("firebase-admin");
const BUCKET = "floor-link.firebasestorage.app";
const IBB = /^https?:\/\/i\.ibb\.co\//;
const DRY = process.env.DRY === "1";
const cache = new Map();           // old url -> new url | null (unavailable)
const stats = { docs: 0, docsChanged: 0, migrated: 0, unavailable: 0, errors: 0 };
let bucket;

function collectUrls(v, set) {
  if (typeof v === "string") { if (IBB.test(v)) set.add(v); }
  else if (Array.isArray(v)) v.forEach((x) => collectUrls(x, set));
  else if (v && typeof v === "object" && !(v.toDate || v._seconds !== undefined || v.path)) Object.values(v).forEach((x) => collectUrls(x, set));
}
function replaceUrls(v) {
  if (typeof v === "string") return IBB.test(v) && cache.get(v) ? cache.get(v) : v;
  if (Array.isArray(v)) return v.map(replaceUrls);
  if (v && typeof v === "object" && !(v.toDate || v._seconds !== undefined || v.path)) {
    const o = {}; for (const k of Object.keys(v)) o[k] = replaceUrls(v[k]); return o;
  }
  return v;
}
async function migrateOne(url) {
  if (cache.has(url)) return;
  try {
    const r = await fetch(url);
    const ct = r.headers.get("content-type") || "";
    if (r.status !== 200 || !ct.startsWith("image/")) { cache.set(url, null); stats.unavailable++; return; }
    if (DRY) { cache.set(url, null); stats.migrated++; return; }
    const buf = Buffer.from(await r.arrayBuffer());
    const name = "migrated/" + crypto.createHash("sha1").update(url).digest("hex") + (ct.includes("png") ? ".png" : ".jpg");
    const token = crypto.randomUUID();
    await bucket.file(name).save(buf, { contentType: ct, metadata: { metadata: { firebaseStorageDownloadTokens: token } } });
    cache.set(url, `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(name)}?alt=media&token=${token}`);
    stats.migrated++;
  } catch (e) { stats.errors++; cache.set(url, null); }
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); } }));
}
(async () => {
  const out = [];
  try {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)), storageBucket: BUCKET });
    bucket = admin.storage().bucket();
    const db = admin.firestore();
    const cols = await db.listCollections();
    for (const col of cols) {
      if (["fcm_tokens"].includes(col.id)) continue;
      const snap = await col.get();
      const work = [];
      for (const d of snap.docs) {
        stats.docs++;
        const data = d.data();
        const urls = new Set();
        Object.values(data).forEach((v) => collectUrls(v, urls));
        if (urls.size) work.push({ ref: d.ref, data, urls: [...urls] });
      }
      const all = [...new Set(work.flatMap((w) => w.urls))];
      await pool(all, 8, migrateOne);
      for (const w of work) {
        const upd = {};
        for (const k of Object.keys(w.data)) {
          const nv = replaceUrls(w.data[k]);
          if (JSON.stringify(nv) !== JSON.stringify(w.data[k])) upd[k] = nv;
        }
        if (Object.keys(upd).length) { stats.docsChanged++; if (!DRY) await w.ref.update(upd); }
      }
      out.push(`${col.id}: ${snap.size} docs, ${work.length} with ImgBB photos`);
    }
    out.push("stats: " + JSON.stringify(stats));
  } catch (e) { out.push("ERROR: " + (e && e.message)); out.push("stats so far: " + JSON.stringify(stats)); }
  fs.mkdirSync("../diag", { recursive: true });
  fs.writeFileSync("../diag/migrate.txt", new Date().toISOString() + (DRY ? " (dry run)" : "") + "\n" + out.join("\n") + "\n");
  console.log(out.join("\n"));
})();
