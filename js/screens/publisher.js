// ============================================================
//  الناشر الذكي — بوست واحد + ثوابت + روابط ذكية + جدولة
// ============================================================
import {
  db, collection, doc, addDoc, getDocs, deleteDoc, updateDoc,
  query, orderBy, limit, serverTimestamp,
} from "../firebase.js";
import { session, tenantPath, hasFeature } from "../auth.js";
import { PLATFORMS } from "../config.js";
import { el, card, esc, toast, field, confirmBox, fmtDateTime, emptyState, spinner } from "../ui.js";
import { buildLinks } from "./settings.js";

let state = {
  caption: "",
  platforms: { facebook: false, instagram: false, telegram: false, whatsapp: false },
  attach: { address: false, hours: false, phones: false, links: false, price: false },
  price: "",
  productName: "",
  scheduleAt: "",
  previewMobile: false,
};

export async function render(root) {
  const c = session.company;

  root.append(el("div", { class: "page-head" }, [
    el("div", {}, [
      el("h2", { text: "الناشر الذكي" }),
      el("div", { class: "sub", text: "اكتب البوست مرة واحدة، والنظام يظبطه لكل منصة" }),
    ]),
  ]));

  const grid = el("div", { class: "grid", style: "grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);align-items:start" });
  if (window.innerWidth <= 900) grid.style.gridTemplateColumns = "1fr";
  root.append(grid);

  const left = el("div");
  const right = el("div");
  grid.append(left, right);

  // ---------- المحرر ----------
  const editor = card("محتوى البوست");
  const caption = el("textarea", { class: "form-control", rows: 6, placeholder: "اكتب الكابشن بتاعك هنا..." });
  caption.addEventListener("input", () => { state.caption = caption.value; refresh(); });
  editor.append(caption);

  const prodRow = el("div", { class: "form-row", style: "margin-top:14px" });
  const productName = field({ label: "المنتج المرتبط (اختياري)", name: "product", placeholder: "طرحة كريب مضلع" });
  const price = field({ label: "السعر", name: "price", type: "number", placeholder: "150" });
  productName.input.addEventListener("input", () => { state.productName = productName.input.value; refresh(); });
  price.input.addEventListener("input", () => { state.price = price.input.value; refresh(); });
  prodRow.append(productName.wrap, price.wrap);
  editor.append(prodRow);
  editor.append(el("p", { class: "hint", text: "السعر ده بيتربط بالبوست، فلما حد يعلق «بكام؟» البوت يرد بالسعر الصح للبوست ده تحديداً." }));
  left.append(editor);

  // ---------- المنصات ----------
  const platBox = card("منصات النشر");
  const platGrid = el("div", { class: "grid grid-4" });
  Object.entries(PLATFORMS).forEach(([key, p]) => {
    const allowed = hasFeature(p.feature);
    const input = el("input", { type: "checkbox" });
    input.disabled = !allowed;
    const row = el("label", { class: "check-row" }, [
      input,
      el("i", { class: p.icon, style: `color:${allowed ? p.color : "#c5cbdd"}` }),
      el("span", { text: p.label }),
      !allowed ? el("i", { class: "fas fa-lock", style: "margin-inline-start:auto;font-size:11px;color:#c5cbdd" }) : null,
    ]);
    input.addEventListener("change", () => {
      state.platforms[key] = input.checked;
      row.classList.toggle("checked", input.checked);
      refresh();
    });
    if (!allowed) row.title = "الميزة دي مقفولة لباقة الشركة";
    platGrid.append(row);
  });
  platBox.append(platGrid);
  left.append(platBox);

  // ---------- الثوابت ----------
  const attachBox = card("أضف للبوست");
  const k = c.constants || {};
  const attachDefs = [
    { key: "address", label: "العنوان", available: !!k.address },
    { key: "hours", label: "مواعيد العمل", available: !!k.workingHours },
    { key: "phones", label: "أرقام التواصل", available: !!k.phones },
    { key: "links", label: "روابط التواصل الذكية", available: Object.keys(buildLinks(k)).length > 0 },
    { key: "price", label: "السعر", available: true },
  ];
  const attachGrid = el("div", { class: "grid grid-3" });
  attachDefs.forEach((a) => {
    const input = el("input", { type: "checkbox" });
    input.disabled = !a.available;
    const row = el("label", { class: "check-row" }, [input, el("span", { text: a.label })]);
    if (!a.available) row.title = "اكتب البيانات دي الأول في شاشة الثوابت";
    input.addEventListener("change", () => {
      state.attach[a.key] = input.checked;
      row.classList.toggle("checked", input.checked);
      refresh();
    });
    attachGrid.append(row);
  });
  attachBox.append(attachGrid);
  attachBox.append(el("p", { class: "hint", text: "الروابط الذكية: النظام بيشيل لينك المنصة اللي بينشر عليها (مثلاً مش بيحط لينك تليجرام في بوست نازل على تليجرام)." }));
  left.append(attachBox);

  // ---------- الجدولة ----------
  const schedBox = card("موعد النشر");
  const when = field({ label: "جدولة (سيبها فاضية = نشر فوري)", name: "scheduleAt", type: "datetime-local" });
  when.input.addEventListener("change", () => { state.scheduleAt = when.input.value; });
  schedBox.append(when.wrap);

  const actions = el("div", { style: "display:flex;gap:10px;flex-wrap:wrap" });
  const saveDraft = mkBtn("حفظ كمسودة", "btn-ghost", "fa-floppy-disk", () => submit("draft"));
  const publish = mkBtn("جدولة / نشر", "btn-primary", "fa-paper-plane", () => submit("queued"));
  actions.append(publish, saveDraft);
  schedBox.append(actions);
  left.append(schedBox);

  // ---------- المعاينة ----------
  const previewBox = card("");
  const previewHead = el("div", { style: "display:flex;align-items:center;justify-content:space-between;margin-bottom:14px" }, [
    el("h3", { class: "card-title", style: "margin:0", text: "معاينة" }),
    el("div", { class: "period-bar" }, [
      mkToggleBtn("fa-desktop", true), mkToggleBtn("fa-mobile-screen", false),
    ]),
  ]);
  const phone = el("div", { class: "preview-phone" });
  previewBox.append(previewHead, phone);
  right.append(previewBox);

  previewHead.querySelectorAll("button").forEach((b, i) => {
    b.addEventListener("click", () => {
      previewHead.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      state.previewMobile = i === 1;
      phone.classList.toggle("mobile", state.previewMobile);
    });
  });

  // ---------- البوستات السابقة ----------
  const listBox = card("البوستات والمجدولة");
  right.append(listBox);
  loadPosts(listBox);

  refresh();

  function refresh() {
    phone.innerHTML = "";
    const active = Object.entries(state.platforms).filter(([, v]) => v).map(([k2]) => k2);
    const target = active[0] || "facebook";

    phone.append(el("div", { class: "preview-head" }, [
      el("div", { class: "preview-avatar", text: (c.name || "N").charAt(0) }),
      el("div", {}, [
        el("strong", { text: c.name, style: "font-size:13.5px;display:block" }),
        el("small", { class: "text-muted", style: "font-size:11px",
          text: active.length ? `معاينة على ${PLATFORMS[target].label}` : "اختر منصة" }),
      ]),
    ]));
    phone.append(el("div", { class: "preview-body", text: composeText(target) || "اكتب الكابشن عشان تشوف المعاينة..." }));

    if (active.length > 1) {
      phone.append(el("div", { class: "hint", style: "padding:0 14px 14px",
        text: `هينزل على ${active.length} منصات، وكل واحدة هتاخد نسخة مظبوطة عليها.` }));
    }
  }
}

/** تركيب نص البوست النهائي حسب المنصة */
export function composeText(platform) {
  const c = session.company;
  const k = c?.constants || {};
  let out = state.caption.trim();

  if (state.attach.price && state.price) {
    out += `\n\n💰 السعر: ${state.price} جنيه`;
    if (state.productName) out = out.replace("💰 السعر:", `💰 ${state.productName} — السعر:`);
  }
  if (state.attach.address && k.address) out += `\n\n📍 العنوان: ${k.address}`;
  if (state.attach.hours && k.workingHours) out += `\n🕐 المواعيد: ${k.workingHours}`;
  if (state.attach.phones && k.phones) out += `\n📞 للتواصل: ${k.phones}`;

  if (state.attach.links) {
    const links = buildLinks(k);
    delete links[platform];               // ← الاستبعاد الذكي
    const parts = Object.entries(links).map(([p, u]) => `${PLATFORMS[p]?.label || p}: ${u}`);
    if (parts.length) out += `\n\n🔗 تواصل معانا:\n${parts.join("\n")}`;
  }
  return out;
}

async function submit(status) {
  const active = Object.entries(state.platforms).filter(([, v]) => v).map(([k]) => k);
  if (!state.caption.trim()) return toast("اكتب محتوى البوست الأول", "error");
  if (status === "queued" && !active.length) return toast("اختار منصة واحدة على الأقل", "error");

  const versions = {};
  active.forEach((p) => { versions[p] = composeText(p); });

  try {
    await addDoc(collection(db, ...tenantPath("posts")), {
      caption: state.caption.trim(),
      productName: state.productName.trim(),
      price: Number(state.price) || 0,
      platforms: active,
      attach: { ...state.attach },
      versions,
      status,                                   // draft | queued | published | failed
      scheduledAt: state.scheduleAt ? new Date(state.scheduleAt) : null,
      createdAt: serverTimestamp(),
      createdBy: session.user.uid,
      createdByName: session.profile.name || "",
    });
    toast(status === "draft" ? "تم الحفظ كمسودة" : "تم إضافة البوست لقائمة النشر", "success");
    import("../router.js").then((r) => r.reloadCurrent());
  } catch (e) {
    toast("فشل الحفظ: " + e.message, "error");
  }
}

async function loadPosts(box) {
  box.append(spinner());
  try {
    const snap = await getDocs(query(collection(db, ...tenantPath("posts")), orderBy("createdAt", "desc"), limit(12)));
    box.innerHTML = "";
    box.append(el("h3", { class: "card-title", text: "البوستات والمجدولة" }));
    if (snap.empty) { box.append(el("p", { class: "text-muted", text: "مفيش بوستات لسه." })); return; }

    snap.forEach((d) => {
      const p = { id: d.id, ...d.data() };
      const badges = { draft: ["badge-gray", "مسودة"], queued: ["badge-yellow", "في الانتظار"],
                       published: ["badge-green", "تم النشر"], failed: ["badge-red", "فشل"] }[p.status] || ["badge-gray", p.status];
      const item = el("div", { class: "tenant-item", style: "cursor:default;align-items:flex-start" }, [
        el("div", { style: "flex:1;min-width:0" }, [
          el("strong", { text: (p.caption || "").slice(0, 60) + ((p.caption || "").length > 60 ? "..." : ""), style: "display:block" }),
          el("small", { class: "text-muted", text: `${p.scheduledAt ? fmtDateTime(p.scheduledAt) : "فوري"} · ${(p.platforms || []).map((x) => PLATFORMS[x]?.label).join("، ") || "—"}` }),
        ]),
        el("span", { class: `badge ${badges[0]}`, text: badges[1] }),
      ]);
      const del = el("button", { class: "btn btn-light btn-sm", html: '<i class="fas fa-trash"></i>' });
      del.addEventListener("click", async () => {
        if (!(await confirmBox("هتمسح البوست ده؟", { title: "حذف بوست" }))) return;
        await deleteDoc(doc(db, ...tenantPath("posts"), p.id));
        toast("تم الحذف", "success");
        import("../router.js").then((r) => r.reloadCurrent());
      });
      item.append(del);
      box.append(item);
    });
  } catch (e) {
    box.innerHTML = "";
    box.append(el("p", { class: "text-muted", text: "تعذّر تحميل البوستات: " + e.message }));
  }
}

function mkBtn(label, cls, icon, onClick) {
  const b = el("button", { class: `btn ${cls}` }, [icon ? el("i", { class: `fas ${icon}` }) : null, label || null]);
  b.addEventListener("click", onClick);
  return b;
}
function mkToggleBtn(icon, active) {
  return el("button", { class: active ? "active" : "", html: `<i class="fas ${icon}"></i>` });
}

export function destroy() {
  state = { caption: "", platforms: { facebook: false, instagram: false, telegram: false, whatsapp: false },
    attach: { address: false, hours: false, phones: false, links: false, price: false },
    price: "", productName: "", scheduleAt: "", previewMobile: false };
}
