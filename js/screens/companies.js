// ============================================================
//  إدارة الشركات (Super Admin فقط)
//  إضافة شركة، الميزات، الباقة، تفعيل/إيقاف، الدخول كشركة
// ============================================================
import {
  db, collection, doc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp,
} from "../firebase.js";
import { session, isSuper } from "../auth.js";
import { DEFAULT_FEATURES, DEFAULT_CONSTANTS, DEFAULT_AI, APP_VERSION, PLATFORMS } from "../config.js";
import { el, card, esc, toast, modal, confirmBox, field, toggle, fmtDate, emptyState, spinner } from "../ui.js";

let companies = [];

export async function render(root) {
  if (!isSuper()) { root.append(el("p", { class: "text-muted", text: "الصفحة دي لمنشئ النظام فقط." })); return; }

  const head = el("div", { class: "page-head" }, [
    el("div", {}, [
      el("h2", { text: "إدارة الشركات" }),
      el("div", { class: "sub", text: "كل شركة ليها بياناتها وميزاتها الخاصة" }),
    ]),
    el("div", { class: "head-actions" }, [
      btn("إضافة شركة جديدة", "btn-primary", "fa-plus", () => companyForm()),
    ]),
  ]);
  root.append(head);

  const body = el("div");
  root.append(body);
  await load(body);
}

async function load(body) {
  body.innerHTML = "";
  body.append(spinner());
  try {
    const snap = await getDocs(query(collection(db, "companies"), orderBy("createdAt", "desc")));
    companies = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    body.innerHTML = "";
    body.append(el("p", { class: "text-muted", text: "تعذّر التحميل: " + e.message }));
    return;
  }

  body.innerHTML = "";
  if (!companies.length) {
    body.append(emptyState("fa-building", "مفيش شركات لسه",
      "ابدأ بإضافة أول شركة، وبعدها تقدر تنشئ لها مستخدمين وتفتح لها الميزات.",
      btn("إضافة شركة جديدة", "btn-primary", "fa-plus", () => companyForm())));
    return;
  }

  const wrap = el("div", { class: "table-wrap" });
  const table = el("table", { class: "data" });
  table.innerHTML = `<thead><tr>
    <th>الشركة</th><th>الباقة</th><th>المنصات المفعّلة</th>
    <th>الإصدار</th><th>الحالة</th><th>أُضيفت</th><th></th>
  </tr></thead>`;
  const tbody = el("tbody");

  companies.forEach((c) => {
    const platforms = Object.entries(PLATFORMS)
      .filter(([, p]) => c.features?.[p.feature])
      .map(([, p]) => `<i class="${p.icon}" style="color:${p.color};font-size:15px" title="${p.label}"></i>`)
      .join(" ") || '<span class="text-muted" style="font-size:12px">—</span>';

    const tr = el("tr");
    tr.innerHTML = `
      <td><strong>${esc(c.name)}</strong><br><small class="text-muted">${esc(c.businessType || "")}</small></td>
      <td><span class="badge badge-blue">${esc(c.plan || "Basic")}</span></td>
      <td>${platforms}</td>
      <td><code class="text-muted">${esc(sysVersion())}</code></td>
      <td>${c.active === false ? '<span class="badge badge-red">موقوفة</span>' : '<span class="badge badge-green">نشطة</span>'}</td>
      <td class="text-muted" style="font-size:12px">${fmtDate(c.createdAt)}</td>`;

    const actions = el("td");
    const box = el("div", { class: "row-actions" });
    box.append(
      btn("دخول", "btn-primary btn-sm", "fa-right-to-bracket", async () => {
        await window.nexoSwitchTenant(c.id);
        toast(`دلوقتي شغال على: ${c.name}`, "success");
      }),
      btn("", "btn-light btn-sm", "fa-sliders", () => featuresForm(c)),
      btn("", "btn-light btn-sm", "fa-pen", () => companyForm(c)),
      btn("", "btn-light btn-sm", "fa-trash", () => removeCompany(c)),
    );
    actions.append(box);
    tr.append(actions);
    tbody.append(tr);
  });

  table.append(tbody);
  wrap.append(table);
  body.append(wrap);
}

// ---------- إضافة / تعديل شركة ----------
function companyForm(existing = null) {
  const form = el("div");
  const name = field({ label: "اسم الشركة *", name: "name", value: existing?.name || "", placeholder: "مثال: Nexo - الفرع الرئيسي" });
  const type = field({ label: "نشاط الشركة", name: "businessType", value: existing?.businessType || "", placeholder: "مثال: منصة ذكية لإدارة صفحات التواصل" });
  const plan = field({
    label: "الباقة", name: "plan", type: "select", value: existing?.plan || "Basic",
    options: [{ value: "Basic", label: "أساسية" }, { value: "Pro", label: "متقدمة" }, { value: "VIP", label: "VIP" }],
  });
  const active = toggle({ label: "الشركة نشطة", name: "active", checked: existing ? existing.active !== false : true, hint: "لو أوقفتها، مستخدميها مش هيقدروا يدخلوا" });

  form.append(name.wrap, type.wrap, plan.wrap, active.row);

  const m = modal({
    title: existing ? "تعديل بيانات الشركة" : "إضافة شركة جديدة",
    body: form,
    actions: [
      { label: "إلغاء", class: "btn-light", onClick: ({ close }) => close() },
      {
        label: existing ? "حفظ التعديلات" : "إضافة الشركة", class: "btn-primary",
        onClick: async ({ close, button }) => {
          const payload = {
            name: name.input.value.trim(),
            businessType: type.input.value.trim(),
            plan: plan.input.value,
            active: active.input.checked,
          };
          if (!payload.name) return toast("اكتب اسم الشركة", "error");
          button.disabled = true;
          try {
            if (existing) {
              await updateDoc(doc(db, "companies", existing.id), payload);
              toast("تم حفظ التعديلات", "success");
            } else {
              const id = slug(payload.name);
              await setDoc(doc(db, "companies", id), {
                ...payload,
                features: { ...DEFAULT_FEATURES },
                constants: { ...DEFAULT_CONSTANTS },
                ai: { ...DEFAULT_AI },
                ownerId: null,
                createdAt: serverTimestamp(),
                createdBy: session.user.uid,
              });
              toast("تمت إضافة الشركة", "success");
            }
            close();
            reload();
          } catch (e) {
            button.disabled = false;
            toast("فشل الحفظ: " + e.message, "error");
          }
        },
      },
    ],
  });
}

// ---------- الميزات والحدود ----------
function featuresForm(c) {
  const f = { ...DEFAULT_FEATURES, ...(c.features || {}) };
  const body = el("div");
  const inputs = {};

  body.append(el("h4", { class: "card-title", text: "منصات النشر" }));
  const platGrid = el("div", { class: "grid", style: "gap:8px" });
  Object.entries(PLATFORMS).forEach(([key, p]) => {
    const t = toggle({ label: p.label, name: p.feature, checked: !!f[p.feature],
      hint: key === "whatsapp" ? "محتاج WhatsApp Cloud API + قوالب معتمدة" :
            key === "telegram" ? "أسرع منصة — مفيش موافقات" :
            "محتاج App Review من ميتا" });
    inputs[p.feature] = t.input;
    platGrid.append(t.row);
  });
  body.append(platGrid);

  body.append(el("h4", { class: "card-title", style: "margin-top:22px", text: "الميزات المتقدمة" }));
  const advGrid = el("div", { class: "grid", style: "gap:8px" });
  [
    ["canUseAI", "الرد الآلي بالذكاء الاصطناعي", "Gemini يرد على الرسائل والتعليقات"],
    ["canUseModeration", "فلترة التعليقات المزعجة", "إخفاء المعاكسات والألفاظ المسيئة تلقائياً"],
    ["canUseReports", "التقارير الآلية PDF", "تقرير يومي/أسبوعي/شهري يتبعت أوتوماتيك"],
    ["canUseOrders", "استقبال الطلبات (أوردرات)", "البوت يجمع بيانات العميل ويسجل الطلب"],
  ].forEach(([key, label, hint]) => {
    const t = toggle({ label, name: key, checked: !!f[key], hint });
    inputs[key] = t.input;
    advGrid.append(t.row);
  });
  body.append(advGrid);

  body.append(el("h4", { class: "card-title", style: "margin-top:22px", text: "حدود الاستخدام" }));
  const maxAgents = field({ label: "أقصى عدد مستخدمين", name: "maxAgents", type: "number", value: f.maxAgents });
  const maxReplies = field({ label: "أقصى ردود آلية شهرياً", name: "maxMonthlyReplies", type: "number", value: f.maxMonthlyReplies, hint: "اكتب 0 يعني بدون حد" });
  body.append(el("div", { class: "form-row" }, [maxAgents.wrap, maxReplies.wrap]));

  modal({
    title: `ميزات: ${c.name}`,
    body, width: 620,
    actions: [
      { label: "إلغاء", class: "btn-light", onClick: ({ close }) => close() },
      {
        label: "حفظ", class: "btn-primary",
        onClick: async ({ close, button }) => {
          const features = {};
          Object.entries(inputs).forEach(([k, input]) => { features[k] = input.checked; });
          features.maxAgents = Number(maxAgents.input.value) || 0;
          features.maxMonthlyReplies = Number(maxReplies.input.value) || 0;
          button.disabled = true;
          try {
            await updateDoc(doc(db, "companies", c.id), { features });
            toast("تم تحديث الميزات", "success");
            close();
            if (session.companyId === c.id) { await window.nexoSwitchTenant(c.id); }
            reload();
          } catch (e) { button.disabled = false; toast("فشل الحفظ: " + e.message, "error"); }
        },
      },
    ],
  });
}

async function removeCompany(c) {
  const ok = await confirmBox(
    `هتمسح شركة "${c.name}" نهائياً. ملحوظة: البيانات الداخلية (رسائل/منتجات/طلبات) مش بتتمسح تلقائياً من فايربيز.`,
    { title: "حذف شركة" });
  if (!ok) return;
  try {
    await deleteDoc(doc(db, "companies", c.id));
    if (session.companyId === c.id) await window.nexoSwitchTenant(null);
    toast("تم حذف الشركة", "success");
    reload();
  } catch (e) { toast("فشل الحذف: " + e.message, "error"); }
}

function slug(name) {
  const base = name.trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30) || "company";
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

function btn(label, cls, icon, onClick) {
  const b = el("button", { class: `btn ${cls}` }, [icon ? el("i", { class: `fas ${icon}` }) : null, label || null]);
  b.addEventListener("click", onClick);
  return b;
}

/** رقم إصدار النظام الحالي (من version.json عبر الـ shell) */
function sysVersion() {
  try { return window.nexoSystemVersion?.().full || `v${APP_VERSION}`; }
  catch { return `v${APP_VERSION}`; }
}

function reload() { import("../router.js").then((r) => r.reloadCurrent()); }

export function destroy() { companies = []; }
