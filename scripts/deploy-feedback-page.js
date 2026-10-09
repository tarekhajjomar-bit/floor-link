// Puts the customer feedback page (websites/feedback/feedback.html) on a
// brand's public website, without touching anything else on that site.
//
// It copies the website's CURRENT live version on Firebase Hosting, adds or
// replaces just /feedback.html in that copy, and releases it. So the rest of
// the site stays exactly as it is now, and nobody needs the site's source
// files or a computer with the Firebase CLI.
//
// Usage: node deploy-feedback-page.js <hosting-site-id> [<hosting-site-id> ...]
//   e.g. node deploy-feedback-page.js shoppies-web
//
// Needs FIREBASE_SERVICE_ACCOUNT (the same secret the notifications use).
// That service account must have the "Firebase Hosting Admin" role on the
// website's Firebase project (Google Cloud Console → IAM → Grant access).

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const admin = require("firebase-admin");

const API = "https://firebasehosting.googleapis.com/v1beta1";
const PAGE = path.join(__dirname, "..", "websites", "feedback", "feedback.html");

let sa;
try { sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || ""); }
catch (e) { console.error("FIREBASE_SERVICE_ACCOUNT is missing or not valid JSON."); process.exit(1); }
const cred = admin.credential.cert(sa);

async function token() { return (await cred.getAccessToken()).access_token; }

async function call(method, url, body, raw) {
  const res = await fetch(url, {
    method,
    headers: Object.assign({ Authorization: "Bearer " + (await token()) },
      raw ? { "Content-Type": "application/octet-stream" } : body ? { "Content-Type": "application/json" } : {}),
    body: raw ? raw : body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 400)}`);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

async function waitFor(op) {
  for (let i = 0; i < 60 && !op.done; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    op = await call("GET", `${API}/${op.name}`);
  }
  if (!op.done) throw new Error("Timed out waiting for the copy of the live site.");
  if (op.error) throw new Error("Copying the live site failed: " + JSON.stringify(op.error));
  return op.response;
}

async function deploy(site) {
  console.log(`\n=== ${site} ===`);
  const releases = await call("GET", `${API}/sites/${site}/releases?pageSize=1`);
  const live = releases.releases && releases.releases[0] && releases.releases[0].version;
  if (!live) throw new Error(`No live release found for site "${site}".`);
  console.log("Live version:", live.name);

  // 1. copy the live version (all its files and settings), not finalized yet
  const op = await call("POST", `${API}/sites/${site}/versions:clone`, { sourceVersion: live.name, finalize: false });
  const version = await waitFor(op);
  console.log("Copied into:", version.name);

  // 2. add /feedback.html to the copy
  const gz = zlib.gzipSync(fs.readFileSync(PAGE), { level: 9 });
  const hash = crypto.createHash("sha256").update(gz).digest("hex");
  const pop = await call("POST", `${API}/${version.name}:populateFiles`, { files: { "/feedback.html": hash } });
  if ((pop.uploadRequiredHashes || []).includes(hash)) {
    await call("POST", `${pop.uploadUrl}/${hash}`, null, gz);
    console.log("Uploaded feedback.html");
  } else {
    console.log("feedback.html already on Firebase (same content)");
  }

  // 3. finalize and release
  await call("PATCH", `${API}/${version.name}?update_mask=status`, { status: "FINALIZED" });
  const rel = await call("POST", `${API}/sites/${site}/releases?versionName=${encodeURIComponent(version.name)}`,
    { message: "Customer feedback page (from GitHub)" });
  console.log("Released:", rel.name);
}

(async () => {
  const sites = process.argv.slice(2);
  if (!sites.length) { console.error("Give at least one hosting site id, e.g. shoppies-web"); process.exit(1); }
  console.log("Service account:", sa.client_email);
  for (const site of sites) {
    try { await deploy(site); }
    catch (e) {
      console.error(e.message);
      // also as a GitHub annotation, so the reason shows on the run's summary page
      console.log("::error::" + (e.status === 403 ? `No permission on ${site}. Give ${sa.client_email} the role Firebase Hosting Admin.` : e.message).replace(/\n/g, " "));
      if (e.status === 403) {
        console.error(`\nPermission missing. In Google Cloud Console, open the project that owns "${site}",` +
          ` go to IAM → Grant access, add ${sa.client_email} with the role "Firebase Hosting Admin", then run this again.`);
      }
      process.exit(1);
    }
  }
  console.log("::notice::Feedback page released on: " + sites.join(", "));
  console.log("\nDone.");
})();
