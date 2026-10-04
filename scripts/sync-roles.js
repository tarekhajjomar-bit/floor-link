// Floor Link — role → Custom Claim sync.
//
// Runs on a GitHub Actions schedule (no Cloud Functions needed). For every
// account in /users, it makes sure that account's Firebase Auth custom
// claim "role" matches the "role" field already in Firestore, and that
// Auth's disabled flag matches Firestore's "disabled" field too — so a
// manager disabling someone in the Accounts screen also locks them out of
// Auth itself, not just the app's UI.
//
// A role or disabled change takes effect the next time this runs — a few
// minutes' delay, same tradeoff as the notification workflows.

const admin = require("firebase-admin");

function init() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.error("Missing FIREBASE_SERVICE_ACCOUNT environment variable.");
    process.exit(1);
  }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
}

init();
const db = admin.firestore();
const auth = admin.auth();

async function main() {
  const snap = await db.collection("users").get();
  console.log(`Checking ${snap.size} account(s)...`);

  let updated = 0, skipped = 0, errored = 0;

  for (const doc of snap.docs) {
    const uid = doc.id;
    const data = doc.data();
    const wantRole = data.role || "supervisor";
    const wantDisabled = !!data.disabled;

    let authUser;
    try {
      authUser = await auth.getUser(uid);
    } catch (e) {
      // No matching Auth account yet — this user hasn't migrated to
      // Firebase Auth (or the doc ID isn't a real Auth uid). Skip; nothing
      // to sync until they sign up through the new Auth-based flow.
      skipped++;
      continue;
    }

    const haveRole = (authUser.customClaims || {}).role;
    const haveDisabled = authUser.disabled;

    if (haveRole === wantRole && haveDisabled === wantDisabled) {
      continue; // already in sync
    }

    try {
      if (haveRole !== wantRole) {
        await auth.setCustomUserClaims(uid, { role: wantRole });
        console.log(`  role: ${uid} → ${wantRole}`);
      }
      if (haveDisabled !== wantDisabled) {
        await auth.updateUser(uid, { disabled: wantDisabled });
        console.log(`  disabled: ${uid} → ${wantDisabled}`);
      }
      updated++;
    } catch (e) {
      console.error(`  FAILED for ${uid}:`, e.message);
      errored++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, unchanged/no-auth-yet: ${skipped}, errors: ${errored}.`);
  process.exit(errored ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
