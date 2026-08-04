// ============================================================
//  تليجرام — إرسال رسائل ونشر بوستات
// ============================================================
const API = "https://api.telegram.org/bot";

async function call(token, method, payload) {
  const res = await fetch(`${API}${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || res.status}`);
  return data.result;
}

/**
 * زراير تحت البوست:
 *  - "تفاصيل المنتج" → بيفتح البوت ومعاه سياق البوست
 *  - "تواصل معانا"   → بيفتح البوت من غير سياق (استفسار عام)
 * mode: "two" (الافتراضي) | "one" | "none"
 */
function askButton(botUsername, postId, mode = "two") {
  if (!botUsername || mode === "none") return undefined;
  const details = {
    text: "💬 تفاصيل المنتج",
    url: `https://t.me/${botUsername}?start=post_${postId}`,
  };
  if (mode === "one") return { inline_keyboard: [[details]] };
  return {
    inline_keyboard: [[
      details,
      { text: "📞 تواصل معانا", url: `https://t.me/${botUsername}?start=contact` },
    ]],
  };
}

/**
 * اقتراحات أسئلة تحت مربع الكتابة.
 * لما العميل يدوس على واحدة، النص بيتبعت **باسمه** ويظهر في الشات رسالة
 * طبيعية — ده بديل تغيير كلمة /start (اللي البوت مش بيقدر يعملها).
 */
function suggestKeyboard(items) {
  const list = (items || []).filter(Boolean).slice(0, 6);
  if (!list.length) return undefined;
  const rows = [];
  for (let i = 0; i < list.length; i += 2) rows.push(list.slice(i, i + 2).map((t) => ({ text: t })));
  return { keyboard: rows, resize_keyboard: true, is_persistent: true, one_time_keyboard: false };
}

/** إخفاء لوحة الاقتراحات */
const hideKeyboard = { remove_keyboard: true };

exports.askButton = askButton;
exports.suggestKeyboard = suggestKeyboard;
exports.hideKeyboard = hideKeyboard;

exports.sendMessage = (token, chatId, text, replyMarkup) =>
  call(token, "sendMessage", {
    chat_id: chatId, text, parse_mode: "HTML",
    disable_web_page_preview: false,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });

exports.sendPhoto = (token, chatId, photoUrl, caption, replyMarkup) =>
  call(token, "sendPhoto", {
    chat_id: chatId, photo: photoUrl, caption, parse_mode: "HTML",
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });

exports.sendVideo = (token, chatId, videoUrl, caption, replyMarkup) =>
  call(token, "sendVideo", {
    chat_id: chatId, video: videoUrl, caption, parse_mode: "HTML",
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });

exports.setWebhook = (token, url, secretToken) =>
  call(token, "setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "channel_post", "callback_query"],
  });

exports.getMe = (token) => call(token, "getMe", {});

/** بيانات ملف مرفوع — منها بنبني لينك التحميل */
exports.getFile = (token, fileId) => call(token, "getFile", { file_id: fileId });

exports.deleteMessage = (token, chatId, messageId) =>
  call(token, "deleteMessage", { chat_id: chatId, message_id: messageId });

/** تعديل نص رسالة منشورة (للرسائل النصية) */
exports.editMessageText = (token, chatId, messageId, text, replyMarkup) =>
  call(token, "editMessageText", {
    chat_id: chatId, message_id: messageId, text, parse_mode: "HTML",
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });

/** تعديل الكابشن (للرسائل اللي فيها صورة أو فيديو) */
exports.editMessageCaption = (token, chatId, messageId, caption, replyMarkup) =>
  call(token, "editMessageCaption", {
    chat_id: chatId, message_id: messageId, caption, parse_mode: "HTML",
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });

/** عدد أعضاء القناة/الجروب — ده اللي بيدينا "المتابعين" */
exports.getChatMemberCount = (token, chatId) =>
  call(token, "getChatMemberCount", { chat_id: chatId });

/** بيانات القناة (الاسم، الوصف، الصورة) */
exports.getChat = (token, chatId) => call(token, "getChat", { chat_id: chatId });
