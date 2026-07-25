// ============================================================
//  التحليلات والتقارير — مقارنة يومي / أسبوعي / شهري / سنوي
//  الأسبوع عندنا: السبت → الجمعة
// ============================================================
import { db, collection, getDocs, query, where, orderBy, limit } from "../firebase.js";
import { session, tenantPath, hasFeature } from "../auth.js";
import { PLATFORMS } from "../config.js";
import { el, card, esc, money, spinner, toast, weekStart, fmtDate, emptyState } from "../ui.js";
import { openReport } from "../report.js";

let period = "daily";
let lastData = null;   // آخر بيانات محسوبة — بيستخدمها التقرير

const PERIODS = {
  daily:   { label: "يومي",   compare: "بالأمس" },
  weekly:  { label: "أسبوعي", compare: "بالأسبوع اللي فات" },
  monthly: { label: "شهري",   compare: "بالشهر اللي فات" },
  yearly:  { label: "سنوي",   compare: "بالسنة اللي فاتت" },
};

export async function render(root) {
  root.append(el("div", { class: "page-head" }, [
    el("div", {}, [
      el("h2", { text: "التحليلات والتقارير" }),
      el("div", { class: "sub", text: "بداية الأسبوع: السبت — نهايته: الجمعة" }),
    ]),
    el("div", { class: "head-actions" }, [
      el("div", { class: "period-bar" }, Object.entries(PERIODS).map(([k, p]) => {
        const b = el("button", { class: k === period ? "active" : "", text: p.label });
        b.addEventListener("click", () => {
          period = k;
          root.querySelectorAll(".period-bar button").forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
          load(body);
        });
        return b;
      })),
      hasFeature("canUseReports")
        ? mkBtn("تقرير للطباعة", "btn-ghost", "fa-file-pdf", printReport)
        : null,
    ].filter(Boolean)),
  ]));

  const body = el("div");
  root.append(body);
  await load(body);
}

function ranges() {
  const now = new Date();
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  let curFrom, prevFrom, prevTo;

  if (period === "daily") {
    curFrom = startOfDay(now);
    prevFrom = new Date(curFrom); prevFrom.setDate(prevFrom.getDate() - 1);
    prevTo = curFrom;
  } else if (period === "weekly") {
    curFrom = weekStart(now);
    prevFrom = new Date(curFrom); prevFrom.setDate(prevFrom.getDate() - 7);
    prevTo = curFrom;
  } else if (period === "monthly") {
    curFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    prevFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    prevTo = curFrom;
  } else {
    curFrom = new Date(now.getFullYear(), 0, 1);
    prevFrom = new Date(now.getFullYear() - 1, 0, 1);
    prevTo = curFrom;
  }
  return { curFrom, curTo: now, prevFrom, prevTo };
}

async function load(body) {
  body.innerHTML = "";
  body.append(spinner("جاري حساب الإحصائيات..."));

  const { curFrom, prevFrom, prevTo } = ranges();

  try {
    // بنجيب بيانات الفترة الحالية والسابقة مرة واحدة ونقسّمها محلياً
    const [convSnap, orderSnap] = await Promise.all([
      getDocs(query(collection(db, ...tenantPath("conversations")),
        where("lastMessageAt", ">=", prevFrom), orderBy("lastMessageAt", "desc"), limit(1000))),
      getDocs(query(collection(db, ...tenantPath("orders")),
        where("createdAt", ">=", prevFrom), orderBy("createdAt", "desc"), limit(1000))),
    ]);

    const convs = convSnap.docs.map((d) => d.data());
    const orders = orderSnap.docs.map((d) => d.data());

    const inRange = (ts, from, to) => {
      const d = ts?.toDate ? ts.toDate() : new Date(ts);
      return d >= from && (!to || d < to);
    };

    const cur = {
      convs: convs.filter((c) => inRange(c.lastMessageAt, curFrom)),
      orders: orders.filter((o) => inRange(o.createdAt, curFrom)),
    };
    const prev = {
      convs: convs.filter((c) => inRange(c.lastMessageAt, prevFrom, prevTo)),
      orders: orders.filter((o) => inRange(o.createdAt, prevFrom, prevTo)),
    };

    body.innerHTML = "";

    if (!convs.length && !orders.length) {
      body.append(emptyState("fa-chart-pie", "مفيش بيانات كفاية للتحليل",
        "أول ما المحادثات والطلبات تبدأ تنزل، هتلاقي هنا مقارنات ونصايح ذكية."));
      return;
    }

    lastData = { cur, prev, curFrom };   // للتقرير المطبوع

    body.append(statsGrid(cur, prev));
    body.append(chartCard(cur, prev));
    body.append(breakdownCard(cur));
    body.append(insightCard(cur, prev));
  } catch (e) {
    body.innerHTML = "";
    const msg = String(e.message || "");
    body.append(el("div", { class: "ai-insight danger", html:
      `<strong>تعذّر حساب الإحصائيات</strong>${esc(msg)}${
        msg.includes("index") ? "<br><br>لو الرسالة بتطلب Index، افتح اللينك اللي في Console وفايربيز هيعمله لوحده." : ""}` }));
  }
}

function statsGrid(cur, prev) {
  const grid = el("div", { class: "grid grid-4" });
  const aiCount = (list) => list.filter((c) => c.status === "ai_handled").length;
  const humanCount = (list) => list.filter((c) => ["in_progress", "resolved", "needs_human"].includes(c.status)).length;
  const complaints = (list) => list.filter((c) => c.isComplaint).length;
  const revenue = (list) => list.reduce((s, o) => s + (Number(o.total) || 0), 0);

  const defs = [
    { label: "إجمالي المحادثات", now: cur.convs.length, before: prev.convs.length, icon: "fa-comments", color: "#4361ee" },
    { label: "رد آلي (AI)", now: aiCount(cur.convs), before: aiCount(prev.convs), icon: "fa-robot", color: "#7239ea" },
    { label: "رد يدوي / شكاوى", now: humanCount(cur.convs) , before: humanCount(prev.convs), icon: "fa-headset", color: "#f6a609" },
    { label: "الطلبات", now: cur.orders.length, before: prev.orders.length, icon: "fa-shopping-bag", color: "#14a37f" },
  ];

  defs.forEach((d) => {
    const diff = d.before === 0 ? (d.now > 0 ? 100 : 0) : Math.round(((d.now - d.before) / d.before) * 100);
    const cls = diff > 0 ? "up" : diff < 0 ? "down" : "";
    const arrow = diff > 0 ? "⬆️" : diff < 0 ? "⬇️" : "➖";
    grid.append(el("div", { class: "card stat-card" }, [
      el("div", { class: "stat-icon", style: `background:${d.color}1a;color:${d.color}` }, [el("i", { class: `fas ${d.icon}` })]),
      el("div", { class: "stat-label", text: d.label }),
      el("div", { class: "stat-number", text: d.now.toLocaleString("ar-EG") }),
      el("div", { class: `stat-sub ${cls}`, text: `${arrow} ${Math.abs(diff)}% مقارنة ${PERIODS[period].compare}` }),
    ]));
  });

  // كارت الإيرادات
  const rev = revenue(cur.orders), revPrev = revenue(prev.orders);
  const revDiff = revPrev === 0 ? (rev > 0 ? 100 : 0) : Math.round(((rev - revPrev) / revPrev) * 100);
  grid.append(el("div", { class: "card stat-card" }, [
    el("div", { class: "stat-icon", style: "background:#14a37f1a;color:#14a37f" }, [el("i", { class: "fas fa-sack-dollar" })]),
    el("div", { class: "stat-label", text: "قيمة الطلبات" }),
    el("div", { class: "stat-number", style: "font-size:24px", text: money(rev) }),
    el("div", { class: `stat-sub ${revDiff > 0 ? "up" : revDiff < 0 ? "down" : ""}`,
      text: `${revDiff > 0 ? "⬆️" : revDiff < 0 ? "⬇️" : "➖"} ${Math.abs(revDiff)}% مقارنة ${PERIODS[period].compare}` }),
  ]));

  return grid;
}

function chartCard(cur, prev) {
  const box = card(`مقارنة ${PERIODS[period].label}`);
  const rows = [
    { label: "المحادثات", now: cur.convs.length, before: prev.convs.length },
    { label: "الطلبات", now: cur.orders.length, before: prev.orders.length },
    { label: "الشكاوى", now: cur.convs.filter((c) => c.isComplaint).length, before: prev.convs.filter((c) => c.isComplaint).length },
  ];
  const max = Math.max(1, ...rows.flatMap((r) => [r.now, r.before]));

  const chart = el("div", { class: "mini-bar" });
  rows.forEach((r) => {
    const group = el("div", { class: "bar-col" }, [
      el("div", { style: "display:flex;gap:5px;align-items:flex-end;width:100%;justify-content:center;height:100px" }, [
        el("div", { class: "bar prev", style: `height:${(r.before / max) * 100}%;max-width:26px`, title: `السابق: ${r.before}` }),
        el("div", { class: "bar", style: `height:${(r.now / max) * 100}%;max-width:26px`, title: `الحالي: ${r.now}` }),
      ]),
      el("small", { text: `${r.label} (${r.before} → ${r.now})` }),
    ]);
    chart.append(group);
  });

  box.append(chart);
  box.append(el("div", { style: "display:flex;gap:16px;justify-content:center;font-size:12px;color:var(--muted)" }, [
    el("span", { html: '<span style="display:inline-block;width:11px;height:11px;background:#d5daea;border-radius:3px;margin-inline-end:5px"></span>الفترة السابقة' }),
    el("span", { html: '<span style="display:inline-block;width:11px;height:11px;background:var(--primary);border-radius:3px;margin-inline-end:5px"></span>الفترة الحالية' }),
  ]));
  return box;
}

function breakdownCard(cur) {
  const box = card("توزيع المحادثات حسب المنصة");
  const counts = {};
  cur.convs.forEach((c) => { counts[c.platform] = (counts[c.platform] || 0) + 1; });
  const total = cur.convs.length || 1;

  if (!Object.keys(counts).length) {
    box.append(el("p", { class: "text-muted", text: "مفيش محادثات في الفترة دي." }));
    return box;
  }

  Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([key, n]) => {
    const p = PLATFORMS[key] || { label: key, color: "#7e8299", icon: "fas fa-comment" };
    const pct = Math.round((n / total) * 100);
    box.append(el("div", { style: "margin-bottom:14px" }, [
      el("div", { style: "display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px" }, [
        el("span", { html: `<i class="${p.icon}" style="color:${p.color};margin-inline-end:6px"></i>${esc(p.label)}` }),
        el("strong", { text: `${n} (${pct}%)` }),
      ]),
      el("div", { style: "height:7px;background:#f1f3f8;border-radius:5px;overflow:hidden" }, [
        el("div", { style: `height:100%;width:${pct}%;background:${p.color};border-radius:5px` }),
      ]),
    ]));
  });
  return box;
}

function insightCard(cur, prev) {
  const box = card("قراءة سريعة للأرقام");
  const diff = prev.convs.length === 0 ? 0
    : Math.round(((cur.convs.length - prev.convs.length) / prev.convs.length) * 100);
  const complaints = cur.convs.filter((c) => c.isComplaint).length;
  const pending = cur.convs.filter((c) => c.status === "needs_human").length;

  const notes = [];
  if (diff <= -25) notes.push({ type: "danger", t: "التفاعل نازل",
    m: `المحادثات نزلت ${Math.abs(diff)}% مقارنة ${PERIODS[period].compare}. جرّب تنزل بوست أو ريلز جديد ينشّط الصفحة.` });
  else if (diff >= 25) notes.push({ type: "", t: "التفاعل طالع",
    m: `المحادثات زادت ${diff}% مقارنة ${PERIODS[period].compare}. استغل الزخم ده ونزّل عرض.` });

  if (pending > 0) notes.push({ type: "warn", t: "رسائل مستنية رد",
    m: `فيه ${pending} محادثة محتاجة رد يدوي. كل ما الرد يتأخر، احتمال العميل يروح يشتري من حد تاني.` });

  if (complaints > 0) notes.push({ type: "danger", t: "شكاوى مفتوحة",
    m: `${complaints} شكوى في الفترة دي. راجعها من صندوق الرسائل واقفلها قبل ما تتراكم.` });

  if (!cur.orders.length && cur.convs.length > 5) notes.push({ type: "warn", t: "تفاعل من غير مبيعات",
    m: "فيه محادثات بس مفيش طلبات اتسجلت. ممكن الأسعار مش واضحة أو البوت مش بيقفل الأوردر." });

  if (!notes.length) notes.push({ type: "", t: "الوضع مستقر", m: "الأرقام في المعدل الطبيعي، مفيش حاجة محتاجة تدخل عاجل." });

  notes.forEach((n) => {
    box.append(el("div", { class: `ai-insight ${n.type}`, style: "margin-bottom:10px",
      html: `<strong>${esc(n.t)}</strong>${esc(n.m)}` }));
  });

  if (!hasFeature("canUseReports")) {
    box.append(el("p", { class: "hint",
      text: "ملحوظة: التقارير الآلية بصيغة PDF والنصايح المكتوبة بالذكاء الاصطناعي بتتفعّل من ميزات الشركة." }));
  }
  return box;
}

// ---------- تقرير مستقل للطباعة ----------
function printReport() {
  if (!lastData) return toast("استنى لحد ما البيانات تتحمّل", "warn");
  const { cur, prev, curFrom } = lastData;

  const aiCount = (l) => l.filter((c) => c.status === "ai_handled").length;
  const humanCount = (l) => l.filter((c) => ["in_progress", "resolved", "needs_human"].includes(c.status)).length;
  const complaints = (l) => l.filter((c) => c.isComplaint).length;
  const revenue = (l) => l.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const customers = (l) => new Set(l.map((c) => c.externalId).filter(Boolean)).size;

  const metrics = [
    { label: "إجمالي المحادثات", now: cur.convs.length, before: prev.convs.length },
    { label: "العملاء", now: customers(cur.convs), before: customers(prev.convs) },
    { label: "رد آلي بالذكاء الاصطناعي", now: aiCount(cur.convs), before: aiCount(prev.convs) },
    { label: "محتاجة تدخل بشري", now: humanCount(cur.convs), before: humanCount(prev.convs), goodDown: true },
    { label: "الشكاوى", now: complaints(cur.convs), before: complaints(prev.convs), goodDown: true },
    { label: "الطلبات", now: cur.orders.length, before: prev.orders.length },
    { label: "قيمة الطلبات", now: revenue(cur.orders), before: revenue(prev.orders), money: true },
  ];

  // التوزيع حسب المنصة
  const counts = {};
  cur.convs.forEach((c) => { counts[c.platform] = (counts[c.platform] || 0) + 1; });
  const total = cur.convs.length || 1;
  const platforms = {};
  Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => {
    platforms[k] = { label: PLATFORMS[k]?.label || k, count: n, pct: Math.round((n / total) * 100) };
  });

  // الحركة اليومية
  const byDay = {};
  cur.convs.forEach((c) => {
    const d = c.lastMessageAt?.toDate ? c.lastMessageAt.toDate() : new Date(c.lastMessageAt);
    if (isNaN(d)) return;
    const key = d.toISOString().slice(0, 10);
    byDay[key] = (byDay[key] || 0) + 1;
  });
  const daily = Object.entries(byDay).sort().map(([date, n]) => ({ date, conversations: n }));

  // نفس منطق القراءة اللي في الشاشة
  const insights = [];
  const diff = prev.convs.length === 0 ? 0
    : Math.round(((cur.convs.length - prev.convs.length) / prev.convs.length) * 100);
  const pending = cur.convs.filter((c) => c.status === "needs_human").length;
  const compl = complaints(cur.convs);

  if (diff <= -25) insights.push({ title: "التفاعل نازل",
    body: `المحادثات نزلت ${Math.abs(diff)}% مقارنة ${PERIODS[period].compare}.` });
  else if (diff >= 25) insights.push({ title: "التفاعل طالع",
    body: `المحادثات زادت ${diff}% مقارنة ${PERIODS[period].compare}.` });

  if (aiCount(cur.convs) > 0) {
    const t = aiCount(cur.convs) + humanCount(cur.convs);
    insights.push({ title: "الرد الآلي وفّر شغل",
      body: `النظام رد لوحده على ${aiCount(cur.convs)} محادثة — يعني ${t ? Math.round((aiCount(cur.convs) / t) * 100) : 0}% من الشغل اتعمل من غير موظف.` });
  }
  if (pending > 0) insights.push({ title: "رسائل مستنية رد",
    body: `فيه ${pending} محادثة محتاجة رد يدوي.` });
  if (compl > 0) insights.push({ title: "شكاوى مفتوحة",
    body: `${compl} شكوى في الفترة دي محتاجة متابعة.` });
  if (!insights.length) insights.push({ title: "الوضع مستقر",
    body: "الأرقام في المعدل الطبيعي، مفيش حاجة محتاجة تدخل عاجل." });

  openReport({
    period,
    rangeLabel: `من ${fmtDate(curFrom)} — تقرير ${PERIODS[period].label}`,
    metrics, platforms, daily, insights,
    followers: [],
  });
}

function mkBtn(label, cls, icon, onClick) {
  const b = el("button", { class: `btn ${cls}` }, [icon ? el("i", { class: `fas ${icon}` }) : null, label || null]);
  b.addEventListener("click", onClick);
  return b;
}

export function destroy() { period = "daily"; lastData = null; }
