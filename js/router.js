// ============================================================
//  التنقل بين الشاشات + بناء القائمة الجانبية حسب الصلاحيات
// ============================================================
import { NAV } from "./config.js";
import { session, canSee } from "./auth.js";
import { el, spinner, emptyState } from "./ui.js";

const loaders = {
  dashboard: () => import("./screens/dashboard.js"),
  companies: () => import("./screens/companies.js"),
  inbox:     () => import("./screens/inbox.js"),
  publisher: () => import("./screens/publisher.js"),
  orders:    () => import("./screens/orders.js"),
  products:  () => import("./screens/products.js"),
  ai:        () => import("./screens/ai.js"),
  analytics: () => import("./screens/analytics.js"),
  users:     () => import("./screens/users.js"),
  settings:  () => import("./screens/settings.js"),
};

let current = null;      // { id, mod }
let container, sidebarList, titleNode;

export function initRouter({ mount, navMount, pageTitle }) {
  container = mount;
  sidebarList = navMount;
  titleNode = pageTitle;
  buildNav();
  window.addEventListener("hashchange", () => go(routeFromHash(), false));
  go(routeFromHash(), false);
}

function routeFromHash() {
  const id = (location.hash || "").replace(/^#\/?/, "").split("?")[0];
  return id || "dashboard";
}

export function buildNav() {
  if (!sidebarList) return;
  sidebarList.innerHTML = "";
  const visible = NAV.filter(canSee);
  visible.forEach((item) => {
    const li = el("li", { "data-id": item.id, class: item.id === current?.id ? "active" : "" }, [
      el("i", { class: `fas ${item.icon}` }),
      el("span", { text: item.label }),
      item.badge ? el("span", { class: "badge admin-badge", text: item.badge }) : null,
    ]);
    li.addEventListener("click", () => go(item.id));
    sidebarList.append(li);
  });
}

export async function go(id, updateHash = true) {
  const item = NAV.find((n) => n.id === id);

  // لو الشاشة مش موجودة أو ممنوعة → الرئيسية
  if (!item || !canSee(item)) {
    if (id !== "dashboard") return go("dashboard");
  }
  const target = item && canSee(item) ? item : NAV[0];

  if (updateHash && location.hash !== `#/${target.id}`) {
    location.hash = `#/${target.id}`;
    return; // hashchange هيرجع ينادي go
  }

  // تنظيف الشاشة السابقة (إلغاء أي listeners شغالة)
  try { current?.mod?.destroy?.(); } catch (e) { console.warn(e); }
  current = { id: target.id, mod: null };

  sidebarList?.querySelectorAll("li").forEach((li) =>
    li.classList.toggle("active", li.dataset.id === target.id));
  if (titleNode) titleNode.textContent = target.label;
  document.title = `${target.label} | Nexo`;

  container.innerHTML = "";
  container.append(spinner());

  // كل الشاشات ما عدا "إدارة الشركات" محتاجة شركة مختارة
  if (target.id !== "companies" && !session.companyId) {
    container.innerHTML = "";
    const btn = el("button", { class: "btn btn-primary", text: "اذهب لإدارة الشركات" });
    btn.addEventListener("click", () => go("companies"));
    container.append(emptyState("fa-building", "مفيش شركة مختارة",
      "اختار شركة من صفحة إدارة الشركات عشان تشتغل على بياناتها.", btn));
    return;
  }

  try {
    const mod = await loaders[target.id]();
    if (current.id !== target.id) return; // المستخدم غيّر الشاشة أثناء التحميل
    current.mod = mod;
    container.innerHTML = "";
    await mod.render(container);
  } catch (err) {
    console.error(err);
    container.innerHTML = "";
    container.append(emptyState("fa-triangle-exclamation", "حصلت مشكلة في تحميل الشاشة", err.message));
  }
}

export function reloadCurrent() {
  const id = current?.id || "dashboard";
  current = null;
  go(id, false);
}
