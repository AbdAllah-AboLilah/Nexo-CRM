// ============================================================
//  الطلبات والمبيعات + تسعير الشحن حسب المحافظة
// ============================================================
import {
  db, collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
  query, orderBy, limit, serverTimestamp,
} from "../firebase.js";
import { session, tenantPath, atLeast, refreshCompany } from "../auth.js";
import { GOVERNORATES, PLATFORMS } from "../config.js";
import { el, card, esc, toast, modal, confirmBox, field, money, fmtDateTime, emptyState, spinner } from "../ui.js";

let orders = [];
let statusFilter = "all";

const ORDER_STATUS = {
  new:       { label: "جديد",       cls: "badge-red" },
  confirmed: { label: "تم التأكيد", cls: "badge-blue" },
  shipped:   { label: "تم الشحن",   cls: "badge-yellow" },
  delivered: { label: "تم التسليم", cls: "badge-green" },
  cancelled: { label: "ملغي",       cls: "badge-gray" },
};

export async function render(root) {
  root.append(el("div", { class: "page-head" }, [
    el("div", {}, [
      el("h2", { text: "الطلبات والمبيعات" }),
      el("div", { class: "sub", text: "الطلبات اللي البوت بيجمّعها من العملاء بتظهر هنا أوتوماتيك" }),
    ]),
    el("div", { class: "head-actions" }, [
      mkBtn("تسعير الشحن", "btn-ghost", "fa-truck", shippingDialog),
      atLeast("manager") ? mkBtn("إضافة طلب يدوي", "btn-primary", "fa-plus", () => orderForm()) : null,
      mkBtn("تصدير", "btn-ghost", "fa-file-export", exportCsv),
    ].filter(Boolean)),
  ]));

  // فلاتر
  const chips = el("div", { class: "card", style: "display:flex;gap:6px;flex-wrap:wrap;padding:12px;margin-bottom:16px" });
  [{ key: "all", label: "الكل" }, ...Object.entries(ORDER_STATUS).map(([k, v]) => ({ key: k, label: v.label }))]
    .forEach((f) => {
      const b = el("button", { class: `chip${f.key === statusFilter ? " active" : ""}`, text: f.label });
      b.addEventListener("click", () => {
        statusFilter = f.key;
        chips.querySelectorAll(".chip").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        draw(body);
      });
      chips.append(b);
    });
  root.append(chips);

  const body = el("div");
  root.append(body);

  body.append(spinner());
  try {
    const snap = await getDocs(query(collection(db, ...tenantPath("orders")), orderBy("createdAt", "desc"), limit(300)));
    orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    body.innerHTML = "";
    body.append(el("p", { class: "text-muted", text: "تعذّر التحميل: " + e.message }));
    return;
  }
  draw(body);
}

function draw(body) {
  body.innerHTML = "";
  const list = statusFilter === "all" ? orders : orders.filter((o) => o.status === statusFilter);

  if (!list.length) {
    body.append(emptyState("fa-shopping-bag",
      orders.length ? "مفيش طلبات في الفلتر ده" : "مفيش طلبات لسه",
      "لما البوت يلقط نية شراء من عميل، هيجمّع بياناته ويسجّل الطلب هنا تلقائياً."));
    return;
  }

  // ملخص سريع
  const total = list.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const summary = el("div", { class: "grid grid-3", style: "margin-bottom:16px" }, [
    statCard("عدد الطلبات", list.length.toLocaleString("ar-EG"), "fa-receipt", "#4361ee"),
    statCard("إجمالي القيمة", money(total), "fa-sack-dollar", "#14a37f"),
    statCard("متوسط الطلب", money(list.length ? total / list.length : 0), "fa-chart-line", "#7239ea"),
  ]);
  body.append(summary);

  const wrap = el("div", { class: "table-wrap" });
  const table = el("table", { class: "data" });
  table.innerHTML = `<thead><tr>
    <th>العميل</th><th>التليفون</th><th>المحافظة</th><th>المنتجات</th>
    <th>الإجمالي</th><th>المنصة</th><th>الحالة</th><th>التاريخ</th><th></th>
  </tr></thead>`;
  const tbody = el("tbody");

  list.forEach((o) => {
    const st = ORDER_STATUS[o.status] || ORDER_STATUS.new;
    const items = (o.items || []).map((i) => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ""}`).join("، ");
    const p = PLATFORMS[o.platform];
    const tr = el("tr");
    tr.innerHTML = `
      <td><strong>${esc(o.customerName || "—")}</strong></td>
      <td dir="ltr" style="text-align:start">${esc(o.phone || "—")}</td>
      <td class="text-muted" style="font-size:13px">${esc(o.governorate || "—")}</td>
      <td style="max-width:200px;font-size:12.5px" class="text-muted">${esc(items || "—")}</td>
      <td><strong>${money(o.total)}</strong>${o.shipping ? `<br><small class="text-muted">شحن: ${money(o.shipping)}</small>` : ""}</td>
      <td>${p ? `<i class="${p.icon}" style="color:${p.color}" title="${p.label}"></i>` : "—"}</td>
      <td><span class="badge ${st.cls}">${st.label}</span></td>
      <td class="text-muted" style="font-size:12px">${fmtDateTime(o.createdAt)}</td>`;

    const td = el("td");
    const box = el("div", { class: "row-actions" });
    box.append(
      mkBtn("", "btn-light btn-sm", "fa-eye", () => viewOrder(o)),
      atLeast("manager") ? mkBtn("", "btn-light btn-sm", "fa-pen", () => orderForm(o)) : null,
    );
    td.append(box);
    tr.append(td);
    tbody.append(tr);
  });

  table.append(tbody);
  wrap.append(table);
  body.append(wrap);
}

function statCard(label, value, icon, color) {
  return el("div", { class: "card stat-card" }, [
    el("div", { class: "stat-icon", style: `background:${color}1a;color:${color}` }, [el("i", { class: `fas ${icon}` })]),
    el("div", { class: "stat-label", text: label }),
    el("div", { class: "stat-number", style: "font-size:24px", text: value }),
  ]);
}

function viewOrder(o) {
  const items = (o.items || []).map((i) =>
    `<tr><td>${esc(i.name)}</td><td>${i.qty || 1}</td><td>${money(i.price)}</td></tr>`).join("");
  modal({
    title: `طلب — ${o.customerName || ""}`,
    width: 560,
    body: `
      <div class="kv"><span>الاسم</span><strong>${esc(o.customerName || "—")}</strong></div>
      <div class="kv"><span>التليفون</span><strong dir="ltr">${esc(o.phone || "—")}</strong></div>
      <div class="kv"><span>المحافظة</span><strong>${esc(o.governorate || "—")}</strong></div>
      <div class="kv"><span>العنوان</span><strong>${esc(o.address || "—")}</strong></div>
      <div class="kv"><span>المصدر</span><strong>${esc(PLATFORMS[o.platform]?.label || "يدوي")}</strong></div>
      <div class="kv"><span>التاريخ</span><strong>${fmtDateTime(o.createdAt)}</strong></div>
      ${items ? `<div class="table-wrap" style="margin-top:14px"><table class="data" style="min-width:auto">
        <thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th></tr></thead><tbody>${items}</tbody></table></div>` : ""}
      <div class="kv" style="margin-top:12px"><span>الشحن</span><strong>${money(o.shipping)}</strong></div>
      <div class="kv"><span>الإجمالي</span><strong style="color:var(--success);font-size:16px">${money(o.total)}</strong></div>
      ${o.notes ? `<div class="ai-insight" style="margin-top:14px"><strong>ملاحظات</strong>${esc(o.notes)}</div>` : ""}`,
    actions: [{ label: "إغلاق", class: "btn-light", onClick: ({ close }) => close() }],
  });
}

function orderForm(existing = null) {
  const name = field({ label: "اسم العميل *", name: "customerName", value: existing?.customerName || "" });
  const phone = field({ label: "رقم التليفون *", name: "phone", value: existing?.phone || "" });
  const gov = field({ label: "المحافظة", name: "governorate", type: "select", value: existing?.governorate || "",
    options: [{ value: "", label: "— اختر —" }, ...GOVERNORATES.map((g) => ({ value: g, label: g }))] });
  const address = field({ label: "العنوان بالتفصيل", name: "address", type: "textarea", rows: 2, value: existing?.address || "" });
  const itemsTxt = field({ label: "المنتجات", name: "items", type: "textarea", rows: 3,
    value: (existing?.items || []).map((i) => `${i.name} | ${i.qty || 1} | ${i.price || 0}`).join("\n"),
    hint: "كل سطر: اسم الصنف | الكمية | السعر" });
  const shipping = field({ label: "مصاريف الشحن", name: "shipping", type: "number", value: existing?.shipping ?? "" });
  const status = field({ label: "الحالة", name: "status", type: "select", value: existing?.status || "new",
    options: Object.entries(ORDER_STATUS).map(([k, v]) => ({ value: k, label: v.label })) });
  const notes = field({ label: "ملاحظات", name: "notes", type: "textarea", rows: 2, value: existing?.notes || "" });

  // تحديث تلقائي لمصاريف الشحن حسب المحافظة
  gov.input.addEventListener("change", () => {
    const rate = session.company?.shipping?.[gov.input.value];
    if (rate !== undefined && !existing) shipping.input.value = rate;
  });

  const body = el("div", {}, [
    el("div", { class: "form-row" }, [name.wrap, phone.wrap]),
    el("div", { class: "form-row" }, [gov.wrap, shipping.wrap]),
    address.wrap, itemsTxt.wrap,
    el("div", { class: "form-row" }, [status.wrap]),
    notes.wrap,
  ]);

  modal({
    title: existing ? "تعديل طلب" : "إضافة طلب يدوي",
    body, width: 620,
    actions: [
      { label: "إلغاء", class: "btn-light", onClick: ({ close }) => close() },
      {
        label: "حفظ", class: "btn-primary",
        onClick: async ({ close, button }) => {
          if (!name.input.value.trim() || !phone.input.value.trim())
            return toast("الاسم ورقم التليفون مطلوبين", "error");

          const items = itemsTxt.input.value.split("\n").map((line) => {
            const [n, q, p] = line.split("|").map((s) => (s || "").trim());
            if (!n) return null;
            return { name: n, qty: Number(q) || 1, price: Number(p) || 0 };
          }).filter(Boolean);

          const ship = Number(shipping.input.value) || 0;
          const total = items.reduce((s, i) => s + i.price * i.qty, 0) + ship;

          const payload = {
            customerName: name.input.value.trim(),
            phone: phone.input.value.trim(),
            governorate: gov.input.value,
            address: address.input.value.trim(),
            items, shipping: ship, total,
            status: status.input.value,
            notes: notes.input.value.trim(),
            platform: existing?.platform || "manual",
          };

          button.disabled = true;
          try {
            if (existing) await updateDoc(doc(db, ...tenantPath("orders"), existing.id), payload);
            else await addDoc(collection(db, ...tenantPath("orders")), { ...payload, createdAt: serverTimestamp() });
            toast("تم الحفظ", "success");
            close();
            import("../router.js").then((r) => r.reloadCurrent());
          } catch (e) { button.disabled = false; toast("فشل الحفظ: " + e.message, "error"); }
        },
      },
    ],
  });
}

// ---------- تسعير الشحن ----------
function shippingDialog() {
  const rates = session.company?.shipping || {};
  const body = el("div");
  body.append(el("p", { class: "text-muted", style: "margin-bottom:14px",
    text: "حدد مصاريف الشحن لكل محافظة. البوت هيستخدمها أوتوماتيك لما يعرف عنوان العميل." }));

  const inputs = {};
  const grid = el("div", { class: "grid grid-3" });
  GOVERNORATES.forEach((g) => {
    const f = field({ label: g, name: `ship-${g}`, type: "number", value: rates[g] ?? "" });
    f.wrap.style.marginBottom = "8px";
    inputs[g] = f.input;
    grid.append(f.wrap);
  });
  body.append(grid);

  modal({
    title: "تسعير الشحن حسب المحافظة",
    body, width: 700,
    actions: [
      { label: "إلغاء", class: "btn-light", onClick: ({ close }) => close() },
      {
        label: "حفظ", class: "btn-primary",
        onClick: async ({ close, button }) => {
          const shipping = {};
          Object.entries(inputs).forEach(([g, i]) => { if (i.value !== "") shipping[g] = Number(i.value) || 0; });
          button.disabled = true;
          try {
            await updateDoc(doc(db, "companies", session.companyId), { shipping });
            await refreshCompany();
            toast("تم حفظ تسعير الشحن", "success");
            close();
          } catch (e) { button.disabled = false; toast("فشل الحفظ: " + e.message, "error"); }
        },
      },
    ],
  });
}

function exportCsv() {
  if (!orders.length) return toast("مفيش طلبات للتصدير", "warn");
  const head = ["الاسم", "التليفون", "المحافظة", "العنوان", "المنتجات", "الشحن", "الإجمالي", "الحالة", "التاريخ"];
  const lines = orders.map((o) => [
    o.customerName, o.phone, o.governorate, o.address,
    (o.items || []).map((i) => `${i.name} x${i.qty || 1}`).join(" + "),
    o.shipping, o.total, ORDER_STATUS[o.status]?.label || o.status, fmtDateTime(o.createdAt),
  ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
  const csv = "﻿" + [head.join(","), ...lines].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = el("a", { href: url, download: `nexo-orders-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
  URL.revokeObjectURL(url);
  toast("تم تحميل الملف", "success");
}

function mkBtn(label, cls, icon, onClick) {
  const b = el("button", { class: `btn ${cls}` }, [icon ? el("i", { class: `fas ${icon}` }) : null, label || null]);
  b.addEventListener("click", onClick);
  return b;
}

export function destroy() { orders = []; statusFilter = "all"; }
