// ============================================================
//  تشفير توكنات المنصات قبل تخزينها في قاعدة البيانات
// ============================================================
const crypto = require("crypto");

/** بيحوّل أي مفتاح نصي لمفتاح 32 بايت ثابت */
function keyFrom(secret) {
  return crypto.createHash("sha256").update(String(secret)).digest();
}

exports.encrypt = function encrypt(plain, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
};

exports.decrypt = function decrypt(payload, secret) {
  const [ivB64, tagB64, dataB64] = String(payload).split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("BAD_CIPHERTEXT");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
};

/** التحقق من توقيع ميتا للويب هوك — بدونها أي حد يقدر يبعت أحداث مزيفة */
exports.verifyMetaSignature = function verifyMetaSignature(rawBody, headerValue, appSecret) {
  if (!headerValue || !appSecret || !rawBody) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
