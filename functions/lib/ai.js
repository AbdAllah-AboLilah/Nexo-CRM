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
 * توليد رد + تصنيف
 * بيرجّع: { reply, intent, needsHuman, isComplaint, isAbusive }
 */
async function generateReply({ apiKey, company, products, userMessage, history = [], channel = "message" }) {
  const ai = new GoogleGenAI({ apiKey });

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

module.exports = { buildSystemPrompt, generateReply, TONE_TEXT };
