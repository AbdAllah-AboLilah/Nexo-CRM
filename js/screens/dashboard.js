// ============================================================
//  الشاشة الرئيسية
// ============================================================
import { db, collection, getDocs, query, where, orderBy, limit } from "../firebase.js";
import { session, isSuper, tenantPath } from "../auth.js";
import { el, card, esc, fmtTimeAgo, money, emptyState } from "../ui.js";
import { go } from "../router.js";
import { ROLES } from "../config.js";

export async function render(root) {
  const c = session.company;

  root.append(el("div", { class: "page-head" }, [
    el("div", {}, [
      el("h2", { text: `أهلاً ${session.profile.name || ""} 👋` }),
      el("div", { class: "sub", text: c ? `شغال دلوقتي على: ${c.name}` : "مفيش شركة مختارة" }),
    ]),
  ]));

  const stats = el("div", { class: "grid grid-4" });
  root.append(stats);

  const statDefs = [
    { key: "conversations", label: "محادثات نشطة",  icon: "fa-comments",      color: "#4361ee" },
    { key: "needsHuman",    label: "محتاجة رد يدوي", icon: "fa-hand",          color: "#f6a609" },
    { key: "orders",        label: "طلبات جديدة",    icon: "fa-shopping-bag",  color: "#14a37f" },
    { key: "products",      label: "الأصناف",        icon: "fa-box-open",      color: "#7239ea" },
  ];
  const nodes = {};
  statDefs.forEach((s) => {
    const n = el("div", { class: "card stat-card" }, [
      el("div", { class: "stat-icon", style: `background:${s.color}1a;color:${s.color}` }, [el("i", { class: `fas ${s.icon}` })]),
      el("div", { class: "stat-label", text: s.label }),
      el("div", { class: "stat-number", text: "—" }),
      el("div", { class: "stat-sub", text: "" }),
    ]);
    nodes[s.key] = n;
    stats.append(n);
  });

  const lower = el("div", { class: "grid grid-2", style: "margin-top:18px" });
  root.append(lower);

  const recentBox = card("آخر المحادثات");
  const tasksBox = card("خطوات مقترحة");
  lower.append(recentBox, tasksBox);

  buildTasks(tasksBox);

  if (!session.companyId) return;

  try {
    const [convSnap, ordersSnap, prodSnap] = await Promise.all([
      getDocs(query(collection(db, ...tenantPath("conversations")), orderBy("lastMessageAt", "desc"), limit(50))),
      getDocs(query(collection(db, ...tenantPath("orders")), where("status", "==", "new"))),
      getDocs(collection(db, ...tenantPath("products"))),
    ]);

    const convs = convSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setStat(nodes.conversations, convs.length);
    setStat(nodes.needsHuman, convs.filter((x) => x.status === "needs_human").length);
    setStat(nodes.orders, ordersSnap.size);
    setStat(nodes.products, prodSnap.size);

    renderRecent(recentBox, convs.slice(0, 6));
  } catch (err) {
    console.error(err);
    recentBox.append(el("p", { class: "text-muted", text: "تعذّر تحميل البيانات: " + err.message }));
  }
}

function setStat(node, value) {
  node.querySelector(".stat-number").textContent = Number(value).toLocaleString("ar-EG");
}

function renderRecent(box, convs) {
  if (!convs.length) {
    box.append(el("p", { class: "text-muted", text: "مفيش محادثات لسه. أول ما نربط المنصات هتظهر هنا لحظياً." }));
    return;
  }
  const list = el("div", { class: "chat-items", style: "max-height:300px" });
  convs.forEach((cv) => {
    const item = el("div", { class: "chat-item" }, [
      el("div", { class: "chat-item-top" }, [
        el("h4", {}, [el("span", { class: "name", text: cv.customerName || "عميل" })]),
        el("time", { text: fmtTimeAgo(cv.lastMessageAt) }),
      ]),
      el("p", { text: cv.lastMessage || "" }),
    ]);
    item.addEventListener("click", () => go("inbox"));
    list.append(item);
  });
  box.append(list);
}

function buildTasks(box) {
  const c = session.company;
  const tasks = [];

  if (isSuper() && !c) tasks.push({ t: "أضف أول شركة على النظام", s: "من شاشة إدارة الشركات", go: "companies" });
  if (c && !c.constants?.address) tasks.push({ t: "اكتب الثوابت (العنوان والمواعيد وأرقام التواصل)", s: "الذكاء الاصطناعي بيستخدمها في الرد", go: "settings" });
  if (c && !c.ai?.businessType) tasks.push({ t: "حدد نبرة الرد ونشاط الشركة", s: "عشان ردود البوت تطلع مظبوطة", go: "ai" });
  tasks.push({ t: "ارفع ملف الأصناف والأسعار", s: "Excel أو CSV بضغطة زر", go: "products" });
  tasks.push({ t: "اربط قناة تليجرام", s: "أسرع منصة للتشغيل — من إعدادات الشركة", go: "settings" });

  tasks.slice(0, 4).forEach((t) => {
    const row = el("div", { class: "tenant-item" }, [
      el("i", { class: "fas fa-circle-check" }),
      el("div", {}, [el("strong", { text: t.t }), el("small", { text: t.s })]),
    ]);
    row.addEventListener("click", () => go(t.go));
    box.append(row);
  });
}
