// ============================================================
//  المستخدمين والصلاحيات
//  إنشاء الحسابات بيتم من السيرفر (Cloud Function) لأن العميل مايقدرش ينشئ حسابات
// ============================================================
import {
  db, collection, doc, getDocs, updateDoc, query, where,
  fns, httpsCallable,
} from "../firebase.js";
import { session, isSuper, atLeast } from "../auth.js";
import { ROLES, ROLE_ORDER, normalizeLogin, displayLogin, USER_DOMAIN } from "../config.js";
import { el, card, esc, toast, modal, confirmBox, field, passwordField, spinner, emptyState, fmtDate } from "../ui.js";

let users = [];

export async function render(root) {
  root.append(el("div", { class: "page-head" }, [
    el("div", {}, [
      el("h2", { text: "المستخدمين والصلاحيات" }),
      el("div", { class: "sub", text: "كل مستخدم بيشوف الشاشات المسموحة لدوره بس" }),
    ]),
    el("div", { class: "head-actions" }, [
      mkBtn("إضافة مستخدم", "btn-primary", "fa-user-plus", () => userForm()),
    ]),
  ]));

  root.append(rolesLegend());

  const body = el("div");
  root.append(body);
  await load(body);
}

function rolesLegend() {
  const box = card("مستويات الصلاحيات");
  const grid = el("div", { class: "grid grid-4" });
  const desc = {
    superadmin: "تحكم كامل في كل الشركات والميزات والإصدارات",
    owner: "التقارير والإحصائيات وإنشاء المستخدمين وربط المنصات",
    manager: "المنتجات والنشر والجدولة وإعدادات الرد الآلي",
    agent: "صندوق الرسائل والرد على العملاء وتذاكر الشكاوى فقط",
  };
  ROLE_ORDER.forEach((r) => {
    grid.append(el("div", { class: "tenant-item", style: "cursor:default;align-items:flex-start" }, [
      el("i", { class: "fas fa-shield-halved" }),
      el("div", {}, [el("strong", { text: ROLES[r].label }), el("small", { text: desc[r] })]),
    ]));
  });
  box.append(grid);
  return box;
}

async function load(body) {
  body.innerHTML = "";
  body.append(spinner());
  try {
    const q = isSuper() && !session.companyId
      ? collection(db, "users")
      : query(collection(db, "users"), where("companyId", "==", session.companyId));
    const snap = await getDocs(q);
    users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    users.sort((a, b) => (ROLES[b.role]?.level || 0) - (ROLES[a.role]?.level || 0));
  } catch (e) {
    body.innerHTML = "";
    body.append(el("p", { class: "text-muted", text: "تعذّر التحميل: " + e.message }));
    return;
  }

  body.innerHTML = "";
  if (!users.length) {
    body.append(emptyState("fa-users", "مفيش مستخدمين لسه",
      "أضف أول مستخدم للشركة، والنظام هيبعتله إيميل وكلمة مرور يدخل بيهم.",
      mkBtn("إضافة مستخدم", "btn-primary", "fa-user-plus", () => userForm())));
    return;
  }

  const max = session.company?.features?.maxAgents || 0;
  if (max > 0) {
    body.append(el("p", { class: "hint", style: "margin-bottom:10px",
      text: `عدد المستخدمين: ${users.length} من ${max} مسموح بيهم في الباقة.` }));
  }

  const wrap = el("div", { class: "table-wrap" });
  const table = el("table", { class: "data" });
  table.innerHTML = `<thead><tr>
    <th>الاسم</th><th>البريد الإلكتروني</th><th>الصلاحية</th><th>الحالة</th><th>أُضيف</th><th></th>
  </tr></thead>`;
  const tbody = el("tbody");

  users.forEach((u) => {
    const tr = el("tr");
    tr.innerHTML = `
      <td><strong>${esc(u.name || "—")}</strong></td>
      <td dir="ltr" style="text-align:start;font-size:13px" class="text-muted">${esc(displayLogin(u.email))}</td>
      <td><span class="badge badge-blue">${esc(ROLES[u.role]?.label || u.role)}</span></td>
      <td>${u.active === false ? '<span class="badge badge-red">موقوف</span>' : '<span class="badge badge-green">نشط</span>'}</td>
      <td class="text-muted" style="font-size:12px">${fmtDate(u.createdAt)}</td>`;

    const td = el("td");
    const box = el("div", { class: "row-actions" });
    const isSelf = u.id === session.user.uid;
    if (!isSelf && canManage(u)) {
      box.append(
        mkBtn("", "btn-light btn-sm", "fa-pen", () => userForm(u)),
        mkBtn("", "btn-light btn-sm", u.active === false ? "fa-play" : "fa-ban", () => toggleActive(u)),
      );
    } else {
      box.append(el("span", { class: "text-muted", style: "font-size:12px", text: isSelf ? "أنت" : "—" }));
    }
    td.append(box);
    tr.append(td);
    tbody.append(tr);
  });

  table.append(tbody);
  wrap.append(table);
  body.append(wrap);
}

/** أقدر أدير المستخدم ده؟ (مينفعش أعدّل حد أعلى مني أو زيّي) */
function canManage(u) {
  if (isSuper()) return true;
  const mine = ROLES[session.profile.role]?.level || 0;
  const theirs = ROLES[u.role]?.level || 0;
  return atLeast("owner") && theirs < mine;
}

function availableRoles() {
  const mine = ROLES[session.profile.role]?.level || 0;
  return ROLE_ORDER.filter((r) => {
    if (r === "superadmin") return isSuper();
    return ROLES[r].level < mine || isSuper();
  });
}

function userForm(existing = null) {
  const name = field({ label: "الاسم *", name: "name", value: existing?.name || "" });
  const email = field({
    label: "اسم المستخدم *", name: "email", type: "text",
    value: existing ? displayLogin(existing.email) : "",
    placeholder: "مثال: ahmed أو ahmed@company.com",
  });
  const loginPreview = el("small", { class: "hint" });
  email.wrap.append(loginPreview);
  const updatePreview = () => {
    const v = email.input.value.trim();
    loginPreview.innerHTML = v
      ? `هيدخل بالاسم ده: <strong dir="ltr">${esc(normalizeLogin(v))}</strong>`
      : `اكتب أي اسم — النظام هيكمّله لوحده (مثلاً <code dir="ltr">ahmed@${USER_DOMAIN}</code>)`;
  };
  email.input.addEventListener("input", updatePreview);
  updatePreview();
  if (existing) email.input.disabled = true;
  const pass = passwordField({ label: existing ? "كلمة مرور جديدة (سيبها فاضية لو مش هتغيرها)" : "كلمة المرور *",
    name: "password", hint: "6 حروف على الأقل" });
  const pass2 = passwordField({ label: "تأكيد كلمة المرور", name: "password2" });
  const role = field({ label: "الصلاحية *", name: "role", type: "select", value: existing?.role || "agent",
    options: availableRoles().map((r) => ({ value: r, label: ROLES[r].label })) });

  // ---------- صلاحيات إضافية (يفتح للموظف شاشات فوق دوره) ----------
  const extraWrap = el("div", { style: "margin-top:6px" });
  const extraInputs = {};
  const EXTRA_SCREENS = [
    { id: "publisher", label: "الناشر الذكي", minRole: "manager" },
    { id: "products", label: "المخزون والأصناف", minRole: "manager" },
    { id: "orders", label: "الطلبات والمبيعات", minRole: "manager" },
    { id: "ai", label: "إعدادات الرد الآلي", minRole: "manager" },
    { id: "analytics", label: "التحليلات والتقارير", minRole: "owner" },
  ];

  function drawExtras() {
    extraWrap.innerHTML = "";
    // الصلاحيات الإضافية تنفع للموظف بس (اللي دوره أقل)
    if (role.input.value !== "agent") return;
    extraWrap.append(el("label", { class: "field", style: "margin-bottom:8px",
      text: "شاشات إضافية للموظف (فوق صندوق الرسائل)" }));
    const grid = el("div", { class: "grid grid-2" });
    const current = existing?.extraScreens || [];
    EXTRA_SCREENS.forEach((s) => {
      const input = el("input", { type: "checkbox" });
      input.checked = current.includes(s.id);
      const r = el("label", { class: `check-row${input.checked ? " checked" : ""}` }, [input, el("span", { text: s.label })]);
      input.addEventListener("change", () => r.classList.toggle("checked", input.checked));
      extraInputs[s.id] = input;
      grid.append(r);
    });
    extraWrap.append(grid);
    extraWrap.append(el("small", { class: "hint", text: "الموظف هيشوف الشاشات دي زيادة على صندوق الرسائل." }));
  }
  role.input.addEventListener("change", () => { Object.keys(extraInputs).forEach((k) => delete extraInputs[k]); drawExtras(); });
  drawExtras();

  const body = el("div", {}, [name.wrap, email.wrap, pass.wrap, pass2.wrap, role.wrap, extraWrap]);
  if (!existing) {
    body.append(el("p", { class: "hint",
      text: "الحساب بيتعمل على السيرفر مباشرة. اكتب البيانات وسلّمها للموظف — النظام مش بيسجّل ولا بيطلب كلمة سر فيسبوك من حد." }));
  }

  modal({
    title: existing ? "تعديل مستخدم" : "إضافة مستخدم جديد",
    body,
    actions: [
      { label: "إلغاء", class: "btn-light", onClick: ({ close }) => close() },
      {
        label: "حفظ", class: "btn-primary",
        onClick: async ({ close, button }) => {
          const extraScreens = role.input.value === "agent"
            ? Object.entries(extraInputs).filter(([, i]) => i.checked).map(([id]) => id)
            : [];
          const payload = {
            name: name.input.value.trim(),
            email: normalizeLogin(email.input.value),   // ← بيكمّل الاسم لوحده
            password: pass.input.value,
            role: role.input.value,
            extraScreens,
            companyId: session.companyId,
            uid: existing?.id || null,
          };
          if (!payload.name) return toast("اكتب اسم الموظف", "error");
          if (!email.input.value.trim()) return toast("اكتب اسم المستخدم", "error");
          if (!isEmail(payload.email))
            return toast("اسم المستخدم فيه رموز مش مسموحة — استخدم حروف وأرقام بس", "error");
          if (!existing && payload.password.length < 6) return toast("كلمة المرور لازم 6 حروف على الأقل", "error");
          if (pass.input.value && pass.input.value !== pass2.input.value)
            return toast("كلمة المرور والتأكيد مش متطابقين", "error");

          button.disabled = true;
          try {
            const fn = httpsCallable(fns, existing ? "updateUser" : "createUser");
            await fn(payload);
            toast(existing ? "تم حفظ التعديلات" : "تم إنشاء الحساب بنجاح", "success");
            close();
            import("../router.js").then((r) => r.reloadCurrent());
          } catch (e) {
            button.disabled = false;
            toast(errText(e), "error");
          }
        },
      },
    ],
  });
}

async function toggleActive(u) {
  const turningOff = u.active !== false;
  const ok = await confirmBox(
    turningOff ? `هتوقف حساب "${u.name}" ومش هيقدر يدخل النظام.` : `هتفعّل حساب "${u.name}" تاني.`,
    { title: turningOff ? "إيقاف حساب" : "تفعيل حساب", danger: turningOff });
  if (!ok) return;
  try {
    await updateDoc(doc(db, "users", u.id), { active: !turningOff });
    toast("تم التحديث", "success");
    import("../router.js").then((r) => r.reloadCurrent());
  } catch (e) { toast("فشل التحديث: " + e.message, "error"); }
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim());
}

function errText(e) {
  const msg = e?.message || "";
  if (/improperly formatted|invalid-email/i.test(msg))
    return "البريد الإلكتروني مش مكتوب صح — لازم يكون بالشكل ده: name@company.com";
  if (/already-exists|email-already/i.test(msg)) return "البريد ده مستخدم قبل كده.";
  if (/weak-password/i.test(msg)) return "كلمة المرور ضعيفة — خليها 6 حروف على الأقل.";
  if (/quota|LIMIT|resource-exhausted/i.test(msg)) return "وصلت للحد الأقصى للمستخدمين في الباقة.";
  if (/permission-denied/i.test(msg)) return "مش مسموح لك بالإجراء ده.";
  if (/unauthenticated/i.test(msg)) return "الجلسة انتهت — اعمل تسجيل دخول تاني.";
  if (/not-found|internal/i.test(msg))
    return "تعذّر الاتصال بالسيرفر. جرّب تاني، ولو المشكلة فضلت كلّم إدارة النظام.";
  return "فشل: " + msg;
}

function mkBtn(label, cls, icon, onClick) {
  const b = el("button", { class: `btn ${cls}` }, [icon ? el("i", { class: `fas ${icon}` }) : null, label || null]);
  b.addEventListener("click", onClick);
  return b;
}

export function destroy() { users = []; }
