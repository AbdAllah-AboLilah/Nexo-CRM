// ============================================================
//  إعدادات الذكاء الاصطناعي (الشخصية / النبرة / قوالب الردود)
// ============================================================
import { db, doc, updateDoc, fns, httpsCallable } from "../firebase.js";
import { session, refreshCompany, atLeast } from "../auth.js";
import { AI_TONES, DEFAULT_AI } from "../config.js";
import { el, card, esc, toast, field, toggle } from "../ui.js";

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
  personaBox.append(businessType.wrap, extra.wrap);
  root.append(personaBox);

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
