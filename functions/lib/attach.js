// ============================================================
//  إرفاق الثوابت والروابط الذكية في الردود
//  نفس منطق الناشر، بس للرسائل الخاصة
// ============================================================

const LABELS = {
  whatsapp: "واتساب",
  telegram: "تليجرام",
  telegramBot: "كلّمنا على تليجرام",
  instagram: "انستجرام",
  facebook: "فيسبوك",
};

/** توليد الروابط العميقة من ثوابت الشركة */
function buildLinks(k = {}) {
  const links = {};
  if (k.whatsappNumber) links.whatsapp = `https://wa.me/${String(k.whatsappNumber).replace(/\D/g, "")}`;
  if (k.telegramChannel) links.telegram = `https://t.me/${String(k.telegramChannel).replace(/^@/, "")}`;
  if (k.telegramBot) links.telegramBot = `https://t.me/${String(k.telegramBot).replace(/^@/, "")}`;
  if (k.instagramUser) links.instagram = `https://instagram.com/${String(k.instagramUser).replace(/^@/, "")}`;
  if (k.facebookPage) links.facebook = k.facebookPage;
  return links;
}

/**
 * بيضيف الثوابت المختارة لنص الرد.
 * @param {string} reply      رد الذكاء الاصطناعي
 * @param {object} company    بيانات الشركة
 * @param {string} platform   المنصة اللي الرد رايح عليها (للاستبعاد الذكي)
 */
function appendConstants(reply, company, platform) {
  const attach = company?.ai?.dmAttach || {};
  const k = company?.constants || {};
  const parts = [];

  if (attach.address && k.address) parts.push(`📍 ${k.address}`);
  if (attach.hours && k.workingHours) parts.push(`🕐 ${k.workingHours}`);
  if (attach.phones && k.phones) parts.push(`📞 ${k.phones}`);

  if (attach.links) {
    const links = buildLinks(k);
    delete links[platform];                 // الاستبعاد الذكي
    if (platform === "telegram") delete links.telegramBot;
    const linkLines = Object.entries(links).map(([p, u]) => `${LABELS[p] || p}: ${u}`);
    if (linkLines.length) parts.push(linkLines.join("\n"));
  }

  if (!parts.length) return reply;
  return `${reply}\n\n———\n${parts.join("\n")}`;
}

module.exports = { appendConstants, buildLinks };
