// ============================================================
//  نقطة تشغيل النظام (App Shell)
// ============================================================
import { APP_VERSION, ROLES } from "./config.js";
import { guard, session, logout, isSuper, switchTenant } from "./auth.js";
import { onNetworkState, db, collection, getDocs, query, orderBy } from "./firebase.js";
import { initRouter, buildNav, go, reloadCurrent } from "./router.js";
import { initNotifications } from "./notifications.js";
import { el, toast, modal, esc } from "./ui.js";

const $ = (id) => document.getElementById(id);

// رقم إصدار النظام — بيتولّد أوتوماتيك وقت الرفع (version.json)
let SYSTEM_VERSION = { full: `v${APP_VERSION}`, build: 0, builtAt: "" };

async function loadSystemVersion() {
  try {
    const res = await fetch("version.json", { cache: "no-cache" });
    if (res.ok) SYSTEM_VERSION = await res.json();
  } catch { /* أوفلاين — نستخدم رقم config */ }
  // كل الشركات بتشوف إصدار النظام الحالي — التحكم في الميزات مش في الرقم
  $("appVersion").textContent = SYSTEM_VERSION.full;
  $("appVersion").title = SYSTEM_VERSION.builtAt
    ? `آخر تحديث: ${SYSTEM_VERSION.builtAt}` : "";
}
window.nexoSystemVersion = () => SYSTEM_VERSION;

(async function boot() {
  await guard();

  // ---------- بيانات المستخدم في الشريط العلوي ----------
  $("userName").textContent = session.profile.name || session.user.email;
  $("userRole").textContent = ROLES[session.profile.role]?.label || "";
  $("userAvatar").textContent = (session.profile.name || "N").trim().charAt(0).toUpperCase();
  loadSystemVersion();

  renderTenantChip();

  // ---------- القائمة الجانبية والموبايل ----------
  const sidebar = $("sidebar");
  const scrim = $("scrim");
  $("menuToggle").addEventListener("click", () => {
    sidebar.classList.add("open"); scrim.classList.add("show");
  });
  scrim.addEventListener("click", closeSidebar);
  function closeSidebar() { sidebar.classList.remove("open"); scrim.classList.remove("show"); }
  window.addEventListener("hashchange", () => { if (window.innerWidth <= 900) closeSidebar(); });

  // ---------- أيقونات الجهاز ----------
  function checkDevice() {
    const mobile = window.innerWidth <= 900;
    $("mobileIcon").classList.toggle("active", mobile);
    $("desktopIcon").classList.toggle("active", !mobile);
  }
  checkDevice();
  window.addEventListener("resize", checkDevice);

  // ---------- نقطة حالة الاتصال ----------
  const dot = $("networkDot"), netText = $("networkText");
  const states = {
    offline: { cls: "dot-red",    text: "أوفلاين — تخزين محلي" },
    syncing: { cls: "dot-yellow", text: "جاري المزامنة..." },
    online:  { cls: "dot-green",  text: "متصل" },
  };
  onNetworkState((s) => {
    const st = states[s];
    dot.className = `status-dot ${st.cls}`;
    netText.textContent = st.text;
    netText.className = `net-text ${st.cls}-text`;
    // في الموبايل النص مخفي، فالنقطة نفسها بتحمل الحالة
    dot.parentElement.title = st.text;
  });

  // ---------- قائمة المستخدم ----------
  const userMenu = $("userMenu");
  $("userProfile").addEventListener("click", (e) => { e.stopPropagation(); userMenu.classList.toggle("show"); });
  document.addEventListener("click", () => userMenu.classList.remove("show"));
  $("btnLogout").addEventListener("click", logout);
  $("btnAbout").addEventListener("click", showAbout);

  // ---------- الإشعارات ----------
  initNotifications({ button: $("notifBtn"), badge: $("notifBadge"), panel: $("notifPanel") });

  // ---------- التوجيه ----------
  initRouter({ mount: $("screen"), navMount: $("navLinks"), pageTitle: $("pageTitle") });

  // إتاحة تبديل الشركة لباقي الشاشات
  window.nexoSwitchTenant = async (companyId) => {
    await switchTenant(companyId);
    renderTenantChip();
    buildNav();
    $("appVersion").textContent = session.company?.version || APP_VERSION;
    reloadCurrent();
  };
  window.nexoRefreshShell = () => {
    renderTenantChip();
    buildNav();
    loadSystemVersion();
  };

  document.body.classList.remove("booting");
})();

function renderTenantChip() {
  const chip = document.getElementById("tenantChip");
  if (!isSuper()) {
    chip.style.display = session.company ? "flex" : "none";
    chip.innerHTML = `<i class="fas fa-store"></i><span>${esc(session.company?.name || "")}</span>`;
    return;
  }
  chip.style.display = "flex";
  chip.classList.add("clickable");
  chip.innerHTML = session.company
    ? `<i class="fas fa-store"></i><span>${esc(session.company.name)}</span><i class="fas fa-repeat swap"></i>`
    : `<i class="fas fa-layer-group"></i><span>كل الشركات</span><i class="fas fa-repeat swap"></i>`;
  chip.onclick = openTenantSwitcher;
}

async function openTenantSwitcher() {
  const list = el("div", { class: "tenant-list" });
  const m = modal({ title: "اختر الشركة اللي هتشتغل عليها", body: list, width: 460 });

  const all = el("div", { class: "tenant-item", html: `<i class="fas fa-layer-group"></i><div><strong>كل الشركات</strong><small>عرض إداري عام</small></div>` });
  all.addEventListener("click", async () => { m.close(); await window.nexoSwitchTenant(null); go("companies"); });
  list.append(all);

  try {
    const snap = await getDocs(query(collection(db, "companies"), orderBy("name")));
    if (snap.empty) list.append(el("p", { class: "text-muted", text: "مفيش شركات مضافة لسه." }));
    snap.forEach((d) => {
      const c = d.data();
      const item = el("div", { class: `tenant-item${session.companyId === d.id ? " active" : ""}`,
        html: `<i class="fas fa-store"></i><div><strong>${esc(c.name)}</strong><small>${esc(c.plan || "Basic")} · ${esc(c.version || "v1.0.0")}</small></div>` });
      item.addEventListener("click", async () => { m.close(); await window.nexoSwitchTenant(d.id); toast(`دلوقتي شغال على: ${c.name}`, "success"); });
      list.append(item);
    });
  } catch (e) {
    list.append(el("p", { class: "text-muted", text: "تعذّر تحميل الشركات: " + e.message }));
  }
}

function showAbout() {
  modal({
    title: "عن النظام",
    width: 420,
    body: `<div class="about">
      <div class="about-logo"><i class="fas fa-bolt"></i></div>
      <h3>Nexo CRM</h3>
      <p class="text-muted">نظام متكامل لإدارة الصفحات والتواصل</p>
      <div class="kv"><span>إصدار النظام</span><strong>${esc(SYSTEM_VERSION.full)}${SYSTEM_VERSION.build ? ` · build ${SYSTEM_VERSION.build}` : ""}</strong></div>
      <div class="kv"><span>تاريخ آخر تحديث</span><strong>${esc(SYSTEM_VERSION.builtAt || "—")}</strong></div>
      <div class="kv"><span>المستخدم</span><strong>${esc(session.user.email)}</strong></div>
      <div class="kv"><span>الصلاحية</span><strong>${esc(ROLES[session.profile.role]?.label || "")}</strong></div>
    </div>`,
    actions: [{ label: "تمام", class: "btn-primary", onClick: ({ close }) => close() }],
  });
}
