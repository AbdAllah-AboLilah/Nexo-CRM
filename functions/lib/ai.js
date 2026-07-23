// ============================================================
//  محرك الذكاء الاصطناعي (Gemini)
//  بيبني التعليمات من بيانات الشركة، ويرجّع رد + تصنيف النية
// ============================================================
const { GoogleGenAI } = require("@google/genai");

const TONE_TEXT = {
  funny: "دمك خفيف جداً، بتستخدم العامية المصرية الدافية وإيموجيز، وبتهزّر بلطف.",
  formal: "أسلوبك رسمي ومحترم، بدون مزاح وبدون إيموجيز كتير.",
  egyptian: "بتتكلم عامية مصرية بسيطة وودودة وواضحة، بدون مبالغة في المزاح.",
  balanced: "بتبدأ بأسلوب مهني وراقي، ولو العميل هزّر ترد بخفة دم.",
};

/** بناء تعليمات النظام من بيانات الشركة */
function buildSystemPrompt(company, products = []) {
  const ai = company.ai || {};
  const k = company.constants || {};

  const productLines = products.length
    ? products.slice(0, 300).map((p) => {
        const before = p.priceBefore && p.priceBefore > p.priceAfter ? ` (كان ${p.priceBefore})` : "";
        const cat = [p.category, p.subCategory].filter(Boolean).join(" / ");
        return `- ${p.name}${cat ? ` [${cat}]` : ""}: ${p.priceAfter} جنيه${before}`;
      }).join("\n")
    : "(لا توجد أصناف مسجلة بعد)";

  return [
    `أنت مساعد خدمة عملاء لصفحة "${company.name || ""}".`,
    ai.businessType || company.businessType ? `نشاط الشركة: ${ai.businessType || company.businessType}.` : "",
    `أسلوبك: ${TONE_TEXT[ai.tone] || TONE_TEXT.egyptian}`,
    "",
    "بيانات ثابتة تقدر ترد بيها:",
    k.address ? `- العنوان: ${k.address}` : "",
    k.workingHours ? `- مواعيد العمل: ${k.workingHours}` : "",
    k.phones ? `- أرقام التواصل: ${k.phones}` : "",
    k.exchangePolicy ? `- سياسة الاستبدال: ${k.exchangePolicy}` : "",
    "",
    "قائمة الأصناف والأسعار:",
    productLines,
    "",
    "قواعد صارمة:",
    "1. ممنوع تماماً تخترع سعر أو منتج مش موجود في القائمة فوق. لو مش لاقي، قول إنك هتتأكد وترد.",
    "2. لو العميل بيسأل بصيغة تانية لنفس المنتج، افهم قصده من المعنى (مثلاً «الحجاب الكريب» = «طرحة كريب»).",
    "3. لو السؤال معقّد أو فيه شكوى، اعتذر بلطف وقول إن خدمة العملاء هترد فوراً.",
    "4. الردود قصيرة ومباشرة (سطرين لثلاثة على الأكثر).",
    ai.extraInstructions ? `\nتعليمات إضافية من صاحب الشركة:\n${ai.extraInstructions}` : "",
  ].filter(Boolean).join("\n");
}

/**
 * الاتصال بـ Gemini من غير أي API Key.
 * السيرفر شغال جوه Google Cloud، فبيتوثّق بهوية المشروع نفسه (ADC).
 * ميزة الطريقة دي: مفيش مفتاح يتسرب ولا يتغيّر ولا يتجدّد.
 */
function client() {
  return new GoogleGenAI({
    vertexai: true,
    project: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT,
    location: process.env.VERTEX_LOCATION || "us-central1",
  });
}

/**
 * توليد رد + تصنيف
 * بيرجّع: { reply, intent, needsHuman, isComplaint, isAbusive }
 */
async function generateReply({ company, products, userMessage, history = [], channel = "message" }) {
  const ai = client();

  const context = history.slice(-6)
    .map((m) => `${m.from === "customer" ? "العميل" : "المتجر"}: ${m.text}`)
    .join("\n");

  const instruction = [
    buildSystemPrompt(company, products),
    "",
    channel === "comment"
      ? "المصدر: تعليق عام على بوست. لو السؤال عن السعر، الرد العام لازم يكون قصير جداً ويقول إن السعر اتبعت في الخاص."
      : "المصدر: رسالة خاصة.",
    "",
    "مطلوب منك ترجع JSON فقط بالشكل ده بدون أي كلام قبله أو بعده:",
    `{"reply":"نص الرد","intent":"price|hours|address|jobs|order|complaint|greeting|other","needsHuman":true|false,"isComplaint":true|false,"isAbusive":true|false}`,
  ].join("\n");

  const contents = [
    context ? `سياق المحادثة السابقة:\n${context}\n` : "",
    `رسالة العميل الحالية: "${userMessage}"`,
  ].filter(Boolean).join("\n");

  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents,
    config: {
      systemInstruction: instruction,
      responseMimeType: "application/json",
      temperature: 0.8,
    },
  });

  const text = (res.text || "").trim();
  try {
    const parsed = JSON.parse(text);
    return {
      reply: String(parsed.reply || "").trim(),
      intent: parsed.intent || "other",
      needsHuman: parsed.needsHuman === true,
      isComplaint: parsed.isComplaint === true,
      isAbusive: parsed.isAbusive === true,
    };
  } catch {
    // لو الموديل رجّع نص عادي بدل JSON
    return { reply: text, intent: "other", needsHuman: false, isComplaint: false, isAbusive: false };
  }
}

// ---------- مساعد كتابة البوستات ----------
const ASSIST_TASKS = {
  improve:   "حسّن صياغة البوست ده وخليه أوضح وأجذب للعميل، من غير ما تغيّر المعنى أو تزوّد معلومات مش موجودة.",
  fix:       "صحّح الأخطاء الإملائية والنحوية وعلامات الترقيم بس. متغيّرش الأسلوب ولا الكلمات إلا لو غلط.",
  emoji:     "ضيف إيموجيز مناسبة للبوست ده في الأماكن المناسبة. متغيّرش أي كلمة من النص.",
  shorten:   "اختصر البوست ده وخليه أقصر وأقوى، مع الحفاظ على كل المعلومات المهمة.",
  expand:    "وسّع البوست ده شوية وخليه أغنى وأجذب، من غير ما تخترع معلومات أو أسعار مش مكتوبة.",
  marketing: "أعد صياغة البوست بأسلوب تسويقي جذاب يشجّع على الشراء، مع نداء واضح للعميل في الآخر.",
  hashtags:  "ضيف في آخر البوست 5 إلى 8 هاشتاجات مناسبة بالعربي. سيب باقي النص زي ما هو بالظبط.",
};

/** مساعدة في كتابة/تحسين نص البوست */
async function assistPost({ text, task, company }) {
  const prompt = ASSIST_TASKS[task] || ASSIST_TASKS.improve;
  const ai = client();

  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: text,
    config: {
      systemInstruction: [
        `أنت كاتب محتوى لصفحة "${company?.name || ""}"${company?.businessType ? ` — ${company.businessType}` : ""}.`,
        `المطلوب: ${prompt}`,
        "",
        "قواعد مهمة:",
        "- اكتب بالعامية المصرية الودودة إلا لو النص الأصلي فصحى.",
        "- ممنوع تخترع أسعار أو أرقام أو عناوين مش موجودة في النص الأصلي.",
        "- رجّع نص البوست النهائي **بس**، من غير أي مقدمة أو شرح أو علامات تنسيق.",
      ].join("\n"),
      temperature: 0.7,
    },
  });

  return String(res.text || "").trim();
}

// ---------- المساعد الذكي (دعم داخل النظام) ----------
/**
 * بيرد على أسئلة الشركة عن استخدام النظام — من دليل النظام فقط.
 * بيرجّع: { answer, resolved, offerSupport, suggestedFeature }
 */
async function helpAnswer({ question, knowledge, companyName, roleLabel }) {
  const ai = client();

  const instruction = [
    "أنت مساعد دعم فني لنظام Nexo — نظام إدارة صفحات وتواصل.",
    `بتكلم مستخدم من شركة "${companyName || ""}" وصلاحيته: ${roleLabel || "مستخدم"}.`,
    "",
    "=== دليل النظام (المصدر الوحيد المسموح) ===",
    knowledge,
    "=== نهاية الدليل ===",
    "",
    "قواعد صارمة جداً:",
    "1. ممنوع منعاً باتاً تخترع أي خطوة أو زرار أو شاشة مش مكتوبة في الدليل فوق.",
    "2. لو السؤال ملوش إجابة واضحة في الدليل، قول بصراحة إنك مش متأكد واعرض تحويله للدعم.",
    "3. لو الميزة مكتوب إنها «مش متاحة في باقتها»، قول كده بوضوح واعرض إنك تبعت طلب لإدارة النظام.",
    "4. لو صلاحية المستخدم أقل من المطلوب، نبّهه إن ده محتاج صلاحية أعلى ويكلّم صاحب المكان.",
    "5. رد بالعامية المصرية البسيطة، مختصر وعملي، والخطوات مرقّمة.",
    "",
    "رجّع JSON بالشكل ده بالظبط وبس:",
    '{"answer":"الرد","resolved":true|false,"offerSupport":true|false,"suggestedFeature":"وصف مختصر للطلب أو نص فاضي"}',
    "",
    "- resolved = true لو لقيت الإجابة كاملة في الدليل.",
    "- offerSupport = true لو مش متأكد أو الموضوع محتاج تدخل من إدارة النظام.",
    "- suggestedFeature = وصف الطلب لو المستخدم بيطلب ميزة مش موجودة، وإلا سيبه فاضي.",
  ].join("\n");

  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: question,
    config: { systemInstruction: instruction, responseMimeType: "application/json", temperature: 0.3 },
  });

  const text = String(res.text || "").trim();
  try {
    const p = JSON.parse(text);
    return {
      answer: String(p.answer || "").trim(),
      resolved: p.resolved === true,
      offerSupport: p.offerSupport === true,
      suggestedFeature: String(p.suggestedFeature || "").trim(),
    };
  } catch {
    return { answer: text, resolved: false, offerSupport: true, suggestedFeature: "" };
  }
}

/** اختبار سريع للتأكد إن الاتصال بـ Gemini شغال */
async function ping() {
  const ai = client();
  const r = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: "رد بكلمة واحدة بس: تمام",
  });
  return String(r.text || "").trim();
}

module.exports = {
  buildSystemPrompt, generateReply, assistPost, helpAnswer, ping,
  TONE_TEXT, ASSIST_TASKS, client,
};
