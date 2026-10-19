// Draws the downloadable QR card exactly as Floor Link does (same functions,
// taken from index.html) in real Chrome, then reads the QR back with jsQR.
// Run by Actions → "Check — QR card". Prints what a phone would open.
const fs = require("fs");
const puppeteer = require("puppeteer-core");
const src = fs.readFileSync(__dirname + "/../index.html", "utf8");
const pick = (name) => {
  const i = src.indexOf("function " + name + "(");
  let d = 0, j = src.indexOf("{", i);
  for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}" && --d === 0) return src.slice(i, k + 1); }
};
const sites = src.match(/var FEEDBACK_SITES = \{[\s\S]*?\};/)[0];
const logos = src.match(/var LOGO_URIS = \{[\s\S]*?\};/)[0];
const code = { id: "r3x2yw7s", branch: "shoppies", type: "any", place: "Invoice" };
const html = `<!doctype html><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js"></script>
<script src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js"></script>
<script>
function esc(s){return String(s);}
${sites}
${logos}
${["fbBrandOf","fbCodeUrl","fbQr","fbLoadImg","fbCardCanvas","fbThumb"].map(pick).join("\n")}
var fbThumbCache = {};
window.run = async function(){
  var code = ${JSON.stringify(code)};
  var out = {url: fbCodeUrl(code)};
  var c = await fbCardCanvas(code);
  var d = c.getContext("2d").getImageData(0, 0, c.width, c.height);
  var r = jsQR(d.data, d.width, d.height);
  out.card = r ? r.data : "COULD NOT READ";
  out.cardPng = c.toDataURL("image/png");
  return out;
};
</script>`;
(async () => {
  fs.writeFileSync("/tmp/qr.html", html);
  const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--allow-file-access-from-files"] });
  const p = await b.newPage();
  p.on("console", (m) => console.log("page:", m.text()));
  p.on("pageerror", (e) => console.log("pageerror:", e.message));
  await p.goto("file:///tmp/qr.html", { waitUntil: "networkidle0" });
  const out = await p.evaluate(() => window.run());
  fs.writeFileSync("/tmp/card.png", Buffer.from(out.cardPng.split(",")[1], "base64"));
  console.log("::notice::expected=" + out.url + " | card reads=" + out.card);
  await b.close();
})().catch((e) => { console.log("::error::" + e.message); process.exit(1); });
