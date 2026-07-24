// ============================================================
//  Nexo CRM — الإعدادات العامة للنظام
//  أي رقم إصدار أو إعداد أساسي بيتغير من هنا فقط
// ============================================================

// الرقم الأساسي (major.minor) — غيّره بس في التحديثات الكبيرة.
// رقم البناء الكامل بيتولّد أوتوماتيك وقت الرفع (version.json).
export const APP_VERSION = "2.4";
export const APP_NAME = "Nexo";
export const APP_TAGLINE = "نظام متكامل لإدارة الصفحات والتواصل";

// الإيميل ده بيتعامل كـ Super Admin دائماً (نفس القيمة موجودة في firestore.rules)
export const SUPER_ADMIN_EMAIL = "admin@nexo.com";

// ---------- أسماء المستخدمين ----------
// فايربيز بيطلب صيغة بريد إلكتروني، فالمستخدم يكتب اسم عادي
// والنظام بيكمّل الجزء الناقص لوحده. ده اسم داخلي مش بريد حقيقي.
export const USER_DOMAIN = "nexo.local";

/** بيحوّل "ahmed" لـ "ahmed@nexo.local"، ولو كتب بريد كامل بيسيبه زي ما هو */
export function normalizeLogin(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "";
  if (v.includes("@")) return v;
  return `${v.replace(/\s+/g, ".")}@${USER_DOMAIN}`;
}

/** بيشيل الدومين الداخلي عند العرض عشان المستخدم يشوف اسمه بس */
export function displayLogin(email) {
  const v = String(email || "");
  return v.endsWith(`@${USER_DOMAIN}`) ? v.slice(0, -(USER_DOMAIN.length + 1)) : v;
}

export const firebaseConfig = {
  apiKey: "AIzaSyBc3cKrm0ML_Nr7aFWD79Za7_AD1hiaWLk",
  authDomain: "nexo-crm-28376.firebaseapp.com",
  projectId: "nexo-crm-28376",
  storageBucket: "nexo-crm-28376.firebasestorage.app",
  messagingSenderId: "321679158718",
  appId: "1:321679158718:web:cf1d0f0ced4ea78773ddef",
};

// ---------- الأدوار ----------
// كل دور له رقم؛ الأعلى بيقدر يعمل كل اللي تحته
export const ROLES = {
  superadmin: { level: 100, label: "منشئ النظام", short: "Super Admin" },
  owner:      { level: 80,  label: "صاحب المكان", short: "Owner" },
  manager:    { level: 60,  label: "مدير السوشيال ميديا", short: "Manager" },
  agent:      { level: 40,  label: "موظف خدمة عملاء", short: "Agent" },
};

export const ROLE_ORDER = ["superadmin", "owner", "manager", "agent"];

// ---------- المنصات ----------
export const PLATFORMS = {
  facebook:  { label: "فيسبوك",   icon: "fab fa-facebook-f",  color: "#1877f2", feature: "canPostFacebook" },
  instagram: { label: "انستجرام", icon: "fab fa-instagram",   color: "#e1306c", feature: "canPostInstagram" },
  telegram:  { label: "تليجرام",  icon: "fab fa-telegram-plane", color: "#229ed9", feature: "canPostTelegram" },
  whatsapp:  { label: "واتساب",   icon: "fab fa-whatsapp",    color: "#25d366", feature: "canPostWhatsapp" },
};

// بوت تليجرام مش منصة نشر — بس بيظهر كلينك تواصل في البوستات والردود
export const LINK_LABELS = {
  ...Object.fromEntries(Object.entries({
    facebook: "فيسبوك", instagram: "انستجرام", telegram: "تليجرام", whatsapp: "واتساب",
  })),
  telegramBot: "كلّمنا على تليجرام",
};

// ---------- نبرة الرد ----------
export const AI_TONES = {
  funny:    { label: "مرح وفكاهي", desc: "إيموجيز وخفة دم وعامية دافية" },
  formal:   { label: "رسمي", desc: "لغة راقية بدون مزاح" },
  egyptian: { label: "عامية مصرية بسيطة", desc: "ودود وواضح بدون مبالغة" },
  balanced: { label: "متوازن", desc: "يبدأ رسمي، ولو العميل هزّر يرد بخفة دم" },
};

// ---------- الميزات الافتراضية لأي شركة جديدة ----------
export const DEFAULT_FEATURES = {
  canPostFacebook: false,
  canPostInstagram: false,
  canPostTelegram: true,
  canPostWhatsapp: false,
  canUseAI: true,
  canUseModeration: false,
  canUseReports: false,
  canUseOrders: true,
  maxAgents: 3,
  maxMonthlyReplies: 1000,
};

export const DEFAULT_CONSTANTS = {
  address: "",
  workingHours: "",
  phones: "",
  exchangePolicy: "",
  whatsappNumber: "",
  instagramUser: "",
  telegramChannel: "",
  telegramBot: "",
  facebookPage: "",
};

export const DEFAULT_AI = {
  enabled: true,
  tone: "egyptian",
  businessType: "",
  extraInstructions: "",
  // إيه اللي يترفق تلقائياً في ردود الرسائل الخاصة
  dmAttach: { address: false, hours: false, phones: false, links: false },
  commentTemplates: [
    "بعتنالك السعر في الرسايل يا قمر 🌸",
    "شيكي على الخاص يا سكر، التفاصيل كلها هناك 📩",
    "وصلك السعر في المسجات يا عسل ✨",
  ],
};

// ---------- محافظات مصر (لتسعير الشحن) ----------
export const GOVERNORATES = [
  "القاهرة", "الجيزة", "الإسكندرية", "الغربية", "الدقهلية", "الشرقية",
  "المنوفية", "القليوبية", "كفر الشيخ", "البحيرة", "دمياط", "بورسعيد",
  "الإسماعيلية", "السويس", "شمال سيناء", "جنوب سيناء", "بني سويف",
  "الفيوم", "المنيا", "أسيوط", "سوهاج", "قنا", "الأقصر", "أسوان",
  "البحر الأحمر", "الوادي الجديد", "مطروح",
];

// ---------- قائمة التنقل ----------
// roles = الأدوار المسموح لها تشوف الشاشة
// feature = لو موجود، الشاشة تختفي لو الميزة مقفولة للشركة
export const NAV = [
  { id: "dashboard", label: "الرئيسية",              icon: "fa-home",          roles: ["superadmin","owner","manager","agent"] },
  { id: "companies", label: "إدارة الشركات",         icon: "fa-building",      roles: ["superadmin"], badge: "Admin" },
  { id: "inbox",     label: "صندوق الرسائل الموحد",  icon: "fa-inbox",         roles: ["superadmin","owner","manager","agent"] },
  { id: "publisher", label: "الناشر الذكي",           icon: "fa-paper-plane",   roles: ["superadmin","owner","manager"] },
  { id: "orders",    label: "الطلبات والمبيعات",      icon: "fa-shopping-bag",  roles: ["superadmin","owner","manager"], feature: "canUseOrders" },
  { id: "products",  label: "المخزون والأصناف",       icon: "fa-box-open",      roles: ["superadmin","owner","manager"] },
  { id: "ai",        label: "إعدادات الذكاء الاصطناعي", icon: "fa-robot",      roles: ["superadmin","owner","manager"], feature: "canUseAI" },
  { id: "analytics", label: "التحليلات والتقارير",    icon: "fa-chart-pie",     roles: ["superadmin","owner"] },
  { id: "users",     label: "المستخدمين والصلاحيات",  icon: "fa-users",         roles: ["superadmin","owner"] },
  { id: "settings",  label: "الثوابت وبيانات الشركة", icon: "fa-cog",           roles: ["superadmin","owner"] },
  { id: "help",      label: "مركز المساعدة",          icon: "fa-circle-question", roles: ["superadmin","owner","manager","agent"] },
  { id: "insights",  label: "إحصائيات الشركات",       icon: "fa-chart-line",    roles: ["superadmin"], badge: "Admin" },
  { id: "support",   label: "الدعم والاقتراحات",      icon: "fa-headset",       roles: ["superadmin"], badge: "Admin" },
];
