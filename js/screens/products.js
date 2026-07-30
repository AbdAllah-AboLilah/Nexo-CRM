// ============================================================
//  المخزون والأصناف
//  مبني للأعداد الكبيرة (عشرات الآلاف): الصفحة بتجيب 50 صنف بس من
//  السيرفر، والفلترة والبحث بيتنفذوا هناك مش في المتصفح.
// ============================================================
import {
  db, collection, doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch,
  query, where, orderBy, limit, startAfter, getCountFromServer, serverTimestamp,
  storage, storageRef, uploadBytesResumable, getDownloadURL,
} from "../firebase.js";
import { session, tenantPath, atLeast } from "../auth.js";
import { el, card, esc, toast, modal, confirmBox, field, spinner, emptyState, money, fmtDate } from "../ui.js";
import { tokenize, queryTokens, TOKEN_VERSION } from "../search.js";

const PAGE = 50;   // عدد الأصناف في الصفحة الواحدة

// آخر حرف في ترتيب يونيكود — بيستخدم مع >= عشان نعمل بحث "بيبدأ بـ"
// في فايربيز. مكتوب كتسلسل هروب عشان مايضيعش في المحررات.
const PREFIX_END = "\uf8ff";

let rows = [];              // أصناف الصفحة الحالية بس
let cursors = [];           // آخر مستند في كل صفحة — للتنقّل للأمام
let pageIndex = 0;
let hasNext = false;
let totalCount = null;      // بيتحسب من السيرفر مرة واحدة لكل فلتر

const selected = new Map(); // id → name (بيفضل محفوظ وإنت بتقلّب الصفحات)
const filters = { text: "", category: "", subCategory: "" };
let knownCats = { categories: [], subByCat: {} };
let indexed = false;        // هل الأصناف اتفهرست بأحدث شكل للكلمات؟
let wasIndexed = false;     // اتفهرست قبل كده بس بنسخة أقدم

let tbodyRef, countRef, pagerRef, bulkRef, bodyRef, selAllRef, bannerRef;

const FIELDS = [
  { key: "name",        label: "اسم الصنف",        required: true },
  { key: "barcode",     label: "الباركود",         required: false },
  { key: "category",    label: "القسم الرئيسي",    required: false },
  { key: "subCategory", label: "القسم الفرعي",     required: false },
  { key: "priceBefore", label: "السعر قبل الخصم",  required: false, num: true },
  { key: "priceAfter",  label: "السعر بعد الخصم",  required: true,  num: true },
];

export async function render(root) {
  const canEdit = atLeast("manager");

  root.append(el("div", { class: "page-head" }, [
    el("div", {}, [
      el("h2", { text: "المخزون والأصناف" }),
      el("div", { class: "sub", text: "الأسعار دي هي اللي الذكاء الاصطناعي بيرد بيها على العملاء" }),
    ]),
    el("div", { class: "head-actions" }, canEdit ? [
      mkBtn("استيراد Excel / CSV", "btn-primary", "fa-file-import", importWizard),
      mkBtn("إضافة صنف", "btn-ghost", "fa-plus", () => productForm()),
      mkBtn("تصدير", "btn-ghost", "fa-file-export", exportCsv),
      // مسح الكل لصاحب المكان بس — عملية مالهاش رجوع
      atLeast("owner") ? mkBtn("احذف كل الأصناف", "btn-ghost danger-ghost", "fa-trash-can", wipeAllDialog) : null,
    ] : []),
  ]));

  await loadKnownCategories();

  bannerRef = el("div");
  root.append(bannerRef);
  root.append(buildFilterBar());

  bulkRef = el("div", { class: "bulk-bar", style: "display:none" });
  root.append(bulkRef);

  bodyRef = el("div");
  root.append(bodyRef);

  await goToPage(0, canEdit);
  drawIndexBanner(canEdit);
}

/**
 * الأصناف المرفوعة قبل ما نضيف كلمات البحث مالهاش فهرسة، فالبحث
 * جوّه النص وقايمة الأقسام مش هيشتغلوا لحد ما نفهرسها مرة واحدة.
 */
function drawIndexBanner(canEdit) {
  if (!bannerRef) return;
  bannerRef.innerHTML = "";
  if (indexed || !canEdit) return;
  // مفيش أصناف أصلاً؟ مفيش حاجة تتفهرس
  if (totalCount === 0) return;

  const box = el("div", { class: "ai-insight warn", style: "margin-bottom:14px" });
  box.innerHTML = wasIndexed
    ? `<strong>البحث اتطوّر — محتاج فهرسة جديدة</strong>
       بقى ينفع تدوّر بأول حرف أو بجزء من الكلمة (مثلاً «موباي» تلاقي «موبايل»).
       عشان ده يشتغل على أصنافك، لازم نعيد الفهرسة مرة واحدة.
       العملية على السيرفر وماتأثرش على بياناتك.`
    : `<strong>الأصناف محتاجة فهرسة</strong>
       عشان البحث يلاقي الكلمة في أي مكان في الاسم — حتى بأول حرف —
       وعشان قوايم الأقسام تتملي، لازم نفهرس الأصناف مرة واحدة.
       العملية بتتنفذ على السيرفر وماتأثرش على بياناتك.`;

  const btn = el("button", { class: "btn btn-primary btn-sm", style: "margin-top:12px",
    html: `<i class="fas fa-wand-magic-sparkles"></i> ${wasIndexed ? "أعد الفهرسة" : "افهرس الأصناف دلوقتي"}` });
  btn.addEventListener("click", () => runReindex(btn));
  box.append(btn);
  bannerRef.append(box);
}

async function runReindex(btn) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> بيفهرس... (ممكن ياخد دقيقة)';
  try {
    const { fns, httpsCallable } = await import("../firebase.js");
    const res = await httpsCallable(fns, "reindexProducts")({ companyId: session.companyId });
    const { scanned, categories } = res.data;
    indexed = true; wasIndexed = true;
    await loadKnownCategories();
    refreshSubOptions();
    catComboRef?.rebuild();
    toast(`اتفهرس ${scanned} صنف · ${categories} قسم`, "success");
    bannerRef.innerHTML = "";
    totalCount = null;
    cursors = [];
    await goToPage(0);
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = old;
    toast("فشلت الفهرسة: " + (e.message || ""), "error");
  }
}

// ---------- شريط الفلترة ----------
function buildFilterBar() {
  const box = el("div", { class: "card filter-bar" });

  const search = el("input", { class: "form-control", value: filters.text,
    placeholder: "ابحث بأي كلمة في اسم الصنف، أو بالباركود..." });
  let t;
  search.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => { filters.text = search.value.trim(); resetAndReload(); }, 350);
  });

  // كومبو: تختار من الأقسام الموجودة فعلاً، أو تكتب اللي إنت عايزه
  const cat = combo("القسم الرئيسي", filters.category, () => knownCats.categories, (v) => {
    filters.category = v;
    filters.subCategory = "";
    sub.setValue("");
    resetAndReload();
    refreshSubOptions();
  });
  catComboRef = cat;
  const sub = combo("القسم الفرعي", filters.subCategory, () => subOptions(), (v) => {
    filters.subCategory = v;
    resetAndReload();
  });
  subComboRef = sub;

  const clear = el("button", { class: "btn btn-light btn-sm", html: '<i class="fas fa-filter-circle-xmark"></i> مسح الفلاتر' });
  clear.addEventListener("click", () => {
    filters.text = ""; filters.category = ""; filters.subCategory = "";
    search.value = ""; cat.setValue(""); sub.setValue("");
    resetAndReload(); refreshSubOptions();
  });

  countRef = el("span", { class: "text-muted", style: "font-size:13px;white-space:nowrap" });

  box.append(
    el("div", { class: "filter-row-1" }, [search]),
    el("div", { class: "filter-row-2" }, [cat.wrap, sub.wrap, clear, countRef]),
  );
  return box;
}

let subComboRef = null;
let catComboRef = null;
function subOptions() {
  if (filters.category) return knownCats.subByCat[filters.category] || [];
  return [...new Set(Object.values(knownCats.subByCat).flat())].sort();
}
function refreshSubOptions() { subComboRef?.rebuild(); }

/**
 * حقل بيجمع الاتنين: قايمة بالأقسام الموجودة فعلاً + كتابة حرة.
 * `datalist` بيدي الاقتراحات من غير ما يمنعك تكتب حاجة مش في القايمة.
 */
function combo(label, value, getOptions, onChange) {
  const id = "dl_" + Math.random().toString(36).slice(2, 8);
  const input = el("input", { class: "form-control", value: value || "", list: id,
    placeholder: `${label} — اختار أو اكتب` });
  const dl = el("datalist", { id });

  function rebuild() {
    dl.innerHTML = "";
    getOptions().forEach((o) => dl.append(el("option", { value: o })));
  }
  rebuild();

  let t;
  input.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => onChange(input.value.trim()), 350);
  });
  input.addEventListener("change", () => { clearTimeout(t); onChange(input.value.trim()); });

  const wrap = el("div", { class: "combo" }, [input, dl]);
  return { wrap, input, rebuild, setValue: (v) => { input.value = v; } };
}

/** قايمة الأقسام محفوظة في مستند واحد — أرخص بكتير من مسح كل الأصناف */
async function loadKnownCategories() {
  try {
    const snap = await getDoc(doc(db, ...tenantPath("meta"), "categories"));
    if (snap.exists()) {
      const d = snap.data();
      knownCats = {
        categories: Array.isArray(d.categories) ? d.categories : [],
        subByCat: d.subByCat && typeof d.subByCat === "object" ? d.subByCat : {},
      };
      // فهرسة قديمة = زي ما تكون مفيش فهرسة، لأن شكل الكلمات اتغيّر
      wasIndexed = !!d.indexedAt;
      indexed = wasIndexed && d.tokenVersion === TOKEN_VERSION;
    }
  } catch { /* مش مشكلة — الحقول هتبقى كتابة حرة */ }
}

async function saveKnownCategories(items) {
  const cats = new Set(knownCats.categories);
  const subs = {};
  Object.entries(knownCats.subByCat).forEach(([k, v]) => { subs[k] = new Set(v); });

  items.forEach((p) => {
    const c = String(p.category || "").trim();
    const s = String(p.subCategory || "").trim();
    if (c) cats.add(c);
    if (c && s) { (subs[c] = subs[c] || new Set()).add(s); }
  });

  const payload = {
    categories: [...cats].sort().slice(0, 500),
    subByCat: Object.fromEntries(
      Object.entries(subs).map(([k, v]) => [k, [...v].sort().slice(0, 300)]).slice(0, 500)),
    updatedAt: serverTimestamp(),
  };
  try {
    await setDoc(doc(db, ...tenantPath("meta"), "categories"), payload, { merge: true });
    knownCats = { categories: payload.categories, subByCat: payload.subByCat };
    refreshSubOptions();
  } catch (e) { console.warn("تعذّر حفظ قايمة الأقسام:", e.message); }
}

// ---------- بناء الاستعلام ----------
/**
 * الفلترة بتتنفذ على السيرفر عشان مانجيبش عشرات الآلاف للمتصفح.
 *
 * البحث: كل صنف متخزّن معاه مصفوفة `tokens` فيها كلمات اسمه وأقسامه
 * وباركوده. فبنبحث بـ array-contains — يعني "موبايل" بتلاقي
 * "شاشة موبايل" مش بس اللي بيبدأ بيها.
 *
 * فايرستور بيسمح بـ array-contains واحد بس في الاستعلام، فلو المستخدم
 * كتب أكتر من كلمة بنستعلم بأطول كلمة والباقي بيتفلتر على الصفحة.
 */
function searchTerms() {
  const t = filters.text.trim();
  if (!t) return { tokens: [], barcode: null };

  // باركود كامل؟ بحث مباشر — أسرع وأدق حاجة
  if (/^[\w-]{6,}$/.test(t) && !/\s/.test(t)) return { tokens: [], barcode: t };

  // أطول كلمة أقل شيوعاً، فبتقلّل النتايج اللي بتترجع
  const toks = queryTokens(t).sort((a, b) => b.length - a.length);
  return { tokens: toks, barcode: null };
}

function applyFilters(parts) {
  const { tokens, barcode } = searchTerms();

  if (barcode) { parts.push(where("barcode", "==", barcode)); return { extra: [] }; }

  if (filters.category) parts.push(where("category", "==", filters.category));
  if (filters.subCategory) parts.push(where("subCategory", "==", filters.subCategory));
  if (tokens.length) parts.push(where("tokens", "array-contains", tokens[0]));

  return { extra: tokens.slice(1) };   // الكلمات الباقية بتتفلتر على الصفحة
}

function buildQuery(afterDoc) {
  const parts = [collection(db, ...tenantPath("products"))];
  const { barcode } = searchTerms();
  const { extra } = applyFilters(parts);

  if (barcode) { parts.push(limit(PAGE + 1)); return { q: query(...parts), extra }; }

  parts.push(orderBy("name"));
  if (afterDoc) parts.push(startAfter(afterDoc));
  // لما فيه كلمات زيادة بنجيب أكتر عشان الفلترة الإضافية ماتفضّيش الصفحة
  parts.push(limit(extra.length ? (PAGE + 1) * 4 : PAGE + 1));
  return { q: query(...parts), extra };
}

function countQuery() {
  const parts = [collection(db, ...tenantPath("products"))];
  applyFilters(parts);
  return query(...parts);
}

function resetAndReload() {
  cursors = [];
  pageIndex = 0;
  totalCount = null;
  goToPage(0);
}

async function goToPage(index, canEdit = atLeast("manager")) {
  bodyRef.innerHTML = "";
  bodyRef.append(spinner("جاري التحميل..."));

  try {
    const after = index > 0 ? cursors[index - 1] : null;
    const { q, extra } = buildQuery(after);
    const snap = await getDocs(q);
    let docs = snap.docs;

    // المؤشّر لازم يتاخد من آخر مستند **رجع من السيرفر**، مش من آخر
    // مستند بعد الفلترة — وإلا التقليب هيتخطى صفوف
    const lastServerDoc = docs.length ? docs[docs.length - 1] : null;

    if (extra.length) {
      docs = docs.filter((d) => {
        const tk = d.data().tokens || [];
        return extra.every((w) => tk.includes(w));
      });
    }

    hasNext = extra.length ? snap.docs.length > PAGE : docs.length > PAGE;
    const pageDocs = docs.slice(0, PAGE);
    rows = pageDocs.map((d) => ({ id: d.id, ...d.data() }));

    if (lastServerDoc) {
      cursors[index] = extra.length
        ? (docs.length > PAGE ? pageDocs[pageDocs.length - 1] : lastServerDoc)
        : pageDocs[pageDocs.length - 1] || lastServerDoc;
    }
    pageIndex = index;

    drawTable(canEdit);
    updateBulkBar();
    refreshCount(extra.length > 0);
  } catch (e) {
    bodyRef.innerHTML = "";
    bodyRef.append(el("div", { class: "ai-insight danger", html:
      `<strong>تعذّر التحميل</strong>${esc(e.message)}${
        /index/i.test(e.message) ? "<br><br>الفلتر ده محتاج فهرس في فايربيز — افتح اللينك اللي في رسالة الخطأ في الكونسول وهو هيتعمل لوحده." : ""}` }));
  }
}

let countIsApprox = false;

async function refreshCount(approx = false) {
  countIsApprox = approx;
  if (!countRef) return;
  if (totalCount != null) { paintCount(); return; }
  countRef.textContent = "بيعد...";
  try {
    const c = await getCountFromServer(countQuery());
    totalCount = c.data().count;
  } catch { totalCount = -1; }
  paintCount();
  drawPager();
}

function paintCount() {
  if (!countRef) return;
  if (!rows.length) { countRef.textContent = "مفيش نتايج"; return; }
  const from = pageIndex * PAGE + 1;
  const to = pageIndex * PAGE + rows.length;
  if (totalCount < 0) { countRef.textContent = `${from}–${to}`; return; }
  // مع أكتر من كلمة بحث، العدّ بيبقى للكلمة الأولى بس — فبنقول "لحد"
  countRef.textContent = countIsApprox
    ? `${from}–${to} · لحد ${totalCount} نتيجة`
    : `${from}–${to} من ${totalCount} صنف`;
}

// ---------- الجدول ----------
function drawTable(canEdit) {
  bodyRef.innerHTML = "";

  if (!rows.length) {
    const filtering = filters.text || filters.category || filters.subCategory;
    bodyRef.append(emptyState("fa-box-open",
      filtering ? "مفيش نتايج للفلتر ده" : "مفيش أصناف لسه",
      filtering
        ? (indexed
            ? "مفيش صنف مطابق. البحث بيلاقي أي كلمة في الاسم من أولها — جرّب كلمة تانية."
            : "الأصناف لسه مش مفهرسة، فالبحث مش هيشتغل. اضغط الزرار اللي فوق الأول.")
        : "ارفع ملف Excel أو CSV — هتختار بنفسك أنهي عمود في الملف يروح لأنهي حقل في النظام. لو ملفك فيه عمود باركود اربطه، لأنه بيبقى مفتاح الصنف.",
      !filtering && canEdit ? mkBtn("استيراد ملف", "btn-primary", "fa-file-import", importWizard) : null));
    drawPager();
    return;
  }

  // تقليب فوق كمان — مع 50 صف مش منطقي تنزل لتحت كل مرة
  bodyRef.append(makePager("top"));

  const wrap = el("div", { class: "table-wrap" });
  const table = el("table", { class: "data" });

  const selAll = el("input", { type: "checkbox", title: "حدد كل اللي في الصفحة دي" });
  selAllRef = selAll;
  selAll.addEventListener("change", () => {
    rows.forEach((p) => {
      if (selAll.checked) selected.set(p.id, p.name);
      else selected.delete(p.id);
    });
    drawRows(canEdit);
    updateBulkBar();
  });

  const thead = el("thead");
  const hr = el("tr");
  hr.append(el("th", { style: "width:36px" }, canEdit ? [selAll] : []));
  hr.append(el("th", { style: "width:52px" }));
  ["اسم الصنف", "الباركود", "القسم الرئيسي", "القسم الفرعي", "قبل الخصم", "بعد الخصم", "آخر تحديث"]
    .forEach((h) => hr.append(el("th", { text: h })));
  if (canEdit) hr.append(el("th"));
  thead.append(hr);
  table.append(thead);

  tbodyRef = el("tbody");
  table.append(tbodyRef);
  wrap.append(table);
  bodyRef.append(wrap);

  drawRows(canEdit);
  drawPager();
}

function drawRows(canEdit) {
  if (!tbodyRef) return;
  tbodyRef.innerHTML = "";

  rows.forEach((p) => {
    const discount = p.priceBefore > p.priceAfter && p.priceBefore > 0
      ? Math.round((1 - p.priceAfter / p.priceBefore) * 100) : 0;
    const isSel = selected.has(p.id);
    const tr = el("tr", { class: isSel ? "row-selected" : "", style: "cursor:pointer" });

    const cbTd = el("td");
    if (canEdit) {
      const cb = el("input", { type: "checkbox" });
      cb.checked = isSel;
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", () => {
        if (cb.checked) selected.set(p.id, p.name); else selected.delete(p.id);
        tr.classList.toggle("row-selected", cb.checked);
        syncSelAll();
        updateBulkBar();
      });
      cbTd.append(cb);
    }
    tr.append(cbTd);

    const imgTd = el("td");
    imgTd.innerHTML = p.image
      ? `<img src="${esc(p.image)}" class="prod-thumb" alt="">`
      : `<span class="prod-thumb empty"><i class="fas fa-image"></i></span>`;
    tr.append(imgTd);

    const rest = el("template");
    rest.innerHTML = `
      <td><strong>${esc(p.name)}</strong></td>
      <td class="text-muted" style="font-size:12px;font-family:monospace">${esc(p.barcode || "—")}</td>
      <td class="text-muted" style="font-size:13px">${esc(p.category || "—")}</td>
      <td class="text-muted" style="font-size:13px">${esc(p.subCategory || "—")}</td>
      <td>${p.priceBefore ? `<s class="text-muted">${money(p.priceBefore)}</s>` : "—"}</td>
      <td><strong style="color:var(--success)">${money(p.priceAfter)}</strong>
          ${discount > 0 ? `<span class="badge badge-red" style="margin-inline-start:6px">-${discount}%</span>` : ""}</td>
      <td class="text-muted" style="font-size:12px">${fmtDate(p.updatedAt)}</td>`;
    tr.append(...rest.content.children);

    tr.addEventListener("click", (e) => {
      if (e.target.closest(".row-actions") || e.target.tagName === "INPUT") return;
      productView(p);
    });

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
  syncSelAll();
}

function syncSelAll() {
  if (!selAllRef || !rows.length) return;
  const on = rows.filter((p) => selected.has(p.id)).length;
  selAllRef.checked = on === rows.length;
  selAllRef.indeterminate = on > 0 && on < rows.length;
}

// ---------- شريط التحديد ----------
function updateBulkBar() {
  if (!bulkRef) return;
  bulkRef.innerHTML = "";
  if (!selected.size) { bulkRef.style.display = "none"; return; }
  bulkRef.style.display = "";

  bulkRef.append(el("span", { class: "bulk-count", html:
    `<i class="fas fa-check-double"></i> <b>${selected.size}</b> صنف محدد` }));

  const onOther = selected.size - rows.filter((p) => selected.has(p.id)).length;
  if (onOther > 0) {
    bulkRef.append(el("small", { class: "text-muted", text: `(منهم ${onOther} من صفحات تانية)` }));
  }

  const del = el("button", { class: "btn btn-danger btn-sm", html: '<i class="fas fa-trash"></i> احذف المحدد' });
  del.addEventListener("click", bulkDelete);

  const clear = el("button", { class: "btn btn-light btn-sm", text: "إلغاء التحديد" });
  clear.addEventListener("click", () => {
    selected.clear();
    drawRows(atLeast("manager"));
    updateBulkBar();
  });

  bulkRef.append(el("div", { class: "bulk-actions" }, [del, clear]));
}

async function bulkDelete() {
  const n = selected.size;
  if (!n) return;
  const names = [...selected.values()].slice(0, 3).join("، ");
  const ok = await confirmBox(
    `هتمسح ${n} صنف نهائياً.\n\n${names}${n > 3 ? ` وغيرهم (${n - 3} كمان)` : ""}\n\nالعملية دي مالهاش رجوع.`,
    { title: `حذف ${n} صنف` });
  if (!ok) return;

  const ids = [...selected.keys()];
  const prog = el("div", { class: "ai-insight", html: `<strong>جاري الحذف</strong>0 من ${n}` });
  bulkRef.prepend(prog);

  try {
    const CHUNK = 400;
    let done = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = writeBatch(db);
      ids.slice(i, i + CHUNK).forEach((id) => batch.delete(doc(db, ...tenantPath("products"), id)));
      await batch.commit();
      done = Math.min(i + CHUNK, ids.length);
      prog.innerHTML = `<strong>جاري الحذف</strong>${done} من ${n}`;
    }
    selected.clear();
    toast(`تم حذف ${n} صنف`, "success");
    totalCount = null;
    cursors = [];
    await goToPage(0);
  } catch (e) {
    toast("فشل الحذف: " + e.message, "error");
    prog.remove();
  }
}

// ---------- التنقّل بين الصفحات (فوق الجدول وتحته) ----------
function makePager(pos) {
  const bar = el("div", { class: `pager pager-${pos}` });

  const first = el("button", { class: "btn btn-light btn-sm", html: '<i class="fas fa-angles-right"></i>',
    title: "أول صفحة" });
  first.disabled = pageIndex === 0;
  first.addEventListener("click", () => goToPage(0));

  const prev = el("button", { class: "btn btn-light btn-sm", html: '<i class="fas fa-chevron-right"></i> السابق' });
  prev.disabled = pageIndex === 0;
  prev.addEventListener("click", () => goToPage(pageIndex - 1));

  const next = el("button", { class: "btn btn-light btn-sm", html: 'التالي <i class="fas fa-chevron-left"></i>' });
  next.disabled = !hasNext;
  next.addEventListener("click", () => goToPage(pageIndex + 1));

  const pages = totalCount > 0 ? Math.max(1, Math.ceil(totalCount / PAGE)) : 0;
  const label = el("span", { class: "pager-label", text:
    pages ? `صفحة ${pageIndex + 1} من ${pages}` : `صفحة ${pageIndex + 1}` });

  bar.append(first, prev, label, next);
  return bar;
}

function drawPager() {
  // بنجدّد الاتنين مع بعض عشان يفضلوا متطابقين
  bodyRef?.querySelectorAll(".pager-bottom").forEach((x) => x.remove());
  pagerRef = makePager("bottom");
  bodyRef?.append(pagerRef);

  const top = bodyRef?.querySelector(".pager-top");
  if (top) top.replaceWith(makePager("top"));
}

/** بحث في الأصناف من شاشات تانية (الناشر بيستخدمه) — من السيرفر مباشرة */
export async function searchProducts(term) {
  const t = String(term || "").trim();
  if (t.length < 2) return [];
  const col = collection(db, ...tenantPath("products"));

  // باركود كامل الأول
  if (/^[\w-]{6,}$/.test(t) && !/\s/.test(t)) {
    const bc = await getDocs(query(col, where("barcode", "==", t), limit(10)));
    if (!bc.empty) return bc.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  const toks = queryTokens(t).sort((a, b) => b.length - a.length);
  if (!toks.length) return [];

  const snap = await getDocs(query(col,
    where("tokens", "array-contains", toks[0]), orderBy("name"), limit(40)));
  const rest = toks.slice(1);

  let hits = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (rest.length) {
    hits = hits.filter((p) => rest.every((w) => (p.tokens || []).includes(w)));
  }

  // اللي اسمه بيبدأ باللي كتبته يطلع الأول — أقرب لقصد المستخدم
  const rank = (p) => (String(p.name || "").toLowerCase().startsWith(t.toLowerCase()) ? 0 : 1);
  hits.sort((a, b) => rank(a) - rank(b));
  return hits.slice(0, 20);
}

// ---------- شاشة عرض الصنف ----------
function productView(p) {
  const canEdit = atLeast("manager");
  const img = el("div", { class: "prod-view-img" });
  const drawImg = () => {
    img.innerHTML = "";
    img.append(p.image
      ? el("img", { src: p.image, alt: p.name })
      : el("div", { class: "prod-view-empty" }, [
          el("i", { class: "fas fa-image" }),
          el("span", { text: "مفيش صورة للصنف" }),
        ]));
  };
  drawImg();

  const info = el("table", { class: "data prod-view-table" });
  info.innerHTML = `<tbody>${[
    ["الباركود", p.barcode || "—"],
    ["القسم الرئيسي", p.category || "—"],
    ["القسم الفرعي", p.subCategory || "—"],
    ["السعر قبل الخصم", p.priceBefore ? money(p.priceBefore) : "—"],
    ["السعر بعد الخصم", money(p.priceAfter)],
    ["آخر تحديث", fmtDate(p.updatedAt)],
  ].map(([k, v]) => `<tr><td class="text-muted">${esc(k)}</td><td><strong>${esc(String(v))}</strong></td></tr>`).join("")}</tbody>`;

  const body = el("div", { class: "prod-view" }, [img, info]);

  const actions = [{ label: "إغلاق", class: "btn-light", onClick: ({ close }) => close() }];
  if (canEdit) actions.push({ label: "تعديل", class: "btn-primary", onClick: ({ close }) => { close(); productForm(p); } });
  const m = modal({ title: p.name, body, width: 640, actions });

  if (canEdit) {
    const up = el("button", { class: "btn btn-ghost btn-sm", style: "margin-top:10px",
      html: `<i class="fas fa-camera"></i> ${p.image ? "تغيير الصورة" : "إضافة صورة"}` });
    const inp = el("input", { type: "file", accept: "image/*", style: "display:none" });
    up.addEventListener("click", () => inp.click());
    inp.addEventListener("change", async () => {
      const f = inp.files[0];
      if (!f) return;
      up.disabled = true;
      up.innerHTML = '<i class="fas fa-spinner fa-spin"></i> بيرفع...';
      try {
        const url = await uploadProductImage(f, p.id);
        await setDoc(doc(db, ...tenantPath("products"), p.id), { image: url, updatedAt: serverTimestamp() }, { merge: true });
        p.image = url;
        const local = rows.find((x) => x.id === p.id);
        if (local) local.image = url;
        drawImg(); drawRows(canEdit);
        toast("تم رفع الصورة", "success");
      } catch (e) { toast("فشل الرفع: " + e.message, "error"); }
      up.disabled = false;
      up.innerHTML = '<i class="fas fa-camera"></i> تغيير الصورة';
    });
    body.append(up, inp);
  }
  return m;
}

function uploadProductImage(file, productDocId) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error("لازم تكون صورة"));
    if (file.size > 10 * 1024 * 1024) return reject(new Error("الصورة أكبر من 10 ميجا"));
    const safe = file.name.replace(/[^\w.\-]/g, "_").slice(-40);
    const path = `companies/${session.companyId}/products/${productDocId}_${Date.now()}_${safe}`;
    const task = uploadBytesResumable(storageRef(storage, path), file, { contentType: file.type });
    task.on("state_changed", null, reject, async () => resolve(await getDownloadURL(task.snapshot.ref)));
  });
}

// ---------- إضافة / تعديل ----------
function productForm(existing = null) {
  const name = field({ label: "اسم الصنف *", name: "name", value: existing?.name || "" });
  const barcode = field({ label: "الباركود", name: "barcode", value: existing?.barcode || "",
    hint: existing ? "" : "الباركود هو مفتاح الصنف — لو حطيته، تقدر تغيّر الاسم بعد كده والصنف يفضل هو هو." });
  const cat = field({ label: "القسم الرئيسي", name: "category", value: existing?.category || "" });
  const sub = field({ label: "القسم الفرعي", name: "subCategory", value: existing?.subCategory || "" });
  const pb = field({ label: "السعر قبل الخصم", name: "priceBefore", type: "number", value: existing?.priceBefore ?? "" });
  const pa = field({ label: "السعر بعد الخصم *", name: "priceAfter", type: "number", value: existing?.priceAfter ?? "" });

  // اقتراحات الأقسام من اللي موجود فعلاً
  attachSuggestions(cat.input, () => knownCats.categories);
  attachSuggestions(sub.input, () => knownCats.subByCat[cat.input.value.trim()] || subOptions());

  // ---------- صورة الصنف ----------
  // الرفع بيحصل وقت الحفظ عن قصد: الصنف الجديد لسه مالوش معرّف،
  // ولو المستخدم لغى مايكونش رفع حاجة على الفاضي.
  let imageUrl = existing?.image || "";
  let pendingFile = null;
  let removeImage = false;

  const imgBox = el("div", { class: "prod-img-field" });
  const preview = el("div", { class: "pif-preview" });
  const pifActions = el("div", { class: "pif-actions" });
  const fileInput = el("input", { type: "file", accept: "image/*", style: "display:none" });

  function drawImgField() {
    preview.innerHTML = "";
    pifActions.innerHTML = "";

    const shown = removeImage ? "" : (pendingFile ? URL.createObjectURL(pendingFile) : imageUrl);
    preview.append(shown
      ? el("img", { src: shown, alt: "" })
      : el("div", { class: "pif-empty" }, [
          el("i", { class: "fas fa-image" }),
          el("span", { text: "مفيش صورة" }),
        ]));

    const pick = el("button", { class: "btn btn-light btn-sm", type: "button",
      html: `<i class="fas fa-camera"></i> ${shown ? "غيّر الصورة" : "اختار صورة"}` });
    pick.addEventListener("click", () => fileInput.click());
    pifActions.append(pick);

    if (shown) {
      const rm = el("button", { class: "btn btn-light btn-sm danger-ghost", type: "button",
        html: '<i class="fas fa-trash"></i> شيل الصورة' });
      rm.addEventListener("click", () => {
        pendingFile = null;
        removeImage = true;
        drawImgField();
      });
      pifActions.append(rm);
    }

    if (pendingFile) {
      pifActions.append(el("small", { class: "hint", style: "flex-basis:100%",
        text: "الصورة هترفع مع الحفظ" }));
    }
    if (removeImage && existing?.image) {
      pifActions.append(el("small", { class: "hint", style: "flex-basis:100%",
        text: "الصورة هتتشال مع الحفظ" }));
    }
  }

  fileInput.addEventListener("change", () => {
    const f = fileInput.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) return toast("لازم تكون صورة", "error");
    if (f.size > 10 * 1024 * 1024) return toast("الصورة أكبر من 10 ميجا", "error");
    pendingFile = f;
    removeImage = false;
    drawImgField();
  });

  imgBox.append(el("label", { class: "field", text: "صورة الصنف" }), preview, pifActions, fileInput);
  drawImgField();

  const body = el("div", {}, [
    el("div", { class: "form-row" }, [name.wrap, barcode.wrap]),
    el("div", { class: "form-row" }, [cat.wrap, sub.wrap]),
    el("div", { class: "form-row" }, [pb.wrap, pa.wrap]),
    imgBox,
  ]);

  modal({
    title: existing ? "تعديل صنف" : "إضافة صنف", body, width: 600,
    actions: [
      { label: "إلغاء", class: "btn-light", onClick: ({ close }) => close() },
      {
        label: "حفظ", class: "btn-primary",
        onClick: async ({ close, button }) => {
          const payload = {
            name: name.input.value.trim(),
            barcode: barcode.input.value.trim(),
            category: cat.input.value.trim(),
            subCategory: sub.input.value.trim(),
            priceBefore: Number(pb.input.value) || 0,
            priceAfter: Number(pa.input.value) || 0,
            updatedAt: serverTimestamp(),
          };
          if (!payload.name) return toast("اكتب اسم الصنف", "error");
          button.disabled = true;
          const old = button.innerHTML;
          try {
            // الصنف الموجود بيفضل بمعرّفه — تغيير الباركود مابينقلوش لمستند تاني
            const id = existing?.id || productId(payload);

            if (pendingFile) {
              button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> بيرفع الصورة...';
              payload.image = await uploadProductImage(pendingFile, id);
            } else if (removeImage) {
              payload.image = "";
            }

            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> بيحفظ...';
            await setDoc(doc(db, ...tenantPath("products"), id),
              { ...payload, tokens: tokenize(payload) }, { merge: true });
            if (payload.category) await saveKnownCategories([payload]);
            toast("تم الحفظ", "success");
            close();
            totalCount = null;
            goToPage(pageIndex);
          } catch (e) {
            button.disabled = false;
            button.innerHTML = old;
            toast("فشل الحفظ: " + e.message, "error");
          }
        },
      },
    ],
  });
}

function attachSuggestions(input, getOptions) {
  const id = "dl_" + Math.random().toString(36).slice(2, 8);
  const dl = el("datalist", { id });
  input.setAttribute("list", id);
  input.parentElement?.append(dl);
  const fill = () => {
    dl.innerHTML = "";
    (getOptions() || []).slice(0, 300).forEach((o) => dl.append(el("option", { value: o })));
  };
  fill();
  input.addEventListener("focus", fill);
}

async function removeProduct(p) {
  if (!(await confirmBox(`هتمسح صنف "${p.name}"؟`, { title: "حذف صنف" }))) return;
  try {
    await deleteDoc(doc(db, ...tenantPath("products"), p.id));
    selected.delete(p.id);
    toast("تم الحذف", "success");
    totalCount = null;
    goToPage(pageIndex);
  } catch (e) { toast("فشل الحذف: " + e.message, "error"); }
}

/**
 * حذف كل الأصناف — بيتنفذ على السيرفر.
 * التأكيد بالكتابة مقصود: زرار عادي ممكن يتضغط بالغلط، والعملية دي
 * مالهاش تراجع خالص.
 */
async function wipeAllDialog() {
  let count = totalCount;
  if (count == null || count < 0) {
    try {
      const c = await getCountFromServer(collection(db, ...tenantPath("products")));
      count = c.data().count;
    } catch { count = null; }
  }

  if (count === 0) return toast("مفيش أصناف أصلاً", "warn");

  const WORD = "احذف الكل";
  const typed = el("input", { class: "form-control", placeholder: WORD, autocomplete: "off" });

  const body = el("div", {}, [
    el("div", { class: "ai-insight danger", html:
      `<strong>تحذير — العملية دي مالهاش رجوع</strong>
       هيتمسح <b>${count != null ? count : "كل"}</b> صنف من قاعدة البيانات نهائياً.
       مفيش نسخة احتياطية ومفيش تراجع.` }),
    el("p", { class: "text-muted", style: "margin:14px 0 8px;line-height:1.9",
      text: "لو عايز تحتفظ بنسخة، اقفل دلوقتي واضغط «تصدير» الأول." }),
    el("label", { class: "field", html: `اكتب <b>${WORD}</b> عشان تأكد:` }),
    typed,
  ]);

  const m = modal({
    title: "حذف كل الأصناف", body, width: 520,
    actions: [
      { label: "إلغاء", class: "btn-light", onClick: ({ close }) => close() },
      {
        label: "احذف نهائياً", class: "btn-danger",
        onClick: async ({ close, button }) => {
          if (typed.value.trim() !== WORD)
            return toast(`اكتب "${WORD}" بالظبط`, "error");

          button.disabled = true;
          button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحذف...';
          try {
            const { fns, httpsCallable } = await import("../firebase.js");
            const res = await httpsCallable(fns, "deleteAllProducts")({
              companyId: session.companyId, confirm: WORD,
            });
            toast(`تم حذف ${res.data.deleted} صنف`, "success");
            close();
            selected.clear();
            knownCats = { categories: [], subByCat: {} };
            totalCount = null;
            cursors = [];
            goToPage(0);
          } catch (e) {
            button.disabled = false;
            button.textContent = "احذف نهائياً";
            toast("فشل الحذف: " + (e.message || ""), "error");
          }
        },
      },
    ],
  });

  setTimeout(() => typed.focus(), 100);
  return m;
}

// ============================================================
//  معالج الاستيراد — 3 خطوات
//  1) الملف والشيت   2) صف العناوين   3) ربط الأعمدة
//  النظام مابيختارش لوحده: بيعرض أعمدة ملفك وإنت اللي بتوصّلها.
// ============================================================
function importWizard() {
  const body = el("div");
  const steps = el("div", { class: "wiz-steps" });
  const stage = el("div", { style: "margin-top:18px" });
  body.append(steps, stage);

  const state = { wb: null, sheet: null, grid: [], headerRow: 0, map: {}, rows: [] };
  let current = 0;

  const m = modal({ title: "استيراد الأصناف", body, width: 720,
    actions: [{ label: "إغلاق", class: "btn-light", onClick: ({ close }) => close() }] });

  const TITLES = ["اختر الملف", "صف العناوين", "ربط الأعمدة"];
  function drawSteps() {
    steps.innerHTML = "";
    TITLES.forEach((t, i) => {
      steps.append(el("div", {
        class: `wiz-step${i === current ? " active" : ""}${i < current ? " done" : ""}`,
        html: `<span class="wiz-num">${i < current ? '<i class="fas fa-check"></i>' : i + 1}</span>${esc(t)}`,
      }));
    });
  }
  function go(i) { current = i; drawSteps(); [step1, step2, step3][i](); }

  // ---------- 1) الملف ----------
  function step1() {
    stage.innerHTML = "";
    stage.append(el("p", { class: "text-muted", style: "margin-bottom:14px",
      text: "ارفع ملف Excel (.xlsx) أو CSV. مش هنفترض حاجة — إنت اللي هتقول أنهي عمود يروح فين." }));

    const drop = el("div", { class: "file-drop" }, [
      el("i", { class: "fas fa-cloud-arrow-up" }),
      el("strong", { text: "اضغط هنا لاختيار الملف" }),
      el("p", { class: "hint", text: ".xlsx / .xls / .csv" }),
    ]);
    const input = el("input", { type: "file", accept: ".xlsx,.xls,.csv", style: "display:none" });
    stage.append(drop, input);

    drop.addEventListener("click", () => input.click());
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault(); drop.classList.remove("over");
      if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
    });
    input.addEventListener("change", () => { if (input.files[0]) readFile(input.files[0]); });
  }

  async function readFile(file) {
    stage.innerHTML = "";
    stage.append(spinner("جاري قراءة الملف..."));
    try {
      if (typeof XLSX === "undefined") throw new Error("مكتبة قراءة الإكسيل لسه بتحمّل، جرب بعد ثانيتين.");
      // فرصة للمتصفح يرسم رسالة الانتظار قبل ما القراءة تشغّل المعالج
      await new Promise((r) => setTimeout(r, 30));
      state.wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      if (!state.wb.SheetNames.length) throw new Error("الملف مفيهوش شيتات.");

      if (state.wb.SheetNames.length > 1) return pickSheet();
      state.sheet = state.wb.SheetNames[0];
      loadGrid();
    } catch (e) {
      stage.innerHTML = "";
      stage.append(el("div", { class: "ai-insight danger", html: `<strong>مشكلة في الملف</strong>${esc(e.message)}` }),
        mkBtn("جرّب ملف تاني", "btn-light", "fa-rotate-left", () => go(0)));
    }
  }

  function pickSheet() {
    stage.innerHTML = "";
    stage.append(el("p", { class: "text-muted", style: "margin-bottom:12px",
      text: "الملف فيه أكتر من شيت — اختار اللي فيه الأصناف:" }));
    const list = el("div", { class: "pick-list" });
    state.wb.SheetNames.forEach((n) => {
      const ref = state.wb.Sheets[n]?.["!ref"];
      const approx = ref ? (XLSX.utils.decode_range(ref).e.r + 1) : 0;
      const b = el("button", { class: "pick-item",
        html: `<strong>${esc(n)}</strong><small class="text-muted">${approx} صف تقريباً</small>` });
      b.addEventListener("click", () => { state.sheet = n; loadGrid(); });
      list.append(b);
    });
    stage.append(list);
  }

  async function loadGrid() {
    stage.innerHTML = "";
    stage.append(spinner("جاري تجهيز الصفوف..."));
    await new Promise((r) => setTimeout(r, 30));

    // بنقرا الشيت كصفوف خام (من غير عناوين) عشان المستخدم يشوفه زي ما هو
    state.grid = XLSX.utils.sheet_to_json(state.wb.Sheets[state.sheet], {
      header: 1, blankrows: false, defval: "",
    });
    if (!state.grid.length) {
      stage.innerHTML = "";
      stage.append(el("div", { class: "ai-insight danger", html: "<strong>الشيت فاضي</strong>اختار شيت تاني." }),
        mkBtn("رجوع", "btn-light", "fa-arrow-right", () => go(0)));
      return;
    }
    go(1);
  }

  // ---------- 2) صف العناوين ----------
  function step2() {
    stage.innerHTML = "";
    stage.append(el("p", { class: "text-muted", style: "margin-bottom:12px",
      text: "دول أول صفوف الملف. اضغط على الصف اللي فيه أسماء الأعمدة — منه هناخد العناوين." }));

    const wrap = el("div", { class: "table-wrap" });
    const table = el("table", { class: "data grid-pick" });
    const tb = el("tbody");
    const maxCols = Math.max(...state.grid.slice(0, 8).map((r) => r.length));

    state.grid.slice(0, 8).forEach((row, i) => {
      const tr = el("tr", { class: i === state.headerRow ? "picked" : "" });
      tr.append(el("td", { class: "row-num", text: `صف ${i + 1}` }));
      for (let c = 0; c < maxCols; c++) tr.append(el("td", { text: String(row[c] ?? "").slice(0, 22) }));
      tr.addEventListener("click", () => {
        state.headerRow = i;
        [...tb.children].forEach((x) => x.classList.remove("picked"));
        tr.classList.add("picked");
        hint.textContent = `هياخد العناوين من صف ${i + 1}، والبيانات من صف ${i + 2} وطالع.`;
      });
      tb.append(tr);
    });
    table.append(tb);
    wrap.append(table);
    stage.append(wrap);

    const hint = el("p", { class: "hint", style: "margin-top:10px",
      text: `هياخد العناوين من صف ${state.headerRow + 1}، والبيانات من صف ${state.headerRow + 2} وطالع.` });
    stage.append(hint);

    stage.append(el("div", { class: "wiz-nav" }, [
      mkBtn("رجوع", "btn-light", "fa-arrow-right", () => go(0)),
      mkBtn("التالي", "btn-primary", "fa-arrow-left", () => go(2)),
    ]));
  }

  // ---------- 3) ربط الأعمدة ----------
  function step3() {
    stage.innerHTML = "";
    const headers = (state.grid[state.headerRow] || []).map((h, i) => ({
      idx: i, label: String(h ?? "").trim() || `عمود ${i + 1}`,
    }));

    stage.append(el("p", { class: "text-muted", style: "margin-bottom:14px",
      text: "دي أعمدة النظام. اختار لكل واحد أنهي عمود من ملفك يتسحب منه — سيب أي حقل مش محتاجه فاضي." }));

    const selects = {};
    const grid = el("div", { class: "map-grid" });
    FIELDS.forEach((f) => {
      const sel = el("select", { class: "form-control" });
      sel.append(el("option", { value: "", text: "— مش موجود —" }));
      headers.forEach((h) => sel.append(el("option", { value: String(h.idx), text: h.label })));
      sel.value = state.map[f.key] ?? "";
      sel.addEventListener("change", () => { state.map[f.key] = sel.value; preview(); });
      selects[f.key] = sel;
      grid.append(el("div", { class: "map-row" }, [
        el("label", { html: `${esc(f.label)}${f.required ? ' <span style="color:var(--danger)">*</span>' : ""}` }),
        sel,
      ]));
    });
    stage.append(grid);

    const auto = mkBtn("خمّن الأعمدة لي", "btn-ghost btn-sm", "fa-wand-magic-sparkles", () => {
      FIELDS.forEach((f) => {
        const g = guessColumn(f.key, headers);
        if (g != null) { selects[f.key].value = String(g); state.map[f.key] = String(g); }
      });
      preview();
      toast("اتملت بالتخمين — راجعها وعدّل اللي مش مظبوط", "warn");
    });
    stage.append(el("div", { style: "margin:10px 0" }, [auto]));

    const prevBox = el("div");
    stage.append(prevBox);

    const nav = el("div", { class: "wiz-nav" });
    const back = mkBtn("رجوع", "btn-light", "fa-arrow-right", () => go(1));
    const save = el("button", { class: "btn btn-primary", html: '<i class="fas fa-database"></i> استيراد' });
    nav.append(back, save);
    stage.append(nav);

    function preview() {
      prevBox.innerHTML = "";
      const missing = FIELDS.filter((f) => f.required && !state.map[f.key]);
      if (missing.length) {
        prevBox.append(el("div", { class: "ai-insight warn",
          html: `<strong>ناقص</strong>لازم تختار عمود لـ: ${missing.map((f) => esc(f.label)).join("، ")}` }));
        save.disabled = true;
        return;
      }
      state.rows = buildRows();
      save.disabled = state.rows.length === 0;
      prevBox.append(el("div", { class: "ai-insight",
        html: `<strong>معاينة</strong>هيتستورد <b>${state.rows.length}</b> صنف صالح من ${state.grid.length - state.headerRow - 1} صف.` }));

      // الباركود هو مفتاح الصنف، فأي باركود مكرر معناه إن الصفوف هتندمج في صنف واحد
      const seen = new Set();
      const dups = new Map();
      state.rows.forEach((r) => {
        const bc = String(r.barcode || "").trim();
        if (!bc) return;
        if (seen.has(bc)) dups.set(bc, (dups.get(bc) || 1) + 1);
        else seen.add(bc);
      });
      if (dups.size) {
        const sample = [...dups.entries()].slice(0, 3).map(([bc, n]) => `${esc(bc)} (${n} مرات)`).join("، ");
        prevBox.append(el("div", { class: "ai-insight warn", html:
          `<strong>في باركود مكرر</strong>
           ${dups.size} باركود متكرر في الملف: ${sample}${dups.size > 3 ? " وغيرهم" : ""}.
           الباركود هو مفتاح الصنف، يعني الصفوف دي هتندمج في صنف واحد
           وآخر صف هو اللي هيتسجّل. راجع الملف لو ده مش المطلوب.` }));
      }

      const noBarcode = state.rows.filter((r) => !String(r.barcode || "").trim()).length;
      if (noBarcode) {
        prevBox.append(el("div", { class: "ai-insight", html:
          `<strong>أصناف من غير باركود</strong>
           ${noBarcode} صنف مالهمش باركود — هيتسجّلوا باسمهم.
           لو غيّرت اسم أي واحد فيهم وأعدت الاستيراد، هيتعمل صنف جديد بدل ما يتحدّث.` }));
      }

      const cols = FIELDS.filter((f) => state.map[f.key]);
      const t = el("div", { class: "table-wrap", style: "margin-top:10px" });
      t.innerHTML = `<table class="data"><thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead>
        <tbody>${state.rows.slice(0, 5).map((r) =>
          `<tr>${cols.map((c) => `<td>${esc(String(r[c.key] ?? ""))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      prevBox.append(t);
    }

    function buildRows() {
      const out = [];
      for (let i = state.headerRow + 1; i < state.grid.length; i++) {
        const row = state.grid[i];
        const rec = {};
        FIELDS.forEach((f) => {
          const idx = state.map[f.key];
          if (idx === "" || idx == null) return;
          const raw = row[Number(idx)];
          rec[f.key] = f.num ? toNum(raw) : String(raw ?? "").trim();
        });
        if (!rec.name) continue;
        if (!rec.priceBefore) rec.priceBefore = rec.priceAfter || 0;
        if (!rec.priceAfter) rec.priceAfter = rec.priceBefore || 0;
        out.push(rec);
      }
      return out;
    }

    save.addEventListener("click", async () => {
      save.disabled = true;
      back.disabled = true;
      const bar = el("div", { class: "import-progress" }, [
        el("div", { class: "ip-fill" }),
      ]);
      const status = el("p", { class: "hint", style: "margin-top:6px" });
      nav.before(bar, status);

      const started = Date.now();
      try {
        await saveBatch(state.rows, (done) => {
          const pct = Math.round((done / state.rows.length) * 100);
          bar.firstChild.style.width = pct + "%";
          const rate = done / Math.max(1, (Date.now() - started) / 1000);
          const left = Math.round((state.rows.length - done) / Math.max(1, rate));
          status.textContent = `${done} من ${state.rows.length} (${pct}%)`
            + (done < state.rows.length && left > 1 ? ` · فاضل حوالي ${left} ثانية` : "");
          save.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${pct}%`;
        });
        await saveKnownCategories(state.rows);
        toast(`تم استيراد ${state.rows.length} صنف`, "success");
        m.close();
        totalCount = null;
        cursors = [];
        goToPage(0);
      } catch (e) {
        save.disabled = false;
        back.disabled = false;
        save.innerHTML = "إعادة المحاولة";
        toast("فشل الاستيراد: " + e.message, "error");
      }
    });

    preview();
  }

  drawSteps();
  step1();
}

/** تخمين اختياري — بيشتغل بس لما المستخدم يطلبه بنفسه */
function guessColumn(key, headers) {
  const HINTS = {
    name:        ["اسم الصنف", "الصنف", "المنتج", "اسم المنتج", "name", "product", "item"],
    barcode:     ["باركود", "الباركود", "barcode", "sku", "كود", "code"],
    category:    ["القسم الرئيسي", "قسم رئيسي", "المجموعة", "category", "main"],
    subCategory: ["القسم الفرعي", "قسم فرعي", "sub", "subcategory"],
    priceBefore: ["قبل الخصم", "السعر الأصلي", "price before", "old price"],
    priceAfter:  ["بعد الخصم", "سعر البيع", "السعر", "price", "sale"],
  };
  const hints = HINTS[key] || [];
  for (const h of headers) {
    if (hints.some((x) => h.label.trim().toLowerCase() === x.toLowerCase())) return h.idx;
  }
  for (const h of headers) {
    if (hints.some((x) => h.label.trim().toLowerCase().includes(x.toLowerCase()))) return h.idx;
  }
  return null;
}

function toNum(v) {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? "").replace(/[^\d.]/g, ""));
  return isNaN(n) ? 0 : n;
}

/**
 * الحفظ على دفعات **متوازية**.
 * قبل كده كانت الدفعات بتتبعت واحدة ورا التانية، فـ 50 ألف صنف كانوا
 * بياخدوا دقايق — أغلبها انتظار للرد. 6 دفعات مع بعض بتقصّر الوقت بشكل كبير.
 */
async function saveBatch(items, onProgress) {
  const CHUNK = 400;
  const PARALLEL = 6;

  const chunks = [];
  for (let i = 0; i < items.length; i += CHUNK) chunks.push(items.slice(i, i + CHUNK));

  let done = 0;
  let next = 0;

  async function worker() {
    while (next < chunks.length) {
      const chunk = chunks[next++];
      const batch = writeBatch(db);
      chunk.forEach((p) => {
        batch.set(doc(db, ...tenantPath("products"), productId(p)), {
          ...p, tokens: tokenize(p), updatedAt: serverTimestamp(),
        }, { merge: true });
      });
      await batch.commit();
      done += chunk.length;
      onProgress?.(done);
    }
  }

  await Promise.all(Array.from({ length: Math.min(PARALLEL, chunks.length) }, worker));
}

/**
 * معرّف الصنف — الباركود هو المفتاح الأساسي.
 * ليه: الباركود بيميّز الصنف فعلاً، فلو غيّرت اسم الصنف وأعدت الاستيراد
 * بيتحدّث نفس الصنف بدل ما يتعمل واحد جديد. الاسم بيبقى مفتاح احتياطي
 * للأصناف اللي مالهاش باركود بس.
 */
function productId(p) {
  const bc = String(p?.barcode || "").trim();
  if (bc) return "bc_" + bc.toLowerCase().replace(/[/\\.#$\[\]\s]/g, "").slice(0, 100);

  const clean = String(p?.name || "").trim().toLowerCase()
    .replace(/\s+/g, "-").replace(/[/\\.#$\[\]]/g, "");
  return clean.slice(0, 120) || "item-" + Math.random().toString(36).slice(2, 8);
}

// ---------- التصدير ----------
async function exportCsv() {
  const t = toast("جاري تجهيز الملف...", "warn");
  try {
    // التصدير بيجيب كل اللي مطابق للفلتر الحالي، مش الصفحة المعروضة بس
    const all = [];
    let after = null;
    for (let guard = 0; guard < 200; guard++) {
      const parts = [collection(db, ...tenantPath("products"))];
      if (filters.category) parts.push(where("category", "==", filters.category));
      if (filters.subCategory) parts.push(where("subCategory", "==", filters.subCategory));
      parts.push(orderBy("name"));
      if (after) parts.push(startAfter(after));
      parts.push(limit(1000));
      const snap = await getDocs(query(...parts));
      if (snap.empty) break;
      snap.docs.forEach((d) => all.push(d.data()));
      after = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < 1000) break;
    }
    if (!all.length) return toast("مفيش أصناف للتصدير", "warn");

    const head = ["اسم الصنف", "الباركود", "القسم الرئيسي", "القسم الفرعي", "السعر قبل الخصم", "السعر بعد الخصم"];
    const lines = all.map((p) => [p.name, p.barcode, p.category, p.subCategory, p.priceBefore, p.priceAfter]
      .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    const csv = "﻿" + [head.join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = el("a", { href: url, download: `nexo-products-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    URL.revokeObjectURL(url);
    toast(`تم تحميل ${all.length} صنف`, "success");
  } catch (e) {
    toast("فشل التصدير: " + e.message, "error");
  }
}

function mkBtn(label, cls, icon, onClick) {
  const b = el("button", { class: `btn ${cls}` }, [icon ? el("i", { class: `fas ${icon}` }) : null, label || null]);
  b.addEventListener("click", onClick);
  return b;
}

export function destroy() {
  rows = []; cursors = []; pageIndex = 0; totalCount = null; hasNext = false;
  selected.clear();
  filters.text = ""; filters.category = ""; filters.subCategory = "";
  tbodyRef = countRef = pagerRef = bulkRef = bodyRef = selAllRef = subComboRef = null;
}
