// Publishes firestore.rules to Firestore (same as pasting it in the Console and
// pressing Publish), then reads the live ruleset back and compares it.
const fs = require("fs");
const admin = require("firebase-admin");
(async () => {
  const out = [];
  try {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    const src = fs.readFileSync("../firestore.rules", "utf8");
    const sr = admin.securityRules();
    await sr.releaseFirestoreRulesetFromSource(src);
    const live = await sr.getFirestoreRuleset();
    const liveSrc = (live.source && live.source[0] && live.source[0].content) || "";
    out.push("released: " + live.name);
    out.push("live matches repo file: " + (liveSrc.trim() === src.trim()));
    out.push("has counterCheck: " + liveSrc.includes("counterCheck"));
  } catch (e) {
    out.push("ERROR: " + (e && e.message));
  }
  fs.mkdirSync("../diag", { recursive: true });
  fs.writeFileSync("../diag/rules.txt", new Date().toISOString() + "\n" + out.join("\n") + "\n");
  console.log(out.join("\n"));
})();
