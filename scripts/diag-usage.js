// Read-only: pull Firestore/Storage usage numbers from Cloud Monitoring.
const fs = require("fs");
const { GoogleAuth } = require("google-auth-library");
(async () => {
  const out = [];
  try {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    const auth = new GoogleAuth({ credentials: sa, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    const client = await auth.getClient();
    const project = sa.project_id;
    out.push("project " + project);
    async function q(metric, days, alignSec, extra = "") {
      const end = new Date(), start = new Date(Date.now() - days * 86400000);
      const u = `https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?filter=${encodeURIComponent('metric.type="' + metric + '"' + extra)}&interval.startTime=${start.toISOString()}&interval.endTime=${end.toISOString()}&aggregation.alignmentPeriod=${alignSec}s&aggregation.perSeriesAligner=ALIGN_SUM&aggregation.crossSeriesReducer=REDUCE_SUM&view=FULL`;
      const r = await client.request({ url: u });
      const ts = (r.data.timeSeries || [])[0];
      if (!ts) return [];
      return ts.points.map((p) => [p.interval.endTime, Number(p.value.int64Value || p.value.doubleValue || 0)]).reverse();
    }
    for (const m of ["firestore.googleapis.com/document/read_count", "firestore.googleapis.com/document/write_count", "firestore.googleapis.com/document/delete_count"]) {
      try {
        const pts = await q(m, 10, 86400);
        out.push(m.split("/").pop() + " per day (UTC): " + pts.map((p) => p[0].slice(5, 10) + "=" + p[1]).join("  "));
      } catch (e) { out.push(m + " ERROR: " + (e.response && e.response.data ? JSON.stringify(e.response.data).slice(0, 250) : e.message)); }
    }
    try {
      const pts = await q("firestore.googleapis.com/document/read_count", 2, 3600);
      out.push("reads per hour (last 48h, UTC): " + pts.map((p) => p[0].slice(5, 13) + "h=" + p[1]).join(" "));
    } catch (e) { out.push("hourly ERROR: " + e.message); }
    for (const m of ["storage.googleapis.com/network/sent_bytes_count", "storage.googleapis.com/api/request_count"]) {
      try {
        const pts = await q(m, 10, 86400);
        out.push(m.split("/").slice(-2).join("/") + " per day: " + pts.map((p) => p[0].slice(5, 10) + "=" + (m.includes("bytes") ? Math.round(p[1] / 1e6) + "MB" : p[1])).join("  "));
      } catch (e) { out.push(m + " ERROR: " + (e.response && e.response.data ? JSON.stringify(e.response.data).slice(0, 250) : e.message)); }
    }
  } catch (e) { out.push("ERROR: " + (e && e.message)); }
  fs.mkdirSync("../diag", { recursive: true });
  fs.writeFileSync("../diag/usage.txt", new Date().toISOString() + "\n" + out.join("\n") + "\n");
  console.log(out.join("\n"));
})();
