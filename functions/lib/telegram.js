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

/** زرار تحت البوست بيودّي البوت — أوضح وأجمل من لينك نص */
function askButton(botUsername, postId) {
  if (!botUsername) return undefined;
  return {
    inline_keyboard: [[{
      text: "💬 اسأل عن العرض ده",
      url: `https://t.me/${botUsername}?start=post_${postId}`,
    }]],
  };
}

exports.askButton = askButton;

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

exports.deleteMessage = (token, chatId, messageId) =>
  call(token, "deleteMessage", { chat_id: chatId, message_id: messageId });

/** عدد أعضاء القناة/الجروب — ده اللي بيدينا "المتابعين" */
exports.getChatMemberCount = (token, chatId) =>
  call(token, "getChatMemberCount", { chat_id: chatId });

/** بيانات القناة (الاسم، الوصف، الصورة) */
exports.getChat = (token, chatId) => call(token, "getChat", { chat_id: chatId });
