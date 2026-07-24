// ============================================================
//  إحصائيات الشركات (منشئ النظام)
//  مقارنات أسبوعية / شهرية / سنوية بالأرقام
// ============================================================
import {
  db, collection, doc, getDocs, query, orderBy, limit,
  fns, httpsCallable,
} from "../firebase.js";
import { session, isSuper } from "../auth.js";
import { PLATFORMS } from "../config.js";
import { el, card, esc, toast, money, spinner, emptyState, weekStart, fmtDate } from "../ui.js";

let companies = [];
let selectedId = null;
let period = "weekly";
let statsCache = {};

const PERIODS = {
  weekly:  { label: "أسبوعي", days: 7,   compare: "بالأسبوع اللي فات" },
  monthly: { label: "شهري",   days: 30,  compare: "بالشهر اللي فات" },
  yearly:  { label: "سنوي",   days: 365, compare: "بالسنة اللي فاتت" },
};

const METRICS = [
  { key: "customers",     label: "العملاء",          icon: "fa-users",         color: "#4361ee", good: "up" },
  { key: "conversations", label: "المحادثات",        icon: "fa-comments",      color: "#7239ea", good: "up" },
  { key: "orders",        label: "الطلبات",          icon: "fa-shopping-bag",  color: "#14a37f", good: "up" },
  { key: "revenue",       label: "قيمة الطلبات",     icon: "fa-sack-dollar",   color: "#14a37f", good: "up", money: true },
  { key: "avgResponseMin",label: "متوسط وقت الرد",   icon: "fa-clock",         color: "#f6a609", good: "down", unit: "د" },
  { key: "complaints",    label: "الشكاوى",          icon: "fa-face-frown",    color: "#f1416c", good: "down" },
  { key: "satisfaction",  label: "رضا العملاء",      icon: "fa-face-smile",    color: "#14a37f", good: "up", unit: "%" },
  { key: "aiHandled",     label: "رد آلي",           icon: "fa-robot",         color: "#4361ee", good: "up" },
];

export async function render(root) {
  if (!isSuper()) {
    root.append(el("p", { class: "text-muted", text: "الصفحة دي لمنشئ النظام فقط." }));
    return;
  }

  root.append(el("div", { class: "page-head" }, [
    el("div", {}, [
      el("h2", { text: "إحصائيات الشركات" }),
      el("div", { class: "sub", text: "أرقام كل شركة ومقارنتها بالفترة اللي قبلها — عشان تتكلم معاهم بالأرقام" }),
    ]),
    el("div", { class: "head-actions" }, [
      el("div", { class: "period-bar" }, Object.entries(PERIODS).map(([k, p]) => {
        const b = el("button", { class: k === period ? "active" : "", text: p.label });
        b.addEventListener("click", () => {
          period = k;
          root.querySelectorAll(".period-bar button").forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
          draw();
        });
        return b;
      })),
    ]),
  ]));

  const picker = el("div", { class: "card", style: "padding:12px;margin-bottom:16px" });
  const body = el("div");
  root.append(picker, body);

  picker.append(spinner("جاري تحميل الشركات..."));

  try {
    const snap = await getDocs(query(collection(db, "companies"), orderBy("name")));
    companies = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    picker.innerHTML = "";
    picker.append(el("p", { class: "text-muted", text: "تعذّر التحميل: " + e.message }));
    return;
  }

  if (!companies.length) {
    picker.remove();
    body.append(emptyState("fa-chart-line", "مفيش شركات لسه", "أضف شركة الأول عشان تشوف إحصائياتها."));
    return;
  }

  if (!selectedId || !companies.find((c) => c.id === selectedId)) selectedId = companies[0].id;

  // شرائح اختيار الشركة
  picker.innerHTML = "";
  const chips = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap" });
  companies.forEach((c) => {
    const b = el("button", { class: `chip${c.id === selectedId ? " active" : ""}`, text: c.name });
    b.addEventListener("click", () => {
      selectedId = c.id;
      chips.querySelectorAll(".chip").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      draw();
    });
    chips.append(b);
  });
  picker.append(chips);

  draw();

  async function draw() {
    body.innerHTML = "";
    body.append(spinner("جاري حساب الأرقام..."));

    const company = companies.find((c) => c.id === selectedId);
    let days;
    try {
      days = await loadStats(selectedId);
    } catch (e) {
      body.innerHTML = "";
      body.append(el("p", { class: "text-muted", text: "تعذّر تحميل الإحصائيات: " + e.message }));
      return;
    }

    body.innerHTML = "";

    const { cur, prev, curDays, label } = splitPeriods(days);

    // شريط علوي فيه اسم الشركة وزرار تحديث
    const head = el("div", { class: "card", style: "display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px" }, [
      el("div", {}, [
        el("strong", { style: "font-size:16px", text: company.name }),
        el("div", { class: "text-muted", style: "font-size:12.5px;margin-top:4px", text: label }),
      ]),
    ]);
    const refresh = el("button", { class: "btn btn-ghost btn-sm", html: '<i class="fas fa-rotate"></i> تحديث أرقام النهاردة' });
    refresh.addEventListener("click", async () => {
      refresh.disabled = true;
      refresh.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التحديث...';
      try {
        await httpsCallable(fns, "runRollupNow")({ companyId: selectedId });
        delete statsCache[selectedId];
        toast("تم تحديث الإحصائيات", "success");
        draw();
      } catch (e) {
        toast("فشل التحديث: " + (e.message || ""), "error");
        refresh.disabled = false;
        refresh.innerHTML = '<i class="fas fa-rotate"></i> تحديث أرقام النهاردة';
      }
    });
    head.append(refresh);
    body.append(head);

    if (!days.length) {
      body.append(emptyState("fa-chart-line", "مفيش بيانات لسه",
        "الإحصائيات بتتجمّع كل يوم الساعة 11:55 مساءً. اضغط «تحديث أرقام النهاردة» عشان تحسبها فوراً."));
      return;
    }

    body.append(metricsGrid(cur, prev));
    body.append(followersCard(days, company));
    body.append(trendCard(curDays));
    body.append(talkingPoints(cur, prev, company));
  }
}

// ---------- تحميل الإحصائيات ----------
async function loadStats(companyId) {
  if (statsCache[companyId]) return statsCache[companyId];
  const snap = await getDocs(query(
    collection(db, "companies", companyId, "stats"),
    orderBy("date", "desc"), limit(400)));
  const days = snap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
  statsCache[companyId] = days;
  return days;
}

/** تقسيم الأيام لفترة حالية وفترة سابقة */
function splitPeriods(days) {
  const n = PERIODS[period].days;
  const today = new Date(); today.setHours(0, 0, 0, 0);

  let from;
  if (period === "weekly") from = weekStart(today);
  else if (period === "monthly") from = new Date(today.getFullYear(), today.getMonth(), 1);
  else from = new Date(today.getFullYear(), 0, 1);

  const prevFrom = new Date(from);
  if (period === "weekly") prevFrom.setDate(prevFrom.getDate() - 7);
  else if (period === "monthly") prevFrom.setMonth(prevFrom.getMonth() - 1);
  else prevFrom.setFullYear(prevFrom.getFullYear() - 1);

  const iso = (d) => d.toISOString().slice(0, 10);
  const fromId = iso(from), prevFromId = iso(prevFrom);

  const curDays = days.filter((d) => d.date >= fromId);
  const prevDays = days.filter((d) => d.date >= prevFromId && d.date < fromId);

  const label = period === "weekly"
    ? `من السبت ${fmtDate(from)} لحد النهاردة`
    : period === "monthly" ? `من أول ${fmtDate(from)}` : `من أول السنة`;

  return { cur: aggregate(curDays), prev: aggregate(prevDays), curDays, label };
}

/** تجميع مجموعة أيام في أرقام واحدة */
function aggregate(days) {
  if (!days.length) return {};
  const sum = (k) => days.reduce((s, d) => s + (Number(d[k]) || 0), 0);
  const avg = (k) => {
    const vals = days.map((d) => Number(d[k]) || 0).filter((v) => v > 0);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  };
  return {
    customers: sum("customers"),
    conversations: sum("conversations"),
    orders: sum("orders"),
    revenue: sum("revenue"),
    complaints: sum("complaints"),
    aiHandled: sum("aiHandled"),
    humanReplies: sum("humanReplies"),
    posts: sum("posts"),
    avgResponseMin: avg("avgResponseMin"),
    satisfaction: avg("satisfaction"),
  };
}

// ---------- كروت المقارنة ----------
function metricsGrid(cur, prev) {
  const grid = el("div", { class: "grid grid-4" });

  METRICS.forEach((m) => {
    const now = Number(cur[m.key]) || 0;
    const before = Number(prev[m.key]) || 0;
    const diff = before === 0 ? (now > 0 ? 100 : 0) : Math.round(((now - before) / before) * 100);

    // بعض المؤشرات كل ما تقل كل ما كان أحسن (وقت الرد، الشكاوى)
    const improving = m.good === "down" ? diff < 0 : diff > 0;
    const cls = diff === 0 ? "" : improving ? "up" : "down";
    const arrow = diff === 0 ? "➖" : diff > 0 ? "⬆️" : "⬇️";
    const value = m.money ? money(now) : `${now.toLocaleString("ar-EG")}${m.unit || ""}`;

    grid.append(el("div", { class: "card stat-card" }, [
      el("div", { class: "stat-icon", style: `background:${m.color}1a;color:${m.color}` },
        [el("i", { class: `fas ${m.icon}` })]),
      el("div", { class: "stat-label", text: m.label }),
      el("div", { class: "stat-number", style: m.money ? "font-size:22px" : "", text: value }),
      el("div", { class: `stat-sub ${cls}`,
        text: `${arrow} ${Math.abs(diff)}% مقارنة ${PERIODS[period].compare}` }),
      el("div", { class: "text-muted", style: "font-size:11px;margin-top:2px",
        text: `الفترة السابقة: ${m.money ? money(before) : before + (m.unit || "")}` }),
    ]));
  });

  return grid;
}

// ---------- المتابعين ----------
function followersCard(days, company) {
  const box = card("المتابعين على المنصات");

  const withFollowers = days.filter((d) => d.followers && Object.keys(d.followers).length);
  if (!withFollowers.length) {
    box.append(el("p", { class: "text-muted",
      text: "مفيش أرقام متابعين لسه. الأرقام بتتجمّع تلقائياً كل 6 ساعات بعد ما تربط المنصة." }));
    box.append(el("p", { class: "hint",
      text: "تليجرام: عدد أعضاء القناة متاح دلوقتي ✅ · فيسبوك وانستجرام: هيتفعّلوا بعد موافقة ميتا 🔒 · واتساب: مالوش متابعين" }));
    return box;
  }

  const first = withFollowers[0].followers;
  const last = withFollowers[withFollowers.length - 1].followers;
  const platforms = [...new Set([...Object.keys(first), ...Object.keys(last)])];

  platforms.forEach((key) => {
    const p = PLATFORMS[key] || { label: key, color: "#7e8299", icon: "fas fa-users" };
    const start = Number(first[key]) || 0;
    const end = Number(last[key]) || 0;
    const growth = end - start;
    const pct = start ? Math.round((growth / start) * 100) : (end > 0 ? 100 : 0);

    box.append(el("div", { style: "display:flex;align-items:center;gap:14px;padding:13px 0;border-bottom:1px solid #f2f4f9;flex-wrap:wrap" }, [
      el("div", { style: `width:40px;height:40px;border-radius:11px;display:flex;align-items:center;justify-content:center;background:${p.color}1a;color:${p.color};font-size:17px`,
        html: `<i class="${p.icon}"></i>` }),
      el("div", { style: "flex:1;min-width:140px" }, [
        el("strong", { style: "font-size:14px", text: p.label }),
        el("div", { class: "text-muted", style: "font-size:12px;margin-top:3px",
          text: `من ${start.toLocaleString("ar-EG")} لـ ${end.toLocaleString("ar-EG")}` }),
      ]),
      el("div", { style: "text-align:end" }, [
        el("strong", { style: `font-size:17px;color:${growth >= 0 ? "var(--success)" : "var(--danger)"}`,
          text: `${growth >= 0 ? "+" : ""}${growth.toLocaleString("ar-EG")}` }),
        el("div", { class: "text-muted", style: "font-size:11.5px", text: `${pct >= 0 ? "+" : ""}${pct}%` }),
      ]),
    ]));
  });

  return box;
}

// ---------- الرسم البياني اليومي ----------
function trendCard(days) {
  const box = card("الحركة اليومية");
  if (days.length < 2) {
    box.append(el("p", { class: "text-muted", text: "محتاجين يومين على الأقل عشان نرسم الاتجاه." }));
    return box;
  }

  const recent = days.slice(-14);
  const max = Math.max(1, ...recent.map((d) => Number(d.conversations) || 0));

  const chart = el("div", { class: "mini-bar", style: "height:170px" });
  recent.forEach((d) => {
    const v = Number(d.conversations) || 0;
    const col = el("div", { class: "bar-col" }, [
      el("div", { class: "bar", style: `height:${(v / max) * 120}px`, title: `${d.date}: ${v} محادثة` }),
      el("small", { text: d.date.slice(8) }),
    ]);
    chart.append(col);
  });

  box.append(chart);
  box.append(el("p", { class: "hint", style: "text-align:center", text: "عدد المحادثات في آخر 14 يوم" }));
  return box;
}

// ---------- نقاط الكلام مع الشركة ----------
function talkingPoints(cur, prev, company) {
  const box = card("نقاط تتكلم بيها مع الشركة");
  const points = [];

  const change = (k) => {
    const now = Number(cur[k]) || 0, before = Number(prev[k]) || 0;
    if (before === 0) return now > 0 ? 100 : 0;
    return Math.round(((now - before) / before) * 100);
  };

  const convDiff = change("conversations");
  const orderDiff = change("orders");
  const respDiff = change("avgResponseMin");

  if (cur.aiHandled > 0) {
    const total = (cur.aiHandled || 0) + (cur.humanReplies || 0);
    const pct = total ? Math.round((cur.aiHandled / total) * 100) : 0;
    points.push({ type: "", t: "البوت وفّر شغل فعلي",
      m: `النظام رد لوحده على ${cur.aiHandled.toLocaleString("ar-EG")} محادثة — يعني ${pct}% من الشغل اتعمل من غير موظف.` });
  }

  if (cur.avgResponseMin > 0) {
    points.push({ type: respDiff < 0 ? "" : "warn", t: "سرعة الرد",
      m: respDiff < 0
        ? `متوسط الرد بقى ${cur.avgResponseMin} دقيقة، وقلّ ${Math.abs(respDiff)}% ${PERIODS[period].compare}.`
        : `متوسط الرد ${cur.avgResponseMin} دقيقة${respDiff > 0 ? ` — زاد ${respDiff}% ${PERIODS[period].compare}` : ""}.` });
  }

  if (orderDiff !== 0 && (cur.orders || prev.orders)) {
    points.push({ type: orderDiff > 0 ? "" : "warn", t: "الطلبات",
      m: `${cur.orders} طلب بقيمة ${money(cur.revenue)} — ${orderDiff > 0 ? "زيادة" : "نقص"} ${Math.abs(orderDiff)}% ${PERIODS[period].compare}.` });
  }

  if (cur.satisfaction) {
    points.push({ type: cur.satisfaction >= 85 ? "" : "warn", t: "رضا العملاء",
      m: `${cur.satisfaction}% من المحادثات مافيهاش شكاوى${cur.complaints ? ` — وفيه ${cur.complaints} شكوى محتاجة متابعة` : ""}.` });
  }

  if (convDiff <= -25) {
    points.push({ type: "danger", t: "التفاعل نازل",
      m: `المحادثات قلّت ${Math.abs(convDiff)}% ${PERIODS[period].compare}. محتاجين نشاط أكتر على الصفحة.` });
  }

  if (!points.length) {
    points.push({ type: "", t: "لسه بدري",
      m: "الأرقام لسه قليلة. بعد أسبوع شغل هتلاقي هنا مقارنات تنفع تتكلم بيها." });
  }

  points.forEach((p) => {
    box.append(el("div", { class: `ai-insight ${p.type}`, style: "margin-bottom:10px",
      html: `<strong>${esc(p.t)}</strong>${esc(p.m)}` }));
  });

  return box;
}

export function destroy() {
  companies = [];
  statsCache = {};
  selectedId = null;
  period = "weekly";
}
