// ============================================================
//  المخزون والأصناف — استيراد من Excel/CSV + تعديل يدوي + تصدير
// ============================================================
import {
  db, collection, doc, getDocs, setDoc, deleteDoc, writeBatch,
  query, orderBy, serverTimestamp,
} from "../firebase.js";
import { session, tenantPath, atLeast } from "../auth.js";
import { el, card, esc, toast, modal, confirmBox, field, spinner, emptyState, money, fmtDate } from "../ui.js";

let products = [];
let filtered = [];
let tbodyRef, countRef;

export async function render(root) {
  const canEdit = atLeast("manager");

  root.append(el("div", { class: "page-head" }, [
    el("div", {}, [
      el("h2", { text: "المخزون والأصناف" }),
      el("div", { class: "sub", text: "الأسعار دي هي اللي الذكاء الاصطناعي بيرد بيها على العملاء" }),
    ]),
    el("div", { class: "head-actions" }, canEdit ? [
      mkBtn("استيراد Excel / CSV", "btn-primary", "fa-file-import", importDialog),
      mkBtn("إضافة صنف", "btn-ghost", "fa-plus", () => productForm()),
      mkBtn("تصدير", "btn-ghost", "fa-file-export", exportCsv),
    ] : []),
  ]));

  // شريط البحث
  const search = el("input", { class: "form-control", placeholder: "ابحث باسم الصنف أو القسم..." });
  const count = el("span", { class: "text-muted", style: "font-size:13px;white-space:nowrap" });
  countRef = count;
  const bar = el("div", { class: "card", style: "display:flex;gap:12px;align-items:center;margin-bottom:16px;padding:14px" }, [search, count]);
  root.append(bar);
  search.addEventListener("input", () => applyFilter(search.value));

  const body = el("div");
  root.append(body);
  await load(body, canEdit);
}

async function load(body, canEdit) {
  body.innerHTML = "";
  body.append(spinner());
  try {
    const snap = await getDocs(query(collection(db, ...tenantPath("products")), orderBy("name")));
    products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    body.innerHTML = "";
    body.append(el("p", { class: "text-muted", text: "تعذّر التحميل: " + e.message }));
    return;
  }
  filtered = products;
  drawTable(body, canEdit);
}

function drawTable(body, canEdit) {
  body.innerHTML = "";
  if (!products.length) {
    body.append(emptyState("fa-box-open", "مفيش أصناف لسه",
      "ارفع ملف Excel أو CSV فيه أعمدة: اسم الصنف، القسم الرئيسي، القسم الفرعي، السعر قبل الخصم، السعر بعد الخصم.",
      canEdit ? mkBtn("استيراد ملف", "btn-primary", "fa-file-import", importDialog) : null));
    updateCount();
    return;
  }

  const wrap = el("div", { class: "table-wrap" });
  const table = el("table", { class: "data" });
  table.innerHTML = `<thead><tr>
    <th>اسم الصنف</th><th>القسم الرئيسي</th><th>القسم الفرعي</th>
    <th>قبل الخصم</th><th>بعد الخصم</th><th>آخر تحديث</th>${canEdit ? "<th></th>" : ""}
  </tr></thead>`;
  const tbody = el("tbody");
  tbodyRef = tbody;
  table.append(tbody);
  wrap.append(table);
  body.append(wrap);
  renderRows(canEdit);
}

function renderRows(canEdit = atLeast("manager")) {
  if (!tbodyRef) return;
  tbodyRef.innerHTML = "";
  filtered.slice(0, 400).forEach((p) => {
    const discount = p.priceBefore > p.priceAfter && p.priceBefore > 0
      ? Math.round((1 - p.priceAfter / p.priceBefore) * 100) : 0;
    const tr = el("tr");
    tr.innerHTML = `
      <td><strong>${esc(p.name)}</strong></td>
      <td class="text-muted" style="font-size:13px">${esc(p.category || "—")}</td>
      <td class="text-muted" style="font-size:13px">${esc(p.subCategory || "—")}</td>
      <td>${p.priceBefore ? `<s class="text-muted">${money(p.priceBefore)}</s>` : "—"}</td>
      <td><strong style="color:var(--success)">${money(p.priceAfter)}</strong>
          ${discount > 0 ? `<span class="badge badge-red" style="margin-inline-start:6px">-${discount}%</span>` : ""}</td>
      <td class="text-muted" style="font-size:12px">${fmtDate(p.updatedAt)}</td>`;
    if (canEdit) {
      const td = el("td");
      const box = el("div", { class: "row-actions" });
      box.append(
        mkBtn("", "btn-light btn-sm", "fa-pen", () => productForm(p)),
        mkBtn("", "btn-light btn-sm", "fa-trash", () => removeProduct(p)),
      );
      td.append(box);
      tr.append(td);
    }
    tbodyRef.append(tr);
  });
  updateCount();
}

function updateCount() {
  if (!countRef) return;
  const extra = filtered.length > 400 ? ` (معروض أول 400)` : "";
  countRef.textContent = `${filtered.length} صنف من ${products.length}${extra}`;
}

function applyFilter(term) {
  const t = term.trim().toLowerCase();
  filtered = !t ? products : products.filter((p) =>
    [p.name, p.category, p.subCategory].some((x) => String(x || "").toLowerCase().includes(t)));
  renderRows();
}

// ---------- إضافة / تعديل ----------
function productForm(existing = null) {
  const name = field({ label: "اسم الصنف *", name: "name", value: existing?.name || "" });
  const cat = field({ label: "القسم الرئيسي", name: "category", value: existing?.category || "" });
  const sub = field({ label: "القسم الفرعي", name: "subCategory", value: existing?.subCategory || "" });
  const pb = field({ label: "السعر قبل الخصم", name: "priceBefore", type: "number", value: existing?.priceBefore ?? "" });
  const pa = field({ label: "السعر بعد الخصم *", name: "priceAfter", type: "number", value: existing?.priceAfter ?? "" });

  const body = el("div", {}, [name.wrap,
    el("div", { class: "form-row" }, [cat.wrap, sub.wrap]),
    el("div", { class: "form-row" }, [pb.wrap, pa.wrap])]);

  modal({
    title: existing ? "تعديل صنف" : "إضافة صنف",
    body,
    actions: [
      { label: "إلغاء", class: "btn-light", onClick: ({ close }) => close() },
      {
        label: "حفظ", class: "btn-primary",
        onClick: async ({ close, button }) => {
          const payload = {
            name: name.input.value.trim(),
            category: cat.input.value.trim(),
            subCategory: sub.input.value.trim(),
            priceBefore: Number(pb.input.value) || 0,
            priceAfter: Number(pa.input.value) || 0,
            updatedAt: serverTimestamp(),
          };
          if (!payload.name) return toast("اكتب اسم الصنف", "error");
          button.disabled = true;
          try {
            const id = existing?.id || productId(payload.name);
            await setDoc(doc(db, ...tenantPath("products"), id), payload, { merge: true });
            toast("تم الحفظ", "success");
            close();
            reload();
          } catch (e) { button.disabled = false; toast("فشل الحفظ: " + e.message, "error"); }
        },
      },
    ],
  });
}

async function removeProduct(p) {
  if (!(await confirmBox(`هتمسح صنف "${p.name}"؟`, { title: "حذف صنف" }))) return;
  try {
    await deleteDoc(doc(db, ...tenantPath("products"), p.id));
    toast("تم الحذف", "success");
    reload();
  } catch (e) { toast("فشل الحذف: " + e.message, "error"); }
}

// ---------- الاستيراد ----------
function importDialog() {
  const body = el("div");
  body.append(el("p", { class: "text-muted", style: "margin-bottom:14px",
    text: "ارفع ملف Excel (.xlsx) أو CSV. النظام هيقرأ الأعمدة أوتوماتيك، ولو الصنف موجود قبل كده هيحدّث سعره بدل ما يكرره." }));

  const drop = el("div", { class: "file-drop" }, [
    el("i", { class: "fas fa-cloud-arrow-up" }),
    el("strong", { text: "اضغط هنا لاختيار الملف" }),
    el("p", { class: "hint", text: ".xlsx / .xls / .csv" }),
  ]);
  const input = el("input", { type: "file", accept: ".xlsx,.xls,.csv", style: "display:none" });
  const result = el("div", { style: "margin-top:16px" });
  body.append(drop, input, result);

  drop.addEventListener("click", () => input.click());
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault(); drop.classList.remove("over");
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0], result, m);
  });
  input.addEventListener("change", () => { if (input.files[0]) handleFile(input.files[0], result, m); });

  const m = modal({ title: "استيراد الأصناف", body, width: 620,
    actions: [{ label: "إغلاق", class: "btn-light", onClick: ({ close }) => close() }] });
}

async function handleFile(file, result, m) {
  result.innerHTML = "";
  result.append(spinner("جاري قراءة الملف..."));

  try {
    if (typeof XLSX === "undefined") throw new Error("مكتبة قراءة الإكسيل لسه بتحمّل، جرب بعد ثانيتين.");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (!rows.length) throw new Error("الملف فاضي.");

    const mapped = rows.map(mapRow).filter((r) => r.name);
    if (!mapped.length) throw new Error("مش لاقي عمود لاسم الصنف. تأكد إن فيه عمود اسمه: اسم الصنف / الصنف / name.");

    result.innerHTML = "";
    result.append(el("div", { class: "ai-insight", html:
      `<strong>تمت القراءة</strong>عدد الصفوف الصالحة: <b>${mapped.length}</b> من ${rows.length}` }));

    // معاينة أول 5 صفوف
    const prev = el("div", { class: "table-wrap", style: "margin-top:12px" });
    prev.innerHTML = `<table class="data"><thead><tr><th>الصنف</th><th>رئيسي</th><th>فرعي</th><th>قبل</th><th>بعد</th></tr></thead>
      <tbody>${mapped.slice(0, 5).map((r) =>
        `<tr><td>${esc(r.name)}</td><td>${esc(r.category)}</td><td>${esc(r.subCategory)}</td><td>${r.priceBefore}</td><td>${r.priceAfter}</td></tr>`).join("")}</tbody></table>`;
    result.append(prev);

    const go = el("button", { class: "btn btn-primary", style: "margin-top:14px",
      html: `<i class="fas fa-database"></i> حفظ ${mapped.length} صنف` });
    go.addEventListener("click", async () => {
      go.disabled = true;
      go.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحفظ...';
      try {
        await saveBatch(mapped, (done) => { go.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${done}/${mapped.length}`; });
        toast(`تم استيراد ${mapped.length} صنف`, "success");
        m.close();
        reload();
      } catch (e) {
        go.disabled = false;
        go.innerHTML = "إعادة المحاولة";
        toast("فشل الاستيراد: " + e.message, "error");
      }
    });
    result.append(go);
  } catch (e) {
    result.innerHTML = "";
    result.append(el("div", { class: "ai-insight danger", html: `<strong>مشكلة في الملف</strong>${esc(e.message)}` }));
  }
}

/** بيحاول يلاقي الأعمدة بأسماء عربية أو إنجليزية مختلفة */
function mapRow(row) {
  const get = (...keys) => {
    for (const k of Object.keys(row)) {
      const clean = String(k).trim().toLowerCase().replace(/\s+/g, " ");
      if (keys.some((key) => clean === key || clean.includes(key))) return row[k];
    }
    return "";
  };
  const num = (v) => {
    const n = parseFloat(String(v).replace(/[^\d.]/g, ""));
    return isNaN(n) ? 0 : n;
  };
  const priceAfter = num(get("السعر بعد الخصم", "بعد الخصم", "سعر البيع", "price after", "priceafter", "sale price"));
  const priceBefore = num(get("السعر قبل الخصم", "قبل الخصم", "السعر الأصلي", "price before", "pricebefore"));
  return {
    name: String(get("اسم الصنف", "الصنف", "المنتج", "اسم المنتج", "name", "product")).trim(),
    category: String(get("القسم الرئيسي", "القسم الرئيسى", "قسم رئيسي", "main category", "category")).trim(),
    subCategory: String(get("القسم الفرعي", "القسم الفرعى", "قسم فرعي", "sub category", "subcategory")).trim(),
    priceBefore: priceBefore || priceAfter,
    priceAfter: priceAfter || priceBefore,
  };
}

async function saveBatch(items, onProgress) {
  const CHUNK = 400;
  for (let i = 0; i < items.length; i += CHUNK) {
    const batch = writeBatch(db);
    items.slice(i, i + CHUNK).forEach((p) => {
      batch.set(doc(db, ...tenantPath("products"), productId(p.name)), {
        ...p, updatedAt: serverTimestamp(),
      }, { merge: true });
    });
    await batch.commit();
    onProgress?.(Math.min(i + CHUNK, items.length));
  }
}

/** معرّف ثابت مبني على اسم الصنف عشان الاستيراد المتكرر يحدّث بدل ما يكرر */
function productId(name) {
  const clean = String(name).trim().toLowerCase().replace(/\s+/g, "-").replace(/[/\\.#$\[\]]/g, "");
  return clean.slice(0, 120) || "item-" + Math.random().toString(36).slice(2, 8);
}

// ---------- التصدير ----------
function exportCsv() {
  if (!products.length) return toast("مفيش أصناف للتصدير", "warn");
  const head = ["اسم الصنف", "القسم الرئيسي", "القسم الفرعي", "السعر قبل الخصم", "السعر بعد الخصم"];
  const lines = products.map((p) => [p.name, p.category, p.subCategory, p.priceBefore, p.priceAfter]
    .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
  const csv = "﻿" + [head.join(","), ...lines].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = el("a", { href: url, download: `nexo-products-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
  URL.revokeObjectURL(url);
  toast("تم تحميل الملف", "success");
}

function mkBtn(label, cls, icon, onClick) {
  const b = el("button", { class: `btn ${cls}` }, [icon ? el("i", { class: `fas ${icon}` }) : null, label || null]);
  b.addEventListener("click", onClick);
  return b;
}

function reload() { import("../router.js").then((r) => r.reloadCurrent()); }

export function destroy() { products = []; filtered = []; tbodyRef = null; countRef = null; }
