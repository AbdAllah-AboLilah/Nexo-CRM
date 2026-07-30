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
    k.phones ? `- أرقام التواصل (اتصال عادي): ${k.phones}` : "",
    k.whatsappNumber
      ? `- رقم الواتساب: ${k.whatsappNumber} (لينك: https://wa.me/${String(k.whatsappNumber).replace(/\D/g, "")})`
      : "- الواتساب: مفيش رقم واتساب مسجّل.",
    k.telegramBot ? `- بوت تليجرام: https://t.me/${String(k.telegramBot).replace(/^@/, "")}` : "",
    k.telegramChannel ? `- قناة تليجرام: https://t.me/${String(k.telegramChannel).replace(/^@/, "")}` : "",
    k.exchangePolicy ? `- سياسة الاستبدال: ${k.exchangePolicy}` : "",
    "",
    "قائمة الأصناف والأسعار:",
    productLines,
    "",
    "قواعد صارمة:",
    "1. ممنوع تماماً تخترع سعر أو منتج مش موجود في القائمة فوق. لو مش لاقي، قول إنك هتتأكد وترد.",
    "2. لو العميل بيسأل بصيغة تانية لنفس المنتج، افهم قصده من المعنى (مثلاً لو الصنف مسجّل باسم مختلف شوية عن اللي العميل كتبه).",
    "3. لو السؤال معقّد أو فيه شكوى، اعتذر بلطف وقول إن خدمة العملاء هترد فوراً.",
    "4. الردود قصيرة ومباشرة (سطرين لثلاثة على الأكثر).",
    "5. أرقام التواصل ورقم الواتساب حاجتين مختلفتين. ممنوع تقول إن رقم "
      + "التواصل عليه واتساب — ابعت رقم الواتساب المسجّل فوق بس. ولو مفيش "
      + "رقم واتساب مسجّل، قول إن الواتساب مش متاح حالياً واعرض رقم التواصل بدله.",
    "6. ممنوع تخترع أي رقم أو لينك أو عنوان مش مكتوب فوق حرفياً.",
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
async function generateReply({ company, products, userMessage, history = [], channel = "message", postContext = null }) {
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
    postContext ? `\n⚠️ ${postContext}\nلو العميل سأل عن السعر أو التفاصيل، رُد بسعر المنتج ده تحديداً.` : "",
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
      maxOutputTokens: 700,
      // ردود خدمة العملاء قصيرة ومباشرة — التفكير الداخلي بيبطّئ من غير فايدة
      thinkingConfig: { thinkingBudget: 0 },
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

/** توليد قوالب رد على التعليقات حسب نشاط الشركة ونبرتها */
async function generateTemplates({ companyName, businessType, tone, extraHint }) {
  const ai = client();
  const toneText = TONE_TEXT[tone] || TONE_TEXT.egyptian;

  const instruction = [
    `أنت خبير تسويق بتكتب ردود قصيرة لصفحة "${companyName || ""}".`,
    businessType ? `نشاط الشركة: ${businessType}.` : "",
    `الأسلوب المطلوب: ${toneText}`,
    "",
    "المطلوب: اكتب 8 جمل قصيرة (سطر واحد لكل جملة) يرد بيها البوت علناً على تعليق العميل اللي بيسأل عن السعر،",
    "بحيث يقوله إن السعر اتبعت في الرسائل الخاصة، بأسلوب متنوّع وجذّاب يناسب نشاط الشركة.",
    "كل جملة مختلفة عن التانية، ومناسبة للنشاط ده تحديداً.",
    extraHint ? `توجيه إضافي من صاحب الشركة: ${extraHint}` : "",
    "",
    "رجّع JSON بالشكل ده فقط: {\"templates\":[\"جملة\",\"جملة\",...]}",
  ].filter(Boolean).join("\n");

  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: "ولّد القوالب دلوقتي.",
    config: {
      systemInstruction: instruction,
      responseMimeType: "application/json",
      temperature: 1.0,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  try {
    const parsed = JSON.parse((res.text || "").trim());
    return (parsed.templates || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 12);
  } catch {
    return [];
  }
}

/**
 * صياغة "نشاط الشركة" من كلام صاحب المكان بلغته العادية.
 * الجملة دي بتتحط في تعليمات البوت، فبتأثّر على كل رد بعد كده — لازم تبقى
 * دقيقة ومختصرة مش إعلان.
 */
async function describeBusiness({ companyName, rawInput }) {
  const ai = client();

  const instruction = [
    "أنت بتساعد صاحب محل يوصف نشاط شغله في جملة واحدة واضحة.",
    companyName ? `اسم المكان: "${companyName}".` : "",
    "",
    "المطلوب: حوّل كلامه لجملة أو جملتين بالعامية المصرية توصف:",
    "إيه اللي بيبيعه أو بيقدّمه، ولمين، وإيه اللي يميّزه لو ذكره.",
    "",
    "قواعد:",
    "- ممنوع تخترع أي معلومة مش موجودة في كلامه (مواعيد، أسعار، فروع، سنين خبرة).",
    "- من غير مبالغة إعلانية ولا كلام إنشائي.",
    "- 25 كلمة كحد أقصى.",
    "",
    "رجّع JSON بالشكل ده فقط: {\"text\":\"الجملة\"}",
  ].filter(Boolean).join("\n");

  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: String(rawInput || "").slice(0, 1500),
    config: {
      systemInstruction: instruction,
      responseMimeType: "application/json",
      temperature: 0.8,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  try {
    return String(JSON.parse((res.text || "").trim()).text || "").trim();
  } catch {
    return String(res.text || "").trim().slice(0, 300);
  }
}

/**
 * كتابة بوست تسويقي من بيانات صنف — وبيبص على صورة الصنف لو موجودة.
 * Gemini بيقرا الصور، فبيقدر يوصف اللون والشكل والتفاصيل اللي مش مكتوبة.
 */
async function postFromProduct({ company, product, imageBytes, imageMime }) {
  const ai = client();
  const c = company.ai || {};
  const discount = product.priceBefore > product.priceAfter && product.priceBefore > 0
    ? Math.round((1 - product.priceAfter / product.priceBefore) * 100) : 0;

  const instruction = [
    `أنت كاتب محتوى تسويقي لصفحة "${company.name || ""}".`,
    c.businessType || company.businessType ? `نشاط الصفحة: ${c.businessType || company.businessType}.` : "",
    `الأسلوب: ${TONE_TEXT[c.tone] || TONE_TEXT.egyptian}`,
    "",
    "بيانات الصنف:",
    `- الاسم: ${product.name}`,
    product.category ? `- القسم: ${product.category}` : "",
    product.subCategory ? `- القسم الفرعي: ${product.subCategory}` : "",
    // السعر مابيتبعتش للموديل عن قصد — النظام هو اللي بيضيفه تحت البوست
    // لو صاحب المكان فعّل خيار "السعر"، فمانفعش الموديل يكتبه مرتين.
    discount > 0 ? `- على الصنف ده خصم ${discount}%` : "",
    imageBytes ? "- مرفق صورة الصنف: بُص عليها واستخدم اللي شايفه فيها (اللون، الشكل، التفاصيل)." : "",
    "",
    "المطلوب: كابشن بوست جاهز للنشر على السوشيال ميديا.",
    "",
    "قواعد:",
    "- 3 لـ 5 سطور، مش أطول.",
    "- ابدأ بجملة تشد الانتباه.",
    discount > 0
      ? `- اذكر إن فيه خصم ${discount}% كسبب للشراء دلوقتي — النسبة بس، من غير أي رقم سعر.`
      : "- ممنوع تتكلم عن خصم أو تخفيض، مفيش خصم على الصنف ده.",
    "- إيموجي بالمعقول (3 لـ 5).",
    "- اقفل بدعوة للتواصل أو الطلب.",
    "- ممنوع تخترع مواصفات مش في البيانات ولا في الصورة (ضمان، مقاسات، بلد صنع، مدة توصيل).",
    "- من غير هاشتاجات.",
    "",
    "⚠️ مهم جداً: ممنوع تماماً تكتب أي رقم سعر في الكابشن — لا بالجنيه"
      + " ولا بأي عملة، ولا حتى تلميح زي \"بـ 500 بس\". السعر بيتحط أوتوماتيك"
      + " تحت البوست من النظام. لو كتبته هيتكرر مرتين.",
    "",
    "رجّع JSON بالشكل ده فقط: {\"caption\":\"النص\"}",
  ].filter(Boolean).join("\n");

  const parts = [{ text: `اكتب بوست عن "${product.name}".` }];
  if (imageBytes) {
    parts.push({ inlineData: { mimeType: imageMime || "image/jpeg", data: imageBytes } });
  }

  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: instruction,
      responseMimeType: "application/json",
      temperature: 1.0,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  let caption;
  try {
    caption = String(JSON.parse((res.text || "").trim()).caption || "").trim();
  } catch {
    caption = String(res.text || "").trim().slice(0, 900);
  }

  return stripPrices(caption, product);
}

/**
 * شبكة أمان: الموديل أحياناً بيكتب السعر رغم التعليمات، والسعر بيتحط
 * تحت البوست من النظام — فبنشيل أي سطر فيه رقم سعر عشان مايتكررش.
 * نسبة الخصم (%) بتفضل زي ما هي.
 */
function stripPrices(text, product) {
  const nums = [product?.priceAfter, product?.priceBefore]
    .map((n) => Number(n) || 0).filter((n) => n > 0);

  return String(text || "")
    .split("\n")
    .filter((line) => {
      if (/%/.test(line)) return true;                 // سطر الخصم يفضل
      if (/\b(جنيه|ج\.م|جم|EGP|ر\.س|درهم|دينار)\b/i.test(line)) return false;
      // رقم من أرقام الصنف مكتوب في السطر = سعر مسرّب
      return !nums.some((n) => new RegExp(`(^|\\D)${n}(\\D|$)`).test(line));
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * استخراج بيانات طلب من محادثة.
 * بيرجّع اللي اتقال بالحرف بس — أي حقل مش مذكور بيرجع فاضي عشان
 * الموظف يشوفه فاضي ويسأل العميل، مش يلاقي بيانات مخترعة.
 */
async function extractOrder({ transcript, products = [], governorates = [] }) {
  const ai = client();

  const instruction = [
    "أنت بتقرا محادثة بين متجر وعميل، وبتستخرج منها بيانات الطلب.",
    "",
    "قواعد صارمة:",
    "- استخرج اللي اتقال في المحادثة بس. أي حقل مش متأكد منه سيبه فاضي (\"\").",
    "- ممنوع تخترع اسم أو رقم تليفون أو عنوان أو كمية.",
    "- الأسعار خدها من قائمة الأصناف تحت لو الصنف موجود فيها، مش من كلام العميل.",
    "- لو الصنف مش في القائمة، حط سعره 0.",
    governorates.length ? `- المحافظة لازم تكون واحدة من دول بالظبط أو فاضية: ${governorates.join("، ")}` : "",
    "",
    products.length ? "قائمة الأصناف والأسعار:" : "",
    products.slice(0, 200).map((p) => `- ${p.name}: ${p.priceAfter || 0}`).join("\n"),
    "",
    "رجّع JSON بالشكل ده فقط:",
    '{"customerName":"","phone":"","governorate":"","address":"",',
    '"items":[{"name":"","qty":1,"price":0}],"notes":"","confidence":"high|medium|low"}',
    "",
    "الـ notes: لخّص أي طلب خاص من العميل (لون، مقاس، ميعاد) في سطر.",
    "الـ confidence: low لو أغلب البيانات ناقصة.",
  ].filter(Boolean).join("\n");

  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: String(transcript || "").slice(0, 8000),
    config: {
      systemInstruction: instruction,
      responseMimeType: "application/json",
      temperature: 0.2,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  try {
    const p = JSON.parse((res.text || "").trim());
    return {
      customerName: String(p.customerName || "").trim(),
      phone: String(p.phone || "").replace(/[^\d+]/g, "").slice(0, 20),
      governorate: governorates.includes(p.governorate) ? p.governorate : "",
      address: String(p.address || "").trim(),
      items: Array.isArray(p.items)
        ? p.items.filter((i) => i && String(i.name || "").trim()).slice(0, 30).map((i) => ({
            name: String(i.name).trim().slice(0, 120),
            qty: Math.max(1, Number(i.qty) || 1),
            price: Math.max(0, Number(i.price) || 0),
          }))
        : [],
      notes: String(p.notes || "").trim().slice(0, 400),
      confidence: ["high", "medium", "low"].includes(p.confidence) ? p.confidence : "low",
    };
  } catch {
    return { customerName: "", phone: "", governorate: "", address: "", items: [], notes: "", confidence: "low" };
  }
}

/**
 * تحديد أي بوست بتطابقه صورة العميل.
 * بنبعت صورة العميل الأول وبعدين صور البوستات مرقّمة، ونسأل الموديل
 * رقم المطابق. بيرجّع معرّف البوست أو null لو مش متأكد.
 */
async function identifyPost({ customerImg, candidates }) {
  const ai = client();

  const parts = [
    { text: "دي صورة بعتها عميل:" },
    { inlineData: { mimeType: "image/jpeg", data: customerImg } },
    { text: "\nودي صور منتجاتنا:" },
  ];
  candidates.forEach((c, i) => {
    parts.push({ text: `\nصورة رقم ${i + 1}${c.name ? ` — ${c.name}` : ""}:` });
    parts.push({ inlineData: { mimeType: "image/jpeg", data: c.data } });
  });

  const instruction = [
    "بتقارن صورة بعتها عميل بصور منتجات متجر، وبتحدد أنهي منتج ده.",
    "",
    "قواعد صارمة:",
    "- المنتج لازم يكون **هو هو**، مش شبهه. لو شبهه بس مش متأكد، رجّع 0.",
    "- الصورة ممكن تكون سكرين شوت أو مقصوصة أو إضاءتها مختلفة — ركّز على",
    "  المنتج نفسه (شكله، لونه، الماركة، الموديل) مش جودة الصورة.",
    "- لو مش لاقي مطابقة واضحة، رجّع 0. الغلط هنا معناه سعر غلط للعميل.",
    "",
    `رجّع JSON بالشكل ده فقط: {"match":<رقم من 1 لـ ${candidates.length} أو 0>,"confidence":"high|medium|low"}`,
  ].join("\n");

  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: instruction,
      responseMimeType: "application/json",
      temperature: 0.1,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  try {
    const p = JSON.parse((res.text || "").trim());
    const idx = Number(p.match) || 0;
    // سعر غلط أسوأ من "مش عارف"، فبنقبل التأكيد العالي بس
    if (idx < 1 || idx > candidates.length || p.confidence === "low") return null;
    return candidates[idx - 1].id;
  } catch {
    return null;
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
  buildSystemPrompt, generateReply, assistPost, helpAnswer, generateTemplates,
  describeBusiness, postFromProduct, extractOrder, identifyPost, ping,
  TONE_TEXT, ASSIST_TASKS, client,
};
