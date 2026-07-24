// ============================================================
//  الناشر الذكي — بوست واحد + ثوابت + روابط ذكية + جدولة
// ============================================================
import {
  db, collection, doc, addDoc, getDocs, deleteDoc, updateDoc,
  query, orderBy, limit, serverTimestamp,
  storage, storageRef, uploadBytesResumable, getDownloadURL, deleteObject,
  fns, httpsCallable,
} from "../firebase.js";
import { session, tenantPath, hasFeature } from "../auth.js";
import { PLATFORMS, LINK_LABELS } from "../config.js";
import { el, card, esc, toast, field, confirmBox, modal, fmtDateTime, emptyState, spinner } from "../ui.js";
import { buildLinks } from "./settings.js";
import { attachDraft } from "../drafts.js";

let draft = null;

const MAX_FILE_MB = 50;

let state = {
  caption: "",
  platforms: { facebook: false, instagram: false, telegram: false, whatsapp: false },
  attach: { address: false, hours: false, phones: false, links: false, price: false },
  price: "",
  productName: "",
  scheduleAt: "",
  previewMobile: false,
  media: [],        // [{ url, path, type, name }]
  lastCaption: null, // للتراجع عن مساعدة الذكاء الاصطناعي
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
  caption.addEventListener("input", () => { state.caption = caption.value; state.lastCaption = null; renderUndo(); refresh(); });
  editor.append(caption);

  // ---------- مساعد الكتابة بالذكاء الاصطناعي ----------
  const aiBar = el("div", { style: "margin-top:12px" });
  const aiTitle = el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:9px" }, [
    el("i", { class: "fas fa-wand-magic-sparkles", style: "color:var(--primary);font-size:13px" }),
    el("strong", { style: "font-size:13px", text: "مساعد الكتابة" }),
  ]);
  const aiBtns = el("div", { class: "quick-actions" });
  const undoWrap = el("span");

  const TASKS = [
    { id: "fix",       label: "تصحيح لغوي",  icon: "fa-spell-check" },
    { id: "improve",   label: "تحسين الصياغة", icon: "fa-pen-nib" },
    { id: "emoji",     label: "إضافة إيموجي", icon: "fa-face-smile" },
    { id: "marketing", label: "أسلوب تسويقي", icon: "fa-bullhorn" },
    { id: "shorten",   label: "اختصار",       icon: "fa-compress" },
    { id: "expand",    label: "توسيع",        icon: "fa-expand" },
    { id: "hashtags",  label: "هاشتاجات",     icon: "fa-hashtag" },
  ];

  const aiEnabled = hasFeature("canUseAI");
  TASKS.forEach((t) => {
    const b = el("button", { class: "chip", html: `<i class="fas ${t.icon}"></i> ${t.label}` });
    b.disabled = !aiEnabled;
    b.addEventListener("click", () => runAssist(t, b));
    aiBtns.append(b);
  });
  aiBar.append(aiTitle, aiBtns, undoWrap);
  if (!aiEnabled) aiBar.append(el("small", { class: "hint", text: "ميزة الذكاء الاصطناعي مقفولة لباقة الشركة." }));
  editor.append(aiBar);

  function renderUndo() {
    undoWrap.innerHTML = "";
    if (!state.lastCaption) return;
    const u = el("button", { class: "chip", style: "background:#fff3d6;color:#8a6100",
      html: '<i class="fas fa-rotate-left"></i> تراجع عن آخر تعديل' });
    u.addEventListener("click", () => {
      caption.value = state.lastCaption;
      state.caption = state.lastCaption;
      state.lastCaption = null;
      renderUndo();
      refresh();
      toast("تم التراجع", "info");
    });
    undoWrap.append(u);
  }

  async function runAssist(task, btn) {
    const text = caption.value.trim();
    if (!text) return toast("اكتب نص البوست الأول", "warn");

    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري...';
    aiBtns.querySelectorAll("button").forEach((b) => (b.disabled = true));

    try {
      const res = await httpsCallable(fns, "aiAssistPost")({
        text, task: task.id, companyId: session.companyId,
      });
      const out = (res.data?.text || "").trim();
      if (!out) throw new Error("رد فاضي");
      state.lastCaption = text;
      caption.value = out;
      state.caption = out;
      renderUndo();
      refresh();
      toast(`تم: ${task.label}`, "success");
    } catch (e) {
      toast("فشل: " + (e.message || "تعذّر الاتصال"), "error");
    }

    btn.innerHTML = original;
    aiBtns.querySelectorAll("button").forEach((b) => (b.disabled = !aiEnabled));
  }

  const prodRow = el("div", { class: "form-row", style: "margin-top:14px" });
  const productName = field({ label: "المنتج المرتبط (اختياري)", name: "product", placeholder: "باقة Nexo المتقدمة" });
  const price = field({ label: "السعر", name: "price", type: "number", placeholder: "150" });
  productName.input.addEventListener("input", () => { state.productName = productName.input.value; refresh(); });
  price.input.addEventListener("input", () => { state.price = price.input.value; refresh(); });
  prodRow.append(productName.wrap, price.wrap);
  editor.append(prodRow);
  editor.append(el("p", { class: "hint", text: "السعر ده بيتربط بالبوست، فلما حد يعلق «بكام؟» البوت يرد بالسعر الصح للبوست ده تحديداً." }));
  left.append(editor);

  // ---------- الصور والفيديو ----------
  const mediaBox = card("الصور والفيديو");
  const mediaGrid = el("div", { class: "media-grid" });
  const fileInput = el("input", { type: "file", accept: "image/*,video/*", multiple: true, style: "display:none" });
  const drop = el("div", { class: "file-drop" }, [
    el("i", { class: "fas fa-images" }),
    el("strong", { text: "اضغط لاختيار صور أو فيديو" }),
    el("p", { class: "hint", text: `تقدر تختار أكتر من ملف · الحد الأقصى ${MAX_FILE_MB} ميجا للملف` }),
  ]);

  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault(); drop.classList.remove("over");
    handleFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener("change", () => { handleFiles(fileInput.files); fileInput.value = ""; });

  mediaBox.append(mediaGrid, drop, fileInput);
  left.append(mediaBox);

  function drawMedia() {
    mediaGrid.innerHTML = "";
    state.media.forEach((m, i) => {
      const thumb = el("div", { class: "media-item" });
      if (m.uploading) {
        thumb.classList.add("uploading");
        thumb.append(
          el("div", { class: "media-progress" }, [el("div", { class: "media-bar", style: `width:${m.progress || 0}%` })]),
          el("span", { class: "media-pct", text: `${m.progress || 0}%` }),
        );
      } else {
        thumb.append(m.type === "video"
          ? el("video", { src: m.url, muted: "true" })
          : el("img", { src: m.url, alt: m.name }));
        const del = el("button", { class: "media-del", html: '<i class="fas fa-xmark"></i>', title: "حذف" });
        del.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (!(await confirmBox("هتشيل الملف ده من البوست؟", { title: "حذف ملف" }))) return;
          try { await deleteObject(storageRef(storage, m.path)); } catch { /* الملف ممكن يكون اتمسح */ }
          state.media.splice(i, 1);
          drawMedia(); refresh();
        });
        thumb.append(del);
        if (m.type === "video") thumb.append(el("span", { class: "media-badge", html: '<i class="fas fa-play"></i>' }));
      }
      mediaGrid.append(thumb);
    });
    drop.style.display = state.media.length >= 10 ? "none" : "";
  }

  function handleFiles(fileList) {
    const files = [...(fileList || [])];
    if (state.media.length + files.length > 10) return toast("أقصى عدد 10 ملفات للبوست", "warn");

    files.forEach((file) => {
      if (file.size > MAX_FILE_MB * 1024 * 1024)
        return toast(`"${file.name}" أكبر من ${MAX_FILE_MB} ميجا`, "error");
      if (!/^(image|video)\//.test(file.type))
        return toast(`"${file.name}" مش صورة ولا فيديو`, "error");

      const item = {
        uploading: true, progress: 0,
        type: file.type.startsWith("video") ? "video" : "image",
        name: file.name,
      };
      state.media.push(item);
      drawMedia();
      uploadFile(file, item);
    });
  }

  function uploadFile(file, item) {
    const safe = file.name.replace(/[^\w.\-]/g, "_").slice(-60);
    const path = `companies/${session.companyId}/posts/${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${safe}`;
    const task = uploadBytesResumable(storageRef(storage, path), file, { contentType: file.type });

    task.on("state_changed",
      (snap) => {
        item.progress = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        drawMedia();
      },
      (err) => {
        toast(uploadError(err), "error");
        const i = state.media.indexOf(item);
        if (i > -1) state.media.splice(i, 1);
        drawMedia();
      },
      async () => {
        item.url = await getDownloadURL(task.snapshot.ref);
        item.path = path;
        item.uploading = false;
        drawMedia(); refresh();
        toast("تم رفع " + item.name, "success");
      });
  }

  function uploadError(err) {
    const c = err?.code || "";
    if (c.includes("unauthorized")) return "مش مسموح لك برفع ملفات — راجع صلاحياتك.";
    if (c.includes("retry-limit") || c.includes("canceled")) return "الرفع فشل — راجع الإنترنت وحاول تاني.";
    if (c.includes("unknown")) return "خدمة التخزين لسه مش مفعّلة في المشروع.";
    return "فشل الرفع: " + (err?.message || c);
  }

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

  // ---------- الحفظ التلقائي ----------
  const statusMount = el("div", { class: "draft-mount" });
  editor.append(statusMount);

  draft?.destroy();
  draft = attachDraft(`publisher.${session.companyId}`, {
    label: "مسودة بوست",
    mount: statusMount,
    watch: [caption, productName.input, price.input, when.input,
      ...Object.values(platBox.querySelectorAll("input")),
      ...Object.values(attachBox.querySelectorAll("input"))],
    serialize: () => ({
      caption: state.caption,
      productName: state.productName,
      price: state.price,
      scheduleAt: state.scheduleAt,
      platforms: { ...state.platforms },
      attach: { ...state.attach },
      media: state.media.filter((m) => m.url && !m.uploading),
    }),
    restore: (d) => {
      caption.value = d.caption || "";
      state.caption = d.caption || "";
      productName.input.value = d.productName || "";
      state.productName = d.productName || "";
      price.input.value = d.price || "";
      state.price = d.price || "";
      if (d.scheduleAt) { when.input.value = d.scheduleAt; state.scheduleAt = d.scheduleAt; }

      Object.assign(state.platforms, d.platforms || {});
      platBox.querySelectorAll("input").forEach((input, i) => {
        const key = Object.keys(PLATFORMS)[i];
        if (!input.disabled) {
          input.checked = !!state.platforms[key];
          input.closest(".check-row")?.classList.toggle("checked", input.checked);
        }
      });

      Object.assign(state.attach, d.attach || {});
      attachBox.querySelectorAll("input").forEach((input, i) => {
        const key = attachDefs[i]?.key;
        if (key && !input.disabled) {
          input.checked = !!state.attach[key];
          input.closest(".check-row")?.classList.toggle("checked", input.checked);
        }
      });

      state.media = Array.isArray(d.media) ? d.media : [];
      drawMedia();
      refresh();
    },
  });
  draft.offerRestore(editor);

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

    const ready = state.media.filter((m) => !m.uploading && m.url);
    if (ready.length) {
      const grid = el("div", { class: "preview-media" });
      ready.forEach((m) => {
        grid.append(m.type === "video"
          ? el("video", { src: m.url, controls: "true" })
          : el("img", { src: m.url, alt: "" }));
      });
      phone.append(grid);
    }

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
    if (platform === "telegram") delete links.telegramBot;
    const parts = Object.entries(links).map(([p, u]) => `${LINK_LABELS[p] || PLATFORMS[p]?.label || p}: ${u}`);
    if (parts.length) out += `\n\n🔗 تواصل معانا:\n${parts.join("\n")}`;
  }
  return out;
}

async function submit(status) {
  const active = Object.entries(state.platforms).filter(([, v]) => v).map(([k]) => k);
  if (!state.caption.trim()) return toast("اكتب محتوى البوست الأول", "error");
  if (status === "queued" && !active.length) return toast("اختار منصة واحدة على الأقل", "error");
  if (state.media.some((m) => m.uploading)) return toast("استنى لحد ما رفع الملفات يخلص", "warn");

  const versions = {};
  active.forEach((p) => { versions[p] = composeText(p); });

  const media = state.media
    .filter((m) => m.url && m.path)
    .map(({ url, path, type, name }) => ({ url, path, type, name }));

  try {
    await addDoc(collection(db, ...tenantPath("posts")), {
      caption: state.caption.trim(),
      productName: state.productName.trim(),
      price: Number(state.price) || 0,
      platforms: active,
      attach: { ...state.attach },
      versions,
      media,
      status,                                   // draft | queued | published | failed
      scheduledAt: state.scheduleAt ? new Date(state.scheduleAt) : null,
      createdAt: serverTimestamp(),
      createdBy: session.user.uid,
      createdByName: session.profile.name || "",
    });
    draft?.clear();   // اتحفظ في السحابة خلاص، مش محتاجين المسودة المحلية
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
      if (p.status === "published") {
        const rep = el("button", { class: "btn btn-light btn-sm", html: '<i class="fas fa-chart-simple"></i>', title: "تقرير البوست" });
        rep.addEventListener("click", () => postReport(p));
        item.append(rep);
      }

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

/** تقرير مفصّل عن بوست منشور */
function postReport(p) {
  const body = el("div");

  body.append(el("div", { class: "ai-insight", style: "margin-bottom:16px",
    html: `<strong>نص البوست</strong><div style="white-space:pre-wrap;font-size:13px">${esc((p.caption || "").slice(0, 300))}</div>` }));

  // حالة النشر على كل منصة
  const rows = el("div");
  (p.platforms || []).forEach((key) => {
    const plat = PLATFORMS[key];
    const res = p.results?.[key] || "—";
    const ok = res === "sent";
    const skipped = res === "skipped";

    const reach = p.audience?.[key];
    rows.append(el("div", { style: "display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #f2f4f9;flex-wrap:wrap" }, [
      el("div", { style: `width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;background:${plat?.color || "#999"}1a;color:${plat?.color || "#999"};font-size:16px`,
        html: `<i class="${plat?.icon || "fas fa-globe"}"></i>` }),
      el("div", { style: "flex:1;min-width:130px" }, [
        el("strong", { style: "font-size:14px", text: plat?.label || key }),
        el("div", { class: "text-muted", style: "font-size:12px;margin-top:3px",
          text: ok ? (reach ? `${Number(reach).toLocaleString("ar-EG")} عضو في القناة وقت النشر` : "اتنشر بنجاح")
             : skipped ? "المنصة مش مربوطة" : String(res).replace("failed: ", "") }),
      ]),
      el("span", { class: `badge ${ok ? "badge-green" : skipped ? "badge-gray" : "badge-red"}`,
        text: ok ? "منشور" : skipped ? "متخطّي" : "فشل" }),
    ]));
  });
  body.append(rows);

  // التفاعلات — الجزء اللي محتاج موافقة المنصات
  const engagement = p.engagement || {};
  const hasEngagement = Object.keys(engagement).length > 0;

  body.append(el("h4", { class: "card-title", style: "margin-top:22px", text: "التفاعل على البوست" }));

  if (hasEngagement) {
    const grid = el("div", { class: "grid grid-4" });
    [
      ["comments", "تعليقات", "fa-comment"],
      ["reactions", "تفاعلات", "fa-heart"],
      ["shares", "مشاركات", "fa-share"],
      ["views", "مشاهدات", "fa-eye"],
    ].forEach(([k, label, icon]) => {
      const total = Object.values(engagement).reduce((s, e) => s + (Number(e?.[k]) || 0), 0);
      grid.append(el("div", { class: "card stat-card" }, [
        el("div", { class: "stat-icon", style: "background:#4361ee1a;color:#4361ee" }, [el("i", { class: `fas ${icon}` })]),
        el("div", { class: "stat-label", text: label }),
        el("div", { class: "stat-number", style: "font-size:24px", text: total.toLocaleString("ar-EG") }),
      ]));
    });
    body.append(grid);
  } else {
    body.append(el("div", { class: "ai-insight warn", html:
      `<strong>لسه مش متاح</strong>
       أرقام التعليقات والتفاعلات والمشاركات بتيجي من المنصة نفسها، وكل منصة ليها وضعها:
       <div style="margin-top:8px;line-height:2">
       • <b>تليجرام:</b> بيدي عدد أعضاء القناة ✅ (موضّح فوق)، لكن البوت مابيقدرش يقرا مشاهدات أو تفاعلات البوست<br>
       • <b>فيسبوك وانستجرام:</b> بيدوا كل الأرقام — بعد موافقة ميتا على التطبيق 🔒<br>
       • <b>واتساب:</b> مالوش تفاعلات أصلاً
       </div>` }));
  }

  body.append(el("div", { class: "kv", style: "margin-top:18px" }, [
    el("span", { text: "اتنشر" }), el("strong", { text: fmtDateTime(p.publishedAt) })]));
  if (p.createdByName) {
    body.append(el("div", { class: "kv" }, [
      el("span", { text: "بواسطة" }), el("strong", { text: p.createdByName })]));
  }
  if (p.price) {
    body.append(el("div", { class: "kv" }, [
      el("span", { text: "المنتج والسعر" }),
      el("strong", { text: `${p.productName || "—"} · ${p.price} جنيه` })]));
  }

  modal({ title: "تقرير البوست", body, width: 620,
    actions: [{ label: "إغلاق", class: "btn-light", onClick: ({ close }) => close() }] });
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
  draft?.flush();      // نحفظ اللي اتكتب قبل ما نسيب الشاشة
  draft?.destroy();
  draft = null;
  state = { caption: "", platforms: { facebook: false, instagram: false, telegram: false, whatsapp: false },
    attach: { address: false, hours: false, phones: false, links: false, price: false },
    price: "", productName: "", scheduleAt: "", previewMobile: false,
    media: [], lastCaption: null };
}
