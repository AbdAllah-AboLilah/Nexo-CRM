// ============================================================
//  توليد تقرير مستقل للطباعة / الحفظ PDF
//  بيفتح نافذة فيها التقرير كامل — مش لقطة شاشة
// ============================================================
import { session } from "./auth.js";
import { esc, money, fmtDate } from "./ui.js";

const PERIOD_LABEL = {
  daily: "يومي", weekly: "أسبوعي", monthly: "شهري", yearly: "سنوي",
};

/**
 * @param {object} o
 *   period      — daily | weekly | monthly | yearly
 *   rangeLabel  — وصف الفترة
 *   metrics     — [{ label, now, before, unit, money, goodDown }]
 *   platforms   — { key: { label, count, pct } }
 *   followers   — [{ label, start, end }]
 *   daily       — [{ date, conversations, orders }]
 *   insights    — [{ title, body }]
 */
export function openReport(o) {
  const company = session.company?.name || "";
  const now = new Date();
  const printedAt = now.toLocaleString("ar-EG", {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const html = buildHtml({ ...o, company, printedAt });

  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) {
    // المتصفح منع النافذة — نستخدم iframe مخفي كبديل
    printViaFrame(html);
    return;
  }
  w.document.write(html);
  w.document.close();
  // ننتظر تحميل الخطوط قبل الطباعة عشان العربي يطلع مظبوط
  w.onload = () => setTimeout(() => w.print(), 400);
}

function printViaFrame(html) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;inset:0;width:0;height:0;border:0";
  document.body.append(frame);
  frame.contentDocument.write(html);
  frame.contentDocument.close();
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 1000);
  }, 500);
}

function buildHtml({ company, printedAt, period, rangeLabel, metrics = [],
                     platforms = {}, followers = [], daily = [], insights = [] }) {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<title>تقرير ${esc(PERIOD_LABEL[period] || "")} — ${esc(company)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap">
<style>
  *{margin:0;padding:0;box-sizing:border-box;font-family:'Tajawal',Tahoma,sans-serif}
  body{background:#fff;color:#2f3145;padding:32px 36px;font-size:13px;line-height:1.7}

  .head{display:flex;justify-content:space-between;align-items:flex-start;
        padding-bottom:18px;border-bottom:3px solid #4361ee;margin-bottom:26px}
  .brand{display:flex;align-items:center;gap:12px}
  .logo{width:46px;height:46px;border-radius:13px;background:#1e1e2d;color:#4361ee;
        display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800}
  .brand h1{font-size:21px;font-weight:800}
  .brand p{font-size:11.5px;color:#7e8299}
  .meta{text-align:end;font-size:11.5px;color:#7e8299;line-height:1.9}
  .meta strong{color:#2f3145;font-size:14px;display:block;margin-bottom:3px}

  h2.sec{font-size:15px;font-weight:800;margin:26px 0 12px;padding-inline-start:10px;
         border-inline-start:4px solid #4361ee}
  h2.sec:first-of-type{margin-top:0}

  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th{background:#f7f8fc;padding:9px 11px;text-align:start;font-weight:700;
     color:#5a5f75;font-size:11.5px;border-bottom:2px solid #e9ebf3}
  td{padding:9px 11px;border-bottom:1px solid #f2f4f9}
  tr:last-child td{border-bottom:0}
  .num{font-weight:700}
  .up{color:#14a37f;font-weight:700}
  .down{color:#f1416c;font-weight:700}
  .flat{color:#7e8299}

  .bars{display:flex;align-items:flex-end;gap:6px;height:130px;
        padding:12px;border:1px solid #e9ebf3;border-radius:10px;margin-top:8px}
  .barcol{flex:1;display:flex;flex-direction:column;align-items:center;
          justify-content:flex-end;gap:5px;height:100%}
  .bar{width:100%;max-width:26px;background:#4361ee;border-radius:4px 4px 0 0;min-height:2px}
  .barcol small{font-size:9px;color:#7e8299;white-space:nowrap}

  .note{border-inline-start:4px solid #4361ee;background:#f6f8ff;
        padding:11px 14px;border-radius:9px;margin-bottom:9px}
  .note strong{display:block;font-size:12.5px;margin-bottom:3px}
  .note span{font-size:12px;color:#4a4f66}

  .foot{margin-top:34px;padding-top:14px;border-top:1px solid #e9ebf3;
        font-size:10.5px;color:#a1a5b7;text-align:center}

  /* كل قسم مايتقسّمش على صفحتين */
  h2.sec,table,.bars,.note{break-inside:avoid;page-break-inside:avoid}
  h2.sec{break-after:avoid;page-break-after:avoid}

  @page{size:A4;margin:14mm}
  @media print{body{padding:0}}
</style></head><body>

<div class="head">
  <div class="brand">
    <div class="logo">⚡</div>
    <div>
      <h1>${esc(company)}</h1>
      <p>تقرير ${esc(PERIOD_LABEL[period] || "")} — Nexo CRM</p>
    </div>
  </div>
  <div class="meta">
    <strong>${esc(rangeLabel || "")}</strong>
    صدر في: ${esc(printedAt)}
  </div>
</div>

${metrics.length ? `
<h2 class="sec">المؤشرات الرئيسية</h2>
<table>
  <thead><tr><th>المؤشر</th><th>الفترة الحالية</th><th>الفترة السابقة</th><th>التغيير</th></tr></thead>
  <tbody>${metrics.map(metricRow).join("")}</tbody>
</table>` : ""}

${Object.keys(platforms).length ? `
<h2 class="sec">توزيع المحادثات حسب المنصة</h2>
<table>
  <thead><tr><th>المنصة</th><th>عدد المحادثات</th><th>النسبة</th></tr></thead>
  <tbody>${Object.values(platforms).map((p) => `
    <tr><td>${esc(p.label)}</td><td class="num">${fmtNum(p.count)}</td><td>${p.pct}%</td></tr>`).join("")}
  </tbody>
</table>` : ""}

${followers.length ? `
<h2 class="sec">المتابعين</h2>
<table>
  <thead><tr><th>المنصة</th><th>بداية الفترة</th><th>نهاية الفترة</th><th>الزيادة</th></tr></thead>
  <tbody>${followers.map((f) => {
    const g = (f.end || 0) - (f.start || 0);
    return `<tr><td>${esc(f.label)}</td><td class="num">${fmtNum(f.start)}</td>
      <td class="num">${fmtNum(f.end)}</td>
      <td class="${g > 0 ? "up" : g < 0 ? "down" : "flat"}">${g > 0 ? "+" : ""}${fmtNum(g)}</td></tr>`;
  }).join("")}</tbody>
</table>` : ""}

${daily.length > 1 ? `
<h2 class="sec">الحركة اليومية</h2>
<div class="bars">${barsHtml(daily)}</div>` : ""}

${insights.length ? `
<h2 class="sec">قراءة الأرقام</h2>
${insights.map((n) => `
  <div class="note"><strong>${esc(n.title)}</strong><span>${esc(n.body)}</span></div>`).join("")}` : ""}

<div class="foot">
  تقرير مُولّد تلقائياً من نظام Nexo · ${esc(printedAt)}
</div>
</body></html>`;
}

function metricRow(m) {
  const now = Number(m.now) || 0;
  const before = Number(m.before) || 0;
  const diff = before === 0 ? (now > 0 ? 100 : 0) : Math.round(((now - before) / before) * 100);
  // بعض المؤشرات كل ما قلّت كان أحسن (وقت الرد، الشكاوى)
  const improving = m.goodDown ? diff < 0 : diff > 0;
  const cls = diff === 0 ? "flat" : improving ? "up" : "down";
  const arrow = diff === 0 ? "—" : diff > 0 ? "▲" : "▼";
  const fmt = (v) => (m.money ? money(v) : fmtNum(v) + (m.unit || ""));
  return `<tr>
    <td>${esc(m.label)}</td>
    <td class="num">${fmt(now)}</td>
    <td>${fmt(before)}</td>
    <td class="${cls}">${arrow} ${Math.abs(diff)}%</td>
  </tr>`;
}

function barsHtml(days) {
  const recent = days.slice(-21);
  const max = Math.max(1, ...recent.map((d) => Number(d.conversations) || 0));
  return recent.map((d) => {
    const v = Number(d.conversations) || 0;
    return `<div class="barcol">
      <div class="bar" style="height:${Math.round((v / max) * 95)}%"></div>
      <small>${esc(String(d.date).slice(8))}</small>
    </div>`;
  }).join("");
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString("ar-EG");
}
