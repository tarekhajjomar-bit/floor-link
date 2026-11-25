// Kitchen OS — TEST data for Tarek to look around before going live.
//   node kitchen-test-data.js load   → fills every Kitchen OS section with sample data marked "(تست)"
//   node kitchen-test-data.js clear  → deletes ALL test data (and anything that points to it), nothing else
// Every document made here has an id starting with "test_" (or test: true). Run from Actions → "Kitchen OS — test data".
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const ACTION = process.argv[2];
const TZ = "Asia/Beirut";
const T = " (تست)";
const H = "https://d8j0ntlcm91z4.cloudfront.net/user_3M9OxeQRWsfJb0BgMz7vSsm825v/";
const PH = { kibbeh: H + "hf_20261124_072409_a4db7c77-a64b-42a6-9b9e-441095b258ee.png", dough: H + "hf_20261124_072836_0a1e14d7-bc88-4857-a420-1737d5d66166.png",
  filling: H + "hf_20261124_073037_03be6073-3b31-426f-81ef-4e84e0f284f6.png", shell: H + "hf_20261124_073112_03adba5e-ee7a-402a-a4b5-edbe5c92ca85.png",
  stuff: H + "hf_20261124_073242_e4dfc292-f164-4107-a5fd-9c133b45a663.png", fry: H + "hf_20261124_073351_7b0ed911-7e77-4cf2-a9bf-ea15b93dae32.png" };
const COLLECTIONS = ["ingredients", "costs", "recipes", "pricing", "cleaning", "suppliers", "deliveries", "batches", "movements", "claims", "requests", "counts",
  "plans", "production", "waste", "equipment", "temps", "checks", "issues", "orders", "audit"].map((c) => "kitchen_" + c);

const NOW = Date.now(), H1 = 3600e3, D1 = 864e5;
const day = (offset) => { const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(NOW + offset * D1)); return p; };
const TODAY = day(0), YEST = day(-1), TOM = day(1);
const isTest = (id, data) => id.startsWith("test_") || (data && data.test === true) || JSON.stringify(data || {}).includes('"test_') || JSON.stringify(data || {}).includes("rcp_test_");

async function commitAll(ops) {
  for (let i = 0; i < ops.length; i += 400) { const b = db.batch(); ops.slice(i, i + 400).forEach(([ref, data]) => (data === null ? b.delete(ref) : b.set(ref, data))); await b.commit(); }
}

async function load() {
  const owners = await db.collection("kitchen_members").where("role", "==", "owner").get();
  const me = owners.empty ? "test_owner" : owners.docs[0].id;
  const ops = []; const put = (col, id, data) => ops.push([db.collection("kitchen_" + col).doc(id), { ...data, test: true }]);

  // ---------- ingredients, supplies, purchase prices
  const ING = [
    ["breast", "صدر دجاج", "Chicken breast", "g", 5.5, { yieldPct: 92, trimNote: "دهن", minStock: 20000 }], ["thigh", "فخاد دجاج", "Chicken thighs", "g", 4.2, { yieldPct: 90, trimNote: "جلد وتنظيفات" }],
    ["flour", "طحين", "Flour", "g", 0.8], ["crumb", "بقسماط", "Breadcrumbs", "g", 2.0], ["egg", "بيض", "Eggs", "pcs", 0.12], ["spice", "بهار كريسبي", "Crispy spice", "g", 9],
    ["oil", "زيت قلي", "Frying oil", "ml", 2.2], ["garlic", "ثوم مدقوق", "Crushed garlic", "g", 3], ["yogurt", "لبن", "Yogurt", "g", 1.6], ["lemon", "عصير حامض", "Lemon juice", "ml", 2.5],
    ["salt", "ملح", "Salt", "g", 0.4], ["burghul", "برغل ناعم", "Fine bulgur", "g", 1.4], ["lamb", "لحم غنم مفروم", "Minced lamb", "g", 13], ["onion", "بصل", "Onion", "g", 0.7, { yieldPct: 85, trimNote: "قشر وراس", minStock: 10000 }],
    ["pine", "صنوبر", "Pine nuts", "g", 40],
  ];
  const SUP = [["box", "كرتونة تغليف", "Packaging box", "pcs", 0.15, "packaging"], ["bag", "كيس نايلون", "Nylon bag", "pcs", 0.03, "packaging"], ["gloves", "كفوف نايلون", "Gloves", "pcs", 0.04, "disposables"]];
  const ingName = {};
  ING.forEach(([id, ar, en, unit, price, extra]) => { ingName["test_" + id] = ar + T; put("ingredients", "test_" + id, { name_ar: ar + T, name_en: en + " (test)", unit, kind: "ingredient", ...(extra || {}), updatedAt: NOW, updatedBy: me });
    put("costs", "test_" + id, { price, updatedAt: NOW - 3 * D1, updatedBy: me, history: [{ price: Math.round(price * 0.9 * 100) / 100, at: NOW - 40 * D1 }, { price, at: NOW - 3 * D1 }] }); });
  SUP.forEach(([id, ar, en, unit, price, group]) => { ingName["test_" + id] = ar + T; put("ingredients", "test_" + id, { name_ar: ar + T, name_en: en + " (test)", unit, kind: "supply", group, updatedAt: NOW, updatedBy: me });
    put("costs", "test_" + id, { price, updatedAt: NOW - 3 * D1, updatedBy: me, history: [{ price, at: NOW - 3 * D1 }] }); });
  const L = (id, qty, unit) => ({ type: "ingredient", refId: "test_" + id, name: ingName["test_" + id], qty, unit });
  const R = (id, name, qty, unit) => ({ type: "recipe", refId: "test_" + id, name: name + T, qty, unit });

  // ---------- settings: test categories, a test sales channel, test hygiene tasks (removed again on clear)
  const sref = db.collection("kitchen_settings").doc("main");
  const cur = (await sref.get()).data() || {};
  const keep = (arr) => (arr || []).filter((x) => !(x && (x.test || String(x.id || "").startsWith("test_"))));
  const channels = keep(cur.channels);
  if (!channels.some((c) => c.id === "store")) channels.unshift({ id: "store", name_ar: "المحل", name_en: "Shop", commissionPct: 0, packaging: [] });
  channels.push({ id: "test_app", name_ar: "تطبيق توصيل" + T, name_en: "Delivery app (test)", commissionPct: 20, packaging: [{ ingredientId: "test_box", qty: 1 }, { ingredientId: "test_bag", qty: 1 }], test: true });
  await sref.set({
    categories: [...keep(cur.categories), { id: "test_fried", name_ar: "مقالي" + T, name_en: "Fried (test)", test: true }, { id: "test_hot", name_ar: "طبخ سخن" + T, name_en: "Hot dishes (test)", test: true }, { id: "test_prep", name_ar: "تحضيرات" + T, name_en: "Preparations (test)", test: true }],
    channels,
    safetyTasks: [...keep(cur.safetyTasks),
      { id: "test_k1", name_ar: "غسل الأيدي ولبس الكفوف" + T, name_en: "Wash hands, wear gloves (test)", freq: "daily", when: "open", test: true },
      { id: "test_k2", name_ar: "تعقيم ألواح تقطيع الدجاج" + T, name_en: "Sanitise chicken boards (test)", freq: "daily", when: "close", section: "chicken", test: true },
      { id: "test_k3", name_ar: "تنظيف الأرض والمجاري" + T, name_en: "Clean floor and drains (test)", freq: "daily", when: "close", test: true },
      { id: "test_k4", name_ar: "تنظيف البرادات من جوّا" + T, name_en: "Clean fridges inside (test)", freq: "weekly", when: "any", test: true }],
    sections: cur.sections && cur.sections.length ? cur.sections : [{ id: "chicken", name_ar: "الدجاج", name_en: "Chicken" }, { id: "cooking", name_ar: "الطبخ", name_en: "Cooking" }],
    defaultMargin: cur.defaultMargin != null ? cur.defaultMargin : 30, alertPoints: cur.alertPoints != null ? cur.alertPoints : 2,
  }, { merge: true });

  // ---------- recipes (3 dishes + 2 preparations), all approved; taouk also has a v2 waiting for approval
  const rcp = (id, ar, en, category, kind, section, photo, version, extra) => {
    put("recipes", "test_" + id, { name_ar: ar + T, name_en: en + " (test)", category, kind, section, photo: photo || "", officialVersion: 1, latestVersion: (extra && extra.v2) ? 2 : 1, pendingVersion: (extra && extra.v2) ? 2 : null,
      approvedBy: me, approvedAt: NOW - 5 * D1, createdAt: NOW - 6 * D1, createdBy: me, updatedAt: NOW - D1 });
    ops.push([db.collection("kitchen_recipes").doc("test_" + id).collection("versions").doc("1"), { ...version, n: 1, status: "approved", proposedBy: me, proposedByName: "الشيف" + T, proposedAt: NOW - 6 * D1, approvedBy: me, approvedByName: "طارق", approvedAt: NOW - 5 * D1, reason: "تست", test: true }]);
    if (extra && extra.v2) ops.push([db.collection("kitchen_recipes").doc("test_" + id).collection("versions").doc("2"), { ...extra.v2, n: 2, status: "proposed", proposedBy: me, proposedByName: "شيف الدجاج" + T, proposedAt: NOW - 5 * H1, reason: "زدت التوم شوي — الزباين طلبوه" + T, test: true }]);
  };
  const st = (text, check, photo) => ({ text, check: check || "", ...(photo ? { photo } : {}) });
  rcp("crispy", "كريسبي دجاج", "Chicken crispy", "test_fried", "final", "chicken", "", {
    lines: [L("breast", 5000, "g"), L("flour", 800, "g"), L("crumb", 700, "g"), L("egg", 10, "pcs"), L("spice", 100, "g"), L("salt", 40, "g"), L("oil", 1000, "ml")],
    steps: [st("قطّع الصدر شرايح", "شرايح 1 سم"), st("تبّل بالبهار والملح"), st("غطّس بالبيض ثم الطحين والبقسماط", "مغطّى منيح"), st("اقلي 4 دقايق", "لون دهبي", PH.fry)],
    quality: ["مقرمش من برّا", "مستوي من جوّا"], yield: { qty: 5, unit: "kg", pieceWeight: null }, storage: { location: "fridge", shelfLife: "" }, resultPhoto: "" });
  const taoukV1 = { lines: [L("breast", 5000, "g"), L("yogurt", 500, "g"), L("garlic", 100, "g"), L("lemon", 150, "ml"), L("oil", 150, "ml"), L("salt", 50, "g")],
    steps: [st("قطّع الصدر مكعبات", "مكعبات 3 سم"), st("اخلط اللبن مع التوم والحامض والزيت والملح"), st("قلّب الدجاج بالتتبيلة وغطّيه", "كل القطع متغطية")],
    quality: ["تتبيلة موزّعة على كل القطع"], yield: { qty: 5.2, unit: "kg", pieceWeight: null }, storage: { location: "fridge", shelfLife: "" }, resultPhoto: "" };
  rcp("taouk", "طاووق متبّل", "Marinated taouk", "test_hot", "final", "chicken", "", taoukV1,
    { v2: { ...taoukV1, lines: taoukV1.lines.map((l) => (l.refId === "test_garlic" ? { ...l, qty: 150 } : l)) } });
  rcp("kdough", "عجينة كبة", "Kibbeh dough", "test_prep", "intermediate", "cooking", PH.dough, {
    lines: [L("burghul", 1500, "g"), L("lamb", 1200, "g"), L("onion", 300, "g"), L("salt", 30, "g")],
    steps: [st("نقّع البرغل 10 دقايق وصفّيه"), st("اطحن اللحمة مع البصل"), st("اعجن الكل لحد ما تصير ناعمة", "ما تلزق بالإيد")],
    quality: ["ناعمة ومتماسكة"], yield: { qty: 3, unit: "kg", pieceWeight: null }, storage: { location: "fridge", shelfLife: "" }, resultPhoto: PH.dough });
  rcp("kfill", "حشوة كبة", "Kibbeh filling", "test_prep", "intermediate", "cooking", PH.filling, {
    lines: [L("lamb", 1000, "g"), L("onion", 600, "g"), L("pine", 100, "g"), L("salt", 15, "g")],
    steps: [st("قلّي البصل لحد ما يدبل"), st("زيد اللحمة وقلّب لتستوي"), st("زيد الصنوبر المحمّص")],
    quality: ["ناشفة مش مي"], yield: { qty: 1.5, unit: "kg", pieceWeight: null }, storage: { location: "fridge", shelfLife: "" }, resultPhoto: PH.filling });
  rcp("kibbeh", "كبة مقلية", "Fried kibbeh", "test_fried", "final", "cooking", PH.kibbeh, {
    lines: [R("kdough", "عجينة كبة", 3, "kg"), R("kfill", "حشوة كبة", 1.5, "kg"), L("oil", 2000, "ml")],
    steps: [st("افتح العجينة قرص", "سماكة متساوية", PH.shell), st("احشي وسكّر", "ما في فتحات", PH.stuff), st("اقلي على 170°", "لون دهبي", PH.fry)],
    quality: ["لون دهبي", "ما في زيت زيادة"], yield: { qty: 100, unit: "pcs", pieceWeight: 45 }, storage: { location: "fridge", shelfLife: "" }, resultPhoto: PH.kibbeh });

  // ---------- selling prices (shop + test delivery app)
  const price = (id, unit, shop, app, margin, cost, name) => put("pricing", "test_" + id, { name_ar: name + T, sellingPrice: shop, targetMargin: margin, costAtApproval: cost, unit, updatedAt: NOW - 4 * D1, updatedBy: me,
    channels: { test_app: { sellingPrice: app, targetMargin: margin, costAtApproval: cost, unit, at: NOW - 4 * D1 } }, history: [{ sellingPrice: shop, at: NOW - 4 * D1 }] });
  price("crispy", "kg", 9.5, 12, 35, 6.1, "كريسبي دجاج"); price("taouk", "kg", 8, 10, 35, 5.9, "طاووق متبّل"); price("kibbeh", "pcs", 0.45, 0.6, 35, 0.21, "كبة مقلية");

  // ---------- cleaning weighings (thighs drift below the official 90%)
  [[10000, 8750, 1], [12000, 10500, 3], [9000, 7900, 6], [11000, 9700, 9], [10000, 8900, 13], [8000, 7150, 18]].forEach(([b, a, ago], i) =>
    put("cleaning", "test_cl_th" + i, { ingredientId: "test_thigh", before: b, after: a, waste: null, note: "", by: me, byName: "سامي" + T, at: NOW - ago * D1 - 2 * H1 }));
  [[10000, 9250, 2], [10000, 9180, 7], [12000, 11000, 12]].forEach(([b, a, ago], i) =>
    put("cleaning", "test_cl_br" + i, { ingredientId: "test_breast", before: b, after: a, waste: null, note: "", by: me, byName: "سامي" + T, at: NOW - ago * D1 - 3 * H1 }));

  // ---------- suppliers, deliveries (with rejection), supermarket transfer, stock batches
  put("suppliers", "test_sup1", { name: "مزرعة الدجاج" + T, createdAt: NOW - 30 * D1 });
  put("suppliers", "test_sup2", { name: "الملحمة" + T, createdAt: NOW - 30 * D1 });
  const line = (id, invoiceQty, received, accepted, expiry, location, extra) => ({ ingredientId: "test_" + id, name: ingName["test_" + id], unit: ["egg", "box", "bag", "gloves"].includes(id) ? "pcs" : ["oil", "lemon"].includes(id) ? "ml" : "g",
    invoiceQty, received, accepted, rejected: received - accepted, rejectReason: received > accepted ? "r_temp" : null, expiry, location, note: "", ...(extra || {}) });
  const del = (id, sup, supName, ago, lines, extra) => put("deliveries", id, { supplierId: sup, supplierName: supName, invoiceNo: id.replace("test_del", "T-10"), invoicePhoto: null, source: sup === "store" ? "store" : "supplier",
    lines, status: "done", createdBy: me, createdByName: "موظف الاستلام" + T, createdAt: NOW - ago, qcBy: me, qcByName: "الشيف" + T, qcAt: NOW - ago + H1, ...(extra || {}) });
  const batches = [];
  const addBatches = (delId, supId, supName, ago, lines) => lines.forEach((l, i) => { if (l.accepted > 0) batches.push({ id: delId + "_" + i, ingredientId: l.ingredientId, name: l.name, qty: l.accepted, remaining: l.accepted, unit: l.unit, expiry: l.expiry, location: l.location,
    status: "available", supplierId: supId, supplierName: supName, deliveryId: delId, line: i, receivedAt: NOW - ago + H1, createdBy: me }); });
  const d1 = [line("breast", 30000, 30000, 28000, day(3), "fridge", { note: "كرتونة سخنة" }), line("thigh", 20000, 20000, 20000, day(1), "fridge")];
  del("test_del1", "test_sup1", "مزرعة الدجاج" + T, 2 * D1, d1); addBatches("test_del1", "test_sup1", "مزرعة الدجاج" + T, 2 * D1, d1);
  put("claims", "test_del1", { kind: "rejected", deliveryId: "test_del1", invoiceNo: "T-101", source: "supplier", supplierId: "test_sup1", supplierName: "مزرعة الدجاج" + T,
    lines: [{ ingredientId: "test_breast", name: ingName.test_breast, qty: 2000, unit: "g", reason: "r_temp" }], status: "open", createdBy: me, createdByName: "الشيف" + T, createdAt: NOW - 2 * D1 + H1 });
  const d2 = [line("lamb", 10000, 10000, 10000, day(2), "fridge"), line("onion", 15000, 15000, 15000, day(10), "dry")];
  del("test_del2", "test_sup2", "الملحمة" + T, D1, d2); addBatches("test_del2", "test_sup2", "الملحمة" + T, D1, d2);
  const d4 = [line("flour", 10000, 10000, 10000, day(60), "dry"), line("crumb", 5000, 5000, 5000, day(45), "dry"), line("salt", 2000, 2000, 2000, null, "dry"), line("oil", 20000, 20000, 20000, day(120), "dry"),
    line("spice", 1000, 1000, 1000, day(90), "dry"), line("egg", 90, 90, 90, day(12), "fridge"), line("burghul", 10000, 10000, 10000, day(90), "dry"), line("pine", 1000, 1000, 1000, day(60), "dry"),
    line("garlic", 2000, 2000, 2000, day(5), "fridge"), line("lemon", 3000, 3000, 3000, day(4), "fridge"), line("yogurt", 5000, 5000, 5000, day(-1), "fridge"),
    line("box", 200, 200, 200, null, "dry"), line("bag", 500, 500, 500, null, "dry"), line("gloves", 300, 300, 300, null, "dry")];
  del("test_del4", "store", "السوبرماركت (شوبيز)" + T, 3 * D1, d4); addBatches("test_del4", "store", "السوبرماركت (شوبيز)" + T, 3 * D1, d4);
  // waiting for the chef's check today (yogurt arrived short)
  put("deliveries", "test_del3", { supplierId: "test_sup1", supplierName: "مزرعة الدجاج" + T, invoiceNo: "T-103", invoicePhoto: null, source: "supplier", status: "awaiting_qc",
    lines: [{ ingredientId: "test_breast", name: ingName.test_breast, unit: "g", invoiceQty: 25000, received: 25000, expiry: day(4), note: "" }, { ingredientId: "test_yogurt", name: ingName.test_yogurt, unit: "g", invoiceQty: 10000, received: 9500, expiry: day(6), note: "كيس ناقص" }],
    createdBy: me, createdByName: "موظف الاستلام" + T, createdAt: NOW - 2 * H1 });
  // what was already used, one batch on quality hold
  const bset = (id, patch) => Object.assign(batches.find((b) => b.id === id), patch);
  bset("test_del1_0", { remaining: 18000 }); bset("test_del1_1", { remaining: 14000 }); bset("test_del2_0", { remaining: 6800 });
  bset("test_del4_8", { status: "hold", holdReason: "ريحة مش طبيعية" + T, holdBy: me, holdByName: "الشيف" + T, holdAt: NOW - 5 * H1 });
  // made preparations in stock (from yesterday's production)
  batches.push({ id: "test_prodY1_out", ingredientId: "rcp_test_kdough", name: "عجينة كبة" + T, qty: 6000, remaining: 4000, unit: "g", expiry: null, location: "fridge", status: "available", supplierName: "", productionId: "test_prodY1", receivedAt: NOW - D1, createdBy: me });
  batches.push({ id: "test_prodY2_out", ingredientId: "rcp_test_kfill", name: "حشوة كبة" + T, qty: 3000, remaining: 2000, unit: "g", expiry: null, location: "fridge", status: "available", supplierName: "", productionId: "test_prodY2", receivedAt: NOW - D1, createdBy: me });

  // ---------- purchase request, stock count waiting for the owner
  put("requests", "test_req1", { status: "requested", neededBy: TOM, note: "للطلبية تبع بكرا" + T, createdBy: me, createdByName: "شيف الدجاج" + T, createdAt: NOW - 3 * H1,
    lines: [{ ingredientId: "test_breast", name: ingName.test_breast, unit: "g", qty: 30000, note: "" }, { ingredientId: "test_box", name: ingName.test_box, unit: "pcs", qty: 200, note: "" }] });
  put("counts", "test_count1", { status: "submitted", createdBy: me, createdByName: "شيف الطبخ" + T, createdAt: NOW - 1 * H1,
    lines: [{ ingredientId: "test_lamb", name: ingName.test_lamb, unit: "g", system: 6800, counted: 6300 }, { ingredientId: "test_onion", name: ingName.test_onion, unit: "g", system: 15000, counted: 15000 }, { ingredientId: "test_flour", name: ingName.test_flour, unit: "g", system: 10000, counted: 10400 }] });

  // ---------- daily plans per section, today's production (one with a stock shortage), made products
  const plan = (date, sec, lines) => put("plans", `${date}_${sec}`, { date, section: sec, lines, updatedBy: me, updatedByName: "الشيف" + T, updatedAt: NOW - 10 * H1 });
  plan(TODAY, "chicken", [{ recipeId: "test_crispy", name: "كريسبي دجاج" + T, qty: 10, unit: "kg", note: "" }, { recipeId: "test_taouk", name: "طاووق متبّل" + T, qty: 15, unit: "kg", note: "للدليفري" }]);
  plan(TODAY, "cooking", [{ recipeId: "test_kibbeh", name: "كبة مقلية" + T, qty: 200, unit: "pcs", note: "" }, { recipeId: "test_kdough", name: "عجينة كبة" + T, qty: 3, unit: "kg", note: "" }]);
  plan(TOM, "chicken", [{ recipeId: "test_crispy", name: "كريسبي دجاج" + T, qty: 8, unit: "kg", note: "" }]);
  const prod = (id, sec, rid, name, qty, unit, outQty, outUnit, ago, consumed, by) => {
    put("production", id, { date: TODAY, orderId: null, section: sec, sectionDate: `${sec}_${TODAY}`, recipeId: rid, versionN: 1, name, qty, unit, consumed, hasShort: consumed.some((c) => c.short > 0), outBatch: id + "_out", by: me, byName: by, at: NOW - ago });
    batches.push({ id: id + "_out", ingredientId: "rcp_" + rid, name, qty: outQty, remaining: outQty, unit: outUnit, expiry: null, location: "fridge", status: "available", supplierName: "", productionId: id, receivedAt: NOW - ago, createdBy: me });
  };
  const c = (key, qty, unit, short, takes) => ({ key, name: ingName[key] || key, qty, unit, takes: takes || [], short: short || 0 });
  prod("test_prod1", "chicken", "test_crispy", "كريسبي دجاج" + T, 5, "kg", 5000, "g", 4 * H1, [c("test_breast", 5435, "g", 0, [{ id: "test_del1_0", take: 5435 }]), c("test_flour", 800, "g"), c("test_crumb", 700, "g"), c("test_egg", 10, "pcs"), c("test_oil", 1000, "ml")], "سامي" + T);
  prod("test_prod2", "chicken", "test_taouk", "طاووق متبّل" + T, 5.2, "kg", 5200, "g", 2 * H1, [c("test_breast", 5435, "g"), c("test_yogurt", 500, "g", 500), c("test_garlic", 100, "g", 100)], "سامي" + T);
  prod("test_prod3", "cooking", "test_kibbeh", "كبة مقلية" + T, 100, "pcs", 100, "pcs", 3 * H1, [c("rcp_test_kdough", 3000, "g", 0, [{ id: "test_prodY1_out", take: 2000 }]), c("rcp_test_kfill", 1500, "g"), c("test_oil", 2000, "ml")], "علي" + T);
  batches.forEach((b) => put("batches", b.id, b));

  // ---------- waste of the last 7 days
  const w = (i, key, type, refId, name, qty, unit, reason, ago, by) => put("waste", "test_w" + i, { key, type, refId, name, qty, unit, reason, note: "", batchId: null, by: me, byName: by, at: NOW - ago });
  w(1, "rcp_test_crispy", "product", "test_crispy", "كريسبي دجاج" + T, 800, "g", "r_burnt", 5 * H1, "سامي" + T);
  w(2, "test_yogurt", "ingredient", "test_yogurt", ingName.test_yogurt, 2000, "g", "r_expired", 1 * D1, "الشيف" + T);
  w(3, "test_breast", "ingredient", "test_breast", ingName.test_breast, 1000, "g", "r_dropped", 2 * D1, "سامي" + T);
  w(4, "rcp_test_kibbeh", "product", "test_kibbeh", "كبة مقلية" + T, 12, "pcs", "r_leftover", 1 * D1 + 2 * H1, "علي" + T);
  w(5, "test_onion", "ingredient", "test_onion", ingName.test_onion, 1500, "g", "r_spoiled", 4 * D1, "علي" + T);
  w(6, "rcp_test_taouk", "product", "test_taouk", "طاووق متبّل" + T, 600, "g", "r_quality", 3 * D1, "الشيف" + T);

  // ---------- food safety: equipment (TEST limits — set your own for real units), readings, hygiene ticks, faults
  put("equipment", "test_eq1", { name_ar: "براد الدجاج" + T, name_en: "Chicken fridge (test)", kind: "fridge", section: "chicken", tempMin: 0, tempMax: 4, checksPerDay: 2, active: true, createdAt: NOW - 60 * D1 });
  put("equipment", "test_eq2", { name_ar: "فريزر اللحمة" + T, name_en: "Meat freezer (test)", kind: "freezer", section: null, tempMin: null, tempMax: -18, checksPerDay: 2, serviceEveryDays: 90, lastServiceAt: NOW - 100 * D1, active: true, createdAt: NOW - 200 * D1 });
  put("equipment", "test_eq3", { name_ar: "قلاية الكريسبي" + T, name_en: "Crispy fryer (test)", kind: "fryer", section: "chicken", tempMin: 160, tempMax: 180, checksPerDay: 1, active: true, createdAt: NOW - 60 * D1 });
  put("equipment", "test_eq4", { name_ar: "براد الطبخ" + T, name_en: "Cooking fridge (test)", kind: "fridge", section: "cooking", tempMin: null, tempMax: null, checksPerDay: 2, active: true, createdAt: NOW - 30 * D1 });
  const tr = (i, eq, name, temp, status, ago, by, action, note) => put("temps", "test_t" + i, { equipmentId: eq, name, date: day(-Math.floor(ago / D1)), temp, status, limits: {}, action: action || null, note: note || "", by: me, byName: by, at: NOW - ago });
  tr(1, "test_eq1", "براد الدجاج" + T, 3, "ok", 2 * D1 + 3 * H1, "سامي" + T); tr(2, "test_eq1", "براد الدجاج" + T, 3.5, "ok", D1 + 3 * H1, "سامي" + T);
  tr(3, "test_eq1", "براد الدجاج" + T, 6.5, "high", 1 * H1, "سامي" + T, "a_moved", "الباب كان مفتوح" + T);
  tr(4, "test_eq2", "فريزر اللحمة" + T, -20, "ok", D1 + 2 * H1, "علي" + T); tr(5, "test_eq2", "فريزر اللحمة" + T, -19, "ok", 2 * H1, "علي" + T);
  tr(6, "test_eq3", "قلاية الكريسبي" + T, 172, "ok", 4 * H1, "سامي" + T); tr(7, "test_eq4", "براد الطبخ" + T, 4, "nolimits", 3 * H1, "علي" + T);
  const ck = (date, task, name, ago) => put("checks", `${date}_${task}`, { date, taskId: task, name, by: me, byName: "علي" + T, at: NOW - ago });
  ck(TODAY, "test_k1", "غسل الأيدي ولبس الكفوف" + T, 6 * H1); ck(YEST, "test_k1", "غسل الأيدي ولبس الكفوف" + T, D1 + 6 * H1); ck(YEST, "test_k2", "تعقيم ألواح تقطيع الدجاج" + T, D1 - H1);
  ck(day(-2), "test_k4", "تنظيف البرادات من جوّا" + T, 2 * D1);
  put("issues", "test_iss1", { kind: "fault", status: "open", equipmentId: "test_eq3", equipmentName: "قلاية الكريسبي" + T, text: "الترموستات مش ثابت" + T, photo: null, reportedBy: me, reportedByName: "سامي" + T, at: NOW - 20 * H1 });
  put("issues", "test_iss2", { kind: "fault", status: "fixed", equipmentId: "test_eq1", equipmentName: "براد الدجاج" + T, text: "كاوتشوك الباب مقطوع" + T, reportedBy: me, reportedByName: "علي" + T, at: NOW - 6 * D1,
    fixNote: "انبدل" + T, fixedBy: me, fixedByName: "طارق", fixedAt: NOW - 5 * D1 });

  // ---------- customer orders
  put("orders", "test_ord1", { customer: "أم محمد" + T, phone: "70000000", dueDate: TOM, dueTime: "12:00", mode: "pickup", address: "", note: "عيد ميلاد — بدها بعلب" + T, status: "new", createdBy: me, createdByName: "طارق", createdAt: NOW - 5 * H1,
    lines: [{ recipeId: "test_kibbeh", name: "كبة مقلية" + T, qty: 200, unit: "pcs", section: "cooking", note: "" }, { recipeId: "test_taouk", name: "طاووق متبّل" + T, qty: 5, unit: "kg", section: "chicken", note: "حرّ خفيف" }], sections: ["cooking", "chicken"] });
  put("orders", "test_ord2", { customer: "أبو خالد" + T, phone: "03000000", dueDate: TODAY, dueTime: "19:30", mode: "delivery", address: "الميناء، قرب البلدية" + T, note: "", status: "new", createdBy: me, createdByName: "طارق", createdAt: NOW - D1,
    lines: [{ recipeId: "test_crispy", name: "كريسبي دجاج" + T, qty: 3, unit: "kg", section: "chicken", note: "" }], sections: ["chicken"] });

  await commitAll(ops);
  console.log(`::notice::Loaded ${ops.length} test documents (owner ${me}). Today=${TODAY}.`);
}

async function clear() {
  let n = 0;
  for (const col of COLLECTIONS) {
    const snap = await db.collection(col).get();
    const ops = [];
    for (const d of snap.docs) {
      if (!isTest(d.id, d.data())) continue;
      if (col === "kitchen_recipes") { const vs = await d.ref.collection("versions").get(); vs.docs.forEach((v) => ops.push([v.ref, null])); }
      ops.push([d.ref, null]);
    }
    await commitAll(ops); n += ops.length;
    if (ops.length) console.log(`${col}: deleted ${ops.length}`);
  }
  const sref = db.collection("kitchen_settings").doc("main"); const cur = (await sref.get()).data();
  if (cur) {
    const keep = (arr) => (arr || []).filter((x) => !(x && (x.test || String(x.id || "").startsWith("test_"))));
    const channels = keep(cur.channels).map((c) => ({ ...c, packaging: (c.packaging || []).filter((p) => !String(p.ingredientId || "").startsWith("test_")) }));
    await sref.set({ categories: keep(cur.categories), channels, safetyTasks: keep(cur.safetyTasks) }, { merge: true });
  }
  console.log(`::notice::Deleted ${n} test documents. Settings cleaned of test categories, channels and hygiene tasks.`);
}

(async () => {
  if (ACTION === "load") await load();
  else if (ACTION === "clear") await clear();
  else throw new Error("Use: load | clear");
  process.exit(0);
})().catch((e) => { console.error(e); console.log("::error::" + e.message); process.exit(1); });
