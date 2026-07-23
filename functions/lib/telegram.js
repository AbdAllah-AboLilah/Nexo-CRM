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

exports.sendMessage = (token, chatId, text) =>
  call(token, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: false });

exports.sendPhoto = (token, chatId, photoUrl, caption) =>
  call(token, "sendPhoto", { chat_id: chatId, photo: photoUrl, caption, parse_mode: "HTML" });

exports.setWebhook = (token, url, secretToken) =>
  call(token, "setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "channel_post", "callback_query"],
  });

exports.getMe = (token) => call(token, "getMe", {});
