// ============================================================
//  إعدادات الذكاء الاصطناعي (الشخصية / النبرة / قوالب الردود)
// ============================================================
import { db, doc, updateDoc, fns, httpsCallable } from "../firebase.js";
import { session, refreshCompany, atLeast } from "../auth.js";
import { AI_TONES, DEFAULT_AI, PLATFORMS, LINK_LABELS } from "../config.js";
import { buildLinks } from "./settings.js";
import { el, card, esc, toast, field, toggle, modal } from "../ui.js";

export async function render(root) {
  const c = session.company;
  if (!c) return;
  const ai = { ...DEFAULT_AI, ...(c.ai || {}) };
  const canEdit = atLeast("manager");

  root.append(el("div", { class: "page-head" }, [
    el("div", {}, [
      el("h2", { text: "إعدادات الذكاء الاصطناعي" }),
      el("div", { class: "sub", text: "من هنا بتحدد شخصية البوت ونبرة كلامه مع العملاء" }),
    ]),
  ]));

  // ---------- التفعيل + اختبار الاتصال ----------
  const enableBox = card("");
  const enabled = toggle({
    label: "تفعيل الرد الآلي", name: "aiEnabled", checked: ai.enabled !== false,
    hint: "لو قفلته، كل الرسائل هتتحوّل لصندوق الرسائل عشان ترد عليها يدوي",
  });
  enableBox.append(enabled.row);

  const testRow = el("div", { style: "display:flex;align-items:center;gap:12px;margin-top:14px;flex-wrap:wrap" });
  const testBtn = el("button", { class: "btn btn-ghost", html: '<i class="fas fa-plug-circle-check"></i> اختبار الاتصال' });
  const testResult = el("span", { class: "text-muted", style: "font-size:13px" });
  testBtn.addEventListener("click", async () => {
    testBtn.disabled = true;
    testResult.textContent = "جاري الاختبار...";
    testResult.style.color = "";
    try {
      const res = await httpsCallable(fns, "aiHealthCheck")();
      const d = res.data || {};
      if (d.ok) {
        testResult.textContent = `✅ الاتصال شغال — رد الذكاء الاصطناعي: "${d.reply}"`;
        testResult.style.color = "var(--success)";
      } else {
        testResult.textContent = "❌ " + (d.error || "فشل الاتصال");
        testResult.style.color = "var(--danger)";
      }
    } catch (e) {
      testResult.textContent = "❌ " + (e.message || "تعذّر الاتصال بالسيرفر");
      testResult.style.color = "var(--danger)";
    }
    testBtn.disabled = false;
  });
  testRow.append(testBtn, testResult);
  enableBox.append(testRow);
  root.append(enableBox);

  // ---------- النبرة ----------
  const toneBox = card("نبرة الرد");
  const toneGrid = el("div", { class: "grid grid-2" });
  let selectedTone = ai.tone || "egyptian";
  const toneCards = {};
  Object.entries(AI_TONES).forEach(([key, t]) => {
    const c1 = el("div", { class: `tenant-item${key === selectedTone ? " active" : ""}` }, [
      el("i", { class: "fas fa-comment-dots" }),
      el("div", {}, [el("strong", { text: t.label }), el("small", { text: t.desc })]),
    ]);
    c1.addEventListener("click", () => {
      if (!canEdit) return;
      selectedTone = key;
      Object.values(toneCards).forEach((x) => x.classList.remove("active"));
      c1.classList.add("active");
    });
    toneCards[key] = c1;
    toneGrid.append(c1);
  });
  toneBox.append(toneGrid);
  root.append(toneBox);

  // ---------- الشخصية ----------
  const personaBox = card("شخصية البوت وتعليماته");
  const businessType = field({
    label: "نشاط الشركة", name: "businessType", value: ai.businessType || c.businessType || "",
    placeholder: "مثال: منصة ذكية لإدارة صفحات التواصل والرد الآلي على العملاء",
    hint: "كل ما توصفه أدق، كل ما الردود تطلع أحسن",
  });
  const extra = field({
    label: "تعليمات إضافية للبوت", name: "extra", type: "textarea", rows: 5, value: ai.extraInstructions || "",
    placeholder: "مثال:\n- لو حد سأل عن حاجة ملهاش علاقة بخدماتنا، جاوبه بخفة دم وفكّره بنشاطنا.\n- متأكدش أي سعر مش موجود في قائمة الأصناف.\n- لو العميل زعلان، اعتذر واعرض تحويله لخدمة العملاء.",
  });
  // زرار توليد النشاط — صاحب المكان يكتب بلغته والذكاء الاصطناعي يصيغها
  const genBiz = el("button", { class: "btn btn-light btn-sm",
    html: '<i class="fas fa-wand-magic-sparkles"></i> اكتبهولي بالذكاء الاصطناعي' });
  genBiz.addEventListener("click", () => describeBusinessDialog(businessType.input));
  // في صف لوحده تحت الحقل — قبل كده كان بهامش سالب فبيركب على نص التوضيح
  businessType.wrap.append(el("div", { style: "margin-top:8px" }, [genBiz]));

  personaBox.append(businessType.wrap, extra.wrap);
  root.append(personaBox);

  // ---------- إرفاق الثوابت في ردود الخاص ----------
  const k = c.constants || {};
  const dmBox = card("إيه اللي يترفق في ردود الرسائل الخاصة؟");
  dmBox.append(el("p", { class: "text-muted", style: "margin-bottom:14px",
    text: "لما البوت يرد على رسالة خاصة، تقدر تخليه يرفق البيانات دي تحت الرد أوتوماتيك. الروابط بتتفلتر ذكياً — مش هيبعت لينك تليجرام لعميل جاي من تليجرام." }));

  const dm = { ...(DEFAULT_AI.dmAttach), ...(ai.dmAttach || {}) };
  const dmInputs = {};
  const dmDefs = [
    { key: "price", label: "سعر المنتج اللي سأل عنه", available: true,
      missing: "", hint: "بيظهر بس لما العميل جاي من بوست له سعر محفوظ" },
    { key: "address", label: "العنوان", available: !!k.address, missing: "اكتب العنوان في شاشة الثوابت" },
    { key: "hours", label: "مواعيد العمل", available: !!k.workingHours, missing: "اكتب المواعيد في شاشة الثوابت" },
    { key: "phones", label: "أرقام التواصل", available: !!k.phones, missing: "اكتب الأرقام في شاشة الثوابت" },
    { key: "links", label: "روابط التواصل الذكية", available: !!(k.whatsappNumber || k.telegramChannel || k.instagramUser || k.facebookPage), missing: "اكتب الروابط في شاشة الثوابت" },
  ];

  const dmGrid = el("div", { class: "grid grid-2" });
  dmDefs.forEach((d) => {
    const t = toggle({
      label: d.label, name: `dm-${d.key}`, checked: !!dm[d.key],
      disabled: !d.available || !canEdit,
      hint: d.available ? (d.hint || "") : d.missing,
    });
    dmInputs[d.key] = t.input;
    dmGrid.append(t.row);
  });
  dmBox.append(dmGrid);

  const dmPreview = el("div", { class: "ai-insight", style: "margin-top:16px" });
  dmBox.append(dmPreview);
  const updateDmPreview = () => {
    const parts = [];
    if (dmInputs.price.checked) parts.push("💰 تيشيرت قطن — السعر: 250 جنيه");
    if (dmInputs.address.checked && k.address) parts.push(`📍 ${k.address}`);
    if (dmInputs.hours.checked && k.workingHours) parts.push(`🕐 ${k.workingHours}`);
    if (dmInputs.phones.checked && k.phones) parts.push(`📞 ${k.phones}`);
    if (dmInputs.links.checked) {
      const links = buildLinks(k);
      delete links.telegram; delete links.telegramBot;   // مثال: العميل جاي من تليجرام
      const lines = Object.entries(links).map(([p, u]) => `${LINK_LABELS[p] || PLATFORMS[p]?.label || p}: ${u}`);
      if (lines.length) parts.push(lines.join("\n"));
    }
    dmPreview.innerHTML = `<strong>معاينة (عميل جاي من بوست على تليجرام)</strong><div style="white-space:pre-wrap;font-size:13px">${
      esc("أهلاً بيك يا فندم! التيشيرت ده متوفر ومقاساته كاملة 🌸")}${
      parts.length ? "\n\n———\n" + esc(parts.join("\n")) : ""}</div>`;
  };
  Object.values(dmInputs).forEach((i) => i.addEventListener("change", updateDmPreview));
  updateDmPreview();
  root.append(dmBox);

  // ---------- زراير البوست على تليجرام ----------
  const btnBox = card("زراير البوست على تليجرام");
  btnBox.append(el("p", { class: "text-muted", style: "margin-bottom:14px",
    text: "الزراير دي بتظهر تحت كل بوست بينزل على القناة، وبتوصّل العميل للبوت." }));

  const btnMode = field({
    label: "شكل الزراير", name: "postButtons", type: "select",
    value: ai.postButtons || "two",
    options: [
      { value: "two", label: "زرارين — «تفاصيل المنتج» و«تواصل معانا»" },
      { value: "one", label: "زرار واحد — «تفاصيل المنتج» بس" },
      { value: "none", label: "من غير زراير" },
    ],
  });
  const keepStart = toggle({
    label: "سيب كلمة /start ظاهرة في شات العميل", name: "keepStart",
    checked: ai.keepStartCommand === true, disabled: !canEdit,
    hint: "تليجرام بيبعت /start أوتوماتيك أول ما العميل يفتح البوت، والبوت مش بيقدر يغيّر نصها — يقدر يمسحها بس. الافتراضي إنها تتمسح والبوت يرحّب بدالها.",
  });
  btnBox.append(btnMode.wrap, keepStart.row);

  btnBox.append(el("div", { class: "ai-insight", style: "margin-top:14px", html:
    `<strong>إيه اللي بيحصل لما العميل يدوس؟</strong>
     بيتفتح البوت، والبوت بيرحّب بيه ويقوله إنه بيسأل عن أنهي منتج،
     وبيعرض عليه اقتراحات أسئلة تحت مربع الكتابة.
     <b>مفيش رسالة بتتبعت باسمه من غير إذنه</b> — هو اللي يختار.` }));
  root.append(btnBox);

  // ---------- قوالب رد التعليقات ----------
  const tplBox = card("قوالب الرد العام على التعليقات");
  tplBox.append(el("p", { class: "text-muted", style: "margin-bottom:14px",
    text: "لما العميل يسأل عن سعر في تعليق، البوت بيرد علناً بواحدة من الجمل دي (بالتناوب عشان ميبانش آلي)، ويبعت السعر في الخاص." }));

  const tplWrap = el("div");
  const templates = [...(ai.commentTemplates || DEFAULT_AI.commentTemplates)];
  function drawTemplates() {
    tplWrap.innerHTML = "";
    templates.forEach((t, i) => {
      const row = el("div", { style: "display:flex;gap:8px;margin-bottom:8px" });
      const input = el("input", { class: "form-control", value: t });
      input.addEventListener("input", () => { templates[i] = input.value; });
      const del = el("button", { class: "btn btn-light btn-sm", html: '<i class="fas fa-trash"></i>' });
      del.addEventListener("click", () => { templates.splice(i, 1); drawTemplates(); });
      row.append(input, del);
      if (!canEdit) { input.disabled = true; del.disabled = true; }
      tplWrap.append(row);
    });
  }
  drawTemplates();
  tplBox.append(tplWrap);

  if (canEdit) {
    const add = el("button", { class: "btn btn-ghost btn-sm", html: '<i class="fas fa-plus"></i> إضافة جملة' });
    add.addEventListener("click", () => { templates.push(""); drawTemplates(); });
    tplBox.append(add);

    // ---------- توليد القوالب بالذكاء الاصطناعي ----------
    const genWrap = el("div", { style: "margin-top:20px;padding-top:18px;border-top:1px dashed var(--line)" });
    genWrap.append(el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:10px" }, [
      el("i", { class: "fas fa-wand-magic-sparkles", style: "color:var(--primary)" }),
      el("strong", { style: "font-size:14px", text: "ولّد قوالب مناسبة لنشاطك" }),
    ]));
    genWrap.append(el("p", { class: "hint", style: "margin-bottom:10px",
      text: "النظام هيقترح قوالب حسب نشاط الشركة ونبرتها. علّم على اللي عاجبك وأضفه، وتقدر تعدّل فيه بعدين." }));

    const hint = field({ name: "genHint", placeholder: "توجيه إضافي (اختياري) — مثلاً: خلّيها رسمية شوية، أو ركّز على التوصيل السريع" });
    genWrap.append(hint.wrap);

    const genBtn = el("button", { class: "btn btn-primary btn-sm", html: '<i class="fas fa-bolt"></i> ولّد اقتراحات' });
    const suggBox = el("div", { style: "margin-top:14px" });
    genWrap.append(genBtn, suggBox);

    genBtn.addEventListener("click", async () => {
      genBtn.disabled = true;
      genBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التوليد...';
      suggBox.innerHTML = "";
      try {
        const res = await httpsCallable(fns, "generateTemplates")({
          companyId: session.companyId,
          extraHint: hint.input.value.trim(),
        });
        const list = res.data?.templates || [];
        if (!list.length) throw new Error("مرجعش قوالب");

        suggBox.append(el("p", { class: "text-muted", style: "font-size:12.5px;margin-bottom:8px",
          text: "علّم على اللي عايز تضيفه:" }));

        const picks = new Set();
        list.forEach((t) => {
          const cb = el("input", { type: "checkbox" });
          const row = el("label", { class: "check-row", style: "margin-bottom:7px" }, [cb, el("span", { text: t })]);
          cb.addEventListener("change", () => {
            row.classList.toggle("checked", cb.checked);
            cb.checked ? picks.add(t) : picks.delete(t);
          });
          suggBox.append(row);
        });

        const addSel = el("button", { class: "btn btn-success btn-sm", style: "margin-top:6px",
          html: '<i class="fas fa-plus"></i> أضف المختار' });
        addSel.addEventListener("click", () => {
          if (!picks.size) return toast("علّم على قالب واحد على الأقل", "warn");
          picks.forEach((t) => { if (!templates.includes(t)) templates.push(t); });
          drawTemplates();
          toast(`تمت إضافة ${picks.size} قالب`, "success");
          suggBox.innerHTML = "";
        });
        suggBox.append(addSel);
      } catch (e) {
        toast("فشل التوليد: " + (e.message || ""), "error");
      }
      genBtn.disabled = false;
      genBtn.innerHTML = '<i class="fas fa-bolt"></i> ولّد اقتراحات تانية';
    });

    tplBox.append(genWrap);
  }
  root.append(tplBox);

  // ---------- المعاينة ----------
  const previewBox = card("معاينة التعليمات اللي هتروح للذكاء الاصطناعي");
  const pre = el("pre", { class: "preview-body", style: "background:#fafbfd;border-radius:10px;font-size:12.5px;overflow-x:auto" });
  previewBox.append(pre);
  root.append(previewBox);

  const updatePreview = () => {
    pre.textContent = buildSystemPrompt({
      companyName: c.name,
      businessType: businessType.input.value,
      tone: selectedTone,
      extraInstructions: extra.input.value,
      constants: c.constants || {},
      productsNote: "«هنا بيتحط ملخص الأصناف والأسعار من قاعدة البيانات وقت الرد»",
    });
  };
  [businessType.input, extra.input].forEach((i) => i.addEventListener("input", updatePreview));
  Object.values(toneCards).forEach((c2) => c2.addEventListener("click", updatePreview));
  updatePreview();

  // ---------- الحفظ ----------
  if (canEdit) {
    const save = el("button", { class: "btn btn-primary", style: "margin-top:18px", html: '<i class="fas fa-floppy-disk"></i> حفظ الإعدادات' });
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        await updateDoc(doc(db, "companies", session.companyId), {
          ai: {
            enabled: enabled.input.checked,
            tone: selectedTone,
            businessType: businessType.input.value.trim(),
            extraInstructions: extra.input.value.trim(),
            commentTemplates: templates.map((t) => t.trim()).filter(Boolean),
            dmAttach: Object.fromEntries(Object.entries(dmInputs).map(([k2, i]) => [k2, i.checked])),
            postButtons: btnMode.input.value,
            keepStartCommand: keepStart.input.checked,
          },
        });
        await refreshCompany();
        toast("تم حفظ إعدادات الذكاء الاصطناعي", "success");
      } catch (e) { toast("فشل الحفظ: " + e.message, "error"); }
      save.disabled = false;
    });
    root.append(save);
  }
}

/** يكتب "نشاط الشركة" من كلام صاحب المكان بلغته العادية */
function describeBusinessDialog(targetInput) {
  const raw = el("textarea", { class: "form-control", rows: 5,
    placeholder: "احكي بلغتك العادية:\nمثال: عندي محل موبايلات في المنصورة، ببيع أجهزة جديدة ومستعملة وإكسسوارات، وبعمل صيانة كمان." });
  const result = el("textarea", { class: "form-control", rows: 3 });
  const regen = el("button", { class: "btn btn-light btn-sm", style: "margin-top:8px",
    html: '<i class="fas fa-rotate"></i> ولّد صيغة تانية' });
  const out = el("div", { style: "display:none;margin-top:16px" }, [
    el("label", { class: "field", text: "الصيغة المقترحة — عدّل فيها زي ما تحب" }),
    result, regen,
  ]);

  const body = el("div", {}, [
    el("label", { class: "field", text: "احكيلي إيه اللي شغّال فيه؟" }), raw,
    el("p", { class: "hint", text: "الجملة دي بتدخل في تعليمات البوت، فبتأثر على كل رد بعد كده." }),
    out,
  ]);

  let busy = false;
  async function generate(btn) {
    const text = raw.value.trim();
    if (text.length < 10) { toast("اكتب شوية تفاصيل أكتر عن شغلك", "error"); return false; }
    if (busy) return false;
    busy = true;
    const old = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> بيكتب...';
    try {
      const res = await httpsCallable(fns, "describeBusiness")({
        companyId: session.companyId, input: text,
      });
      result.value = res.data.text || "";
      out.style.display = "";
      return true;
    } catch (e) {
      toast("فشل التوليد: " + (e.message || ""), "error");
      return false;
    } finally {
      busy = false;
      btn.disabled = false;
      btn.innerHTML = old;
    }
  }

  const m = modal({
    title: "توليد نشاط الشركة", body, width: 560,
    actions: [
      { label: "إلغاء", class: "btn-light", onClick: ({ close }) => close() },
      { label: "ولّد", class: "btn-primary", onClick: async ({ button, close }) => {
        // نفس الزرار بيولّد الأول، وبعد ما الصيغة تظهر بيبقى "استخدم دي"
        if (out.style.display === "none") {
          if (await generate(button)) button.textContent = "استخدم دي";
          return;
        }
        if (!result.value.trim()) return toast("مفيش نص", "error");
        targetInput.value = result.value.trim();
        targetInput.dispatchEvent(new Event("input", { bubbles: true }));
        toast("اتكتبت — اضغط «حفظ الإعدادات» عشان تتسجّل", "success");
        close();
      } },
    ],
  });

  regen.addEventListener("click", () => generate(regen));
  return m;
}

/** نفس المنطق موجود في السيرفر — ده للمعاينة بس */
export function buildSystemPrompt({ companyName, businessType, tone, extraInstructions, constants = {}, productsNote = "" }) {
  const toneText = {
    funny: "دمك خفيف جداً، بتستخدم العامية المصرية الدافية وإيموجيز، وبتهزّر بلطف.",
    formal: "أسلوبك رسمي ومحترم، بدون مزاح وبدون إيموجيز كتير.",
    egyptian: "بتتكلم عامية مصرية بسيطة وودودة وواضحة، بدون مبالغة في المزاح.",
    balanced: "بتبدأ بأسلوب مهني وراقي، ولو العميل هزّر ترد بخفة دم.",
  }[tone] || "";

  return [
    `أنت مساعد خدمة عملاء لصفحة "${companyName || ""}".`,
    businessType ? `نشاط الشركة: ${businessType}.` : "",
    `أسلوبك: ${toneText}`,
    "",
    "بيانات ثابتة تقدر ترد بيها:",
    constants.address ? `- العنوان: ${constants.address}` : "",
    constants.workingHours ? `- مواعيد العمل: ${constants.workingHours}` : "",
    constants.phones ? `- أرقام التواصل: ${constants.phones}` : "",
    constants.exchangePolicy ? `- سياسة الاستبدال: ${constants.exchangePolicy}` : "",
    "",
    "الأصناف والأسعار:",
    productsNote,
    "",
    "قواعد صارمة:",
    "1. ممنوع تماماً تخترع سعر أو منتج مش موجود في القائمة. لو مش لاقي، قول إنك هتتأكد وترد.",
    "2. لو السؤال معقّد أو فيه شكوى، اعتذر بلطف وقول إن خدمة العملاء هترد فوراً.",
    "3. الردود قصيرة ومباشرة (سطرين لثلاثة على الأكثر).",
    extraInstructions ? "\nتعليمات إضافية من صاحب الشركة:\n" + extraInstructions : "",
  ].filter(Boolean).join("\n");
}
