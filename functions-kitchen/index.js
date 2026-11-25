// Kitchen OS — phone notifications (Nov 2026).
// Own codebase ("kitchen") so deploying it never touches Floor Link's functions, and the other way round.
// Pushes go to kitchen members (kitchen_members/{uid}.role) who have a Floor Link push token (fcm_tokens).
// Notifications only tell people; they never change any kitchen data.
const admin = require("firebase-admin");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
setGlobalOptions({ region: "europe-west1", maxInstances: 3 });
const TZ = "Asia/Beirut";
const URL = "https://shoppies-kitchen.web.app/";
const BOSSES = ["owner", "manager"];

async function memberIds(roles) {
  const q = await db.collection("kitchen_members").get();
  return q.docs.filter((d) => roles.includes(d.data().role) && d.data().active !== false).map((d) => d.id);
}
async function tokensFor(userIds) {
  const newest = {};
  for (let i = 0; i < userIds.length; i += 10) {
    const snap = await db.collection("fcm_tokens").where("userId", "in", userIds.slice(i, i + 10)).get();
    snap.docs.forEach((d) => { const x = d.data(); if (!x.token) return; const cur = newest[x.userId]; if (!cur || String(x.updatedAt || "") > String(cur.updatedAt || "")) newest[x.userId] = x; });
  }
  return Object.values(newest).map((x) => x.token);
}
async function push(roles, title, body, tag) {
  const ids = await memberIds(roles); if (!ids.length) return 0;
  const tokens = await tokensFor(ids); if (!tokens.length) return 0;
  const res = await admin.messaging().sendEachForMulticast({ notification: { title, body }, data: { type: "kitchen", tag: tag || "", url: URL }, webpush: { fcmOptions: { link: URL } }, tokens });
  return res.successCount;
}
const ACTIONS = { a_moved: "نقل الأكل لمحل تاني", a_door: "سكّر الباب / صلّح", a_told: "خبّر المسؤول", a_discard: "رمى الأكل المتأثر", a_recheck: "رح يعيد القياس" };

exports.kitchenTempAlert = onDocumentCreated("kitchen_temps/{id}", async (e) => {
  const d = e.data.data(); if (!["high", "low"].includes(d.status)) return;
  await push(BOSSES, "🌡️ حرارة برّا الحدود", `${d.name || ""}: ${d.temp}° — ${ACTIONS[d.action] || ""}${d.note ? " — " + d.note : ""} (${d.byName || ""})`, "temp");
});
exports.kitchenFault = onDocumentCreated("kitchen_issues/{id}", async (e) => {
  const d = e.data.data(); if (d.kind !== "fault") return;
  await push(BOSSES, "🔧 عطل بالمطبخ", `${d.equipmentName || ""}: ${d.text || ""} (${d.reportedByName || ""})`, "fault");
});
exports.kitchenDelivery = onDocumentCreated("kitchen_deliveries/{id}", async (e) => {
  const d = e.data.data();
  await push(["chef", "manager"], "🚚 شحنة بانتظار الفحص", `${d.supplierName || ""}: ${(d.lines || []).map((l) => l.name).join("، ")}`, "delivery");
});
exports.kitchenShortage = onDocumentCreated("kitchen_production/{id}", async (e) => {
  const d = e.data.data(); if (!d.hasShort) return;
  const s = (d.consumed || []).filter((c) => c.short > 0).map((c) => c.name).join("، ");
  await push(BOSSES, "⚠️ إنتاج سحب أكتر من المخزون", `${d.name || ""}: ${s}`, "short");
});
exports.kitchenCount = onDocumentCreated("kitchen_counts/{id}", async (e) => {
  const d = e.data.data();
  await push(BOSSES, "📋 جرد بانتظار قرارك", `${d.createdByName || ""} — ${(d.lines || []).length} صنف`, "count");
});
exports.kitchenRequest = onDocumentCreated("kitchen_requests/{id}", async (e) => {
  const d = e.data.data();
  await push(BOSSES, "🛒 طلب شراء جديد", `${d.createdByName || ""}: ${(d.lines || []).map((l) => l.name).join("، ")}`, "request");
});
exports.kitchenProposal = onDocumentWritten("kitchen_recipes/{rid}/versions/{n}", async (e) => {
  const before = e.data.before.exists ? e.data.before.data() : null, after = e.data.after.exists ? e.data.after.data() : null;
  if (!after || after.status !== "proposed" || (before && before.status === "proposed")) return;
  const r = await db.doc("kitchen_recipes/" + e.params.rid).get();
  await push(["owner"], "📖 وصفة بانتظار اعتمادك", `${(r.exists && r.data().name_ar) || ""} — نسخة ${e.params.n}`, "proposal");
});

function dayStr(ms) { const d = new Date(new Date(ms).toLocaleString("en-US", { timeZone: TZ })); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
// Every morning: expired / expiring stock, hygiene tasks missed yesterday, equipment service overdue.
exports.kitchenMorning = onSchedule({ schedule: "30 7 * * *", timeZone: TZ, timeoutSeconds: 120 }, async () => {
  const now = Date.now(), today = dayStr(now), soon = dayStr(now + 2 * 864e5), yest = dayStr(now - 864e5);
  const parts = [];
  const bs = await db.collection("kitchen_batches").where("remaining", ">", 0).get();
  const exp = bs.docs.map((d) => d.data()).filter((b) => b.status === "available" && b.expiry && b.expiry <= soon);
  const expired = exp.filter((b) => b.expiry < today).length;
  if (exp.length) parts.push(`${exp.length} دفعات منتهية أو قريبة تنتهي${expired ? ` (${expired} منتهية)` : ""}`);
  const held = bs.docs.filter((d) => d.data().status === "hold").length; if (held) parts.push(`${held} دفعات محجوزة`);
  const set = await db.doc("kitchen_settings/main").get();
  const tasks = ((set.exists && set.data().safetyTasks) || []).filter((x) => x.freq !== "weekly" && x.active !== false);
  if (tasks.length) {
    const ch = await db.collection("kitchen_checks").where("date", "==", yest).get();
    const done = new Set(ch.docs.map((d) => d.data().taskId));
    const missed = tasks.filter((x) => !done.has(x.id)).length; if (missed) parts.push(`${missed} مهمات نظافة ما انعملت مبارح`);
  }
  const eq = await db.collection("kitchen_equipment").get();
  const late = eq.docs.map((d) => d.data()).filter((e) => e.active !== false && Number(e.serviceEveryDays) > 0 && (Number(e.lastServiceAt) || Number(e.createdAt) || 0) + Number(e.serviceEveryDays) * 864e5 < now).length;
  if (late) parts.push(`${late} أجهزة صيانتها متأخرة`);
  if (parts.length) await push(BOSSES, "☀️ المطبخ اليوم", parts.join(" · "), "morning");
});
