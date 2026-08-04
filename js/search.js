// ============================================================
//  تقطيع أسماء الأصناف لكلمات وبادئات للبحث (نسخة المتصفح)
//
//  ⚠️ لازم يفضل مطابق لـ functions/lib/search.js — الكلمات بتتكتب
//     من الاتنين (الاستيراد من هنا، والفهرسة من السيرفر) والبحث
//     لازم يطابق اللي اتخزّن.
// ============================================================

// لو غيّرنا طريقة التقطيع، بنزوّد الرقم ده عشان النظام يطلب فهرسة جديدة
export const TOKEN_VERSION = 2;

const MAX_PREFIX = 15;   // أطول بادئة نخزّنها من الكلمة الواحدة
const MAX_TOKENS = 200;  // سقف أمان لعدد العناصر في المستند

/** توحيد شكل الحروف: تشكيل، همزات، تاء مربوطة، أرقام عربية */
export function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, "")   // التشكيل
    .replace(/ـ/g, "")                   // التطويل ـــ
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** كل بادئات الكلمة: "موبايل" → م، مو، موب، موبا، موباي، موبايل */
function prefixesOf(word, out) {
  const stop = Math.min(word.length, MAX_PREFIX);
  for (let i = 1; i <= stop; i++) out.add(word.slice(0, i));
  if (word.length > MAX_PREFIX) out.add(word);
}

/** كلمات وبادئات الصنف — الاسم والأقسام والباركود */
export function tokenize(product) {
  const out = new Set();

  const addField = (v) => {
    normalize(v).split(/\s+/).forEach((w) => { if (w) prefixesOf(w, out); });
  };

  addField(product?.name);
  addField(product?.category);
  addField(product?.subCategory);

  // الباركود: بادئات من 3 أرقام وطالع — أقل من كده بيطابق كل حاجة
  const bc = String(product?.barcode || "").trim().toLowerCase();
  if (bc) {
    for (let i = 3; i <= Math.min(bc.length, MAX_PREFIX); i++) out.add(bc.slice(0, i));
    out.add(bc);
  }

  return [...out].slice(0, MAX_TOKENS);
}

/**
 * كلمات البحث اللي المستخدم كتبها.
 * مابنعملش بادئات هنا — البادئات متخزّنة أصلاً في المستند،
 * فاللي المستخدم كتبه بيتطابق معاها زي ما هو.
 */
export function queryTokens(term) {
  return normalize(term).split(/\s+/).filter(Boolean);
}
