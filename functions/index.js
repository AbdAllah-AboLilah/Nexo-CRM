// ============================================================
//  Nexo CRM — الدوال السحابية
//  المفاتيح كلها في Firebase Secrets، مفيش أي مفتاح مكتوب في الكود
// ============================================================
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { setGlobalOptions, logger } = require("firebase-functions/v2");
const admin = require("firebase-admin");

const { encrypt, decrypt, verifyMetaSignature } = require("./lib/crypto");
const { generateReply, assistPost, helpAnswer, generateTemplates, ping, ASSIST_TASKS } = require("./lib/ai");
const { buildKnowledgeText } = require("./lib/kb");
const { notify, usersOf, usersAtLeast, superAdmins } = require("./lib/notify");
const telegram = require("./lib/telegram");
const { appendConstants } = require("./lib/attach");

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: "us-central1", maxInstances: 10 });

// ---------- المفاتيح السرية ----------
// تتضبط بالأمر:  firebase functions:secrets:set <NAME>
// ملحوظة: Gemini مش محتاج مفتاح — السيرفر بيتوثّق بهوية المشروع نفسه (ADC)
const TOKEN_ENC_KEY    = defineSecret("TOKEN_ENC_KEY");
const META_APP_SECRET  = defineSecret("META_APP_SECRET");
const META_VERIFY_TOKEN = defineSecret("META_VERIFY_TOKEN");

const ROLE_LEVEL = { superadmin: 100, owner: 80, manager: 60, agent: 40 };

// ============================================================
//  أدوات مساعدة
// ============================================================
async function requireProfile(auth) {
  if (!auth) throw new HttpsError("unauthenticated", "لازم تسجل دخول.");
  const snap = await db.doc(`users/${auth.uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "المستخدم مش مسجل في النظام.");
  const p = snap.data();
  if (p.active === false) throw new HttpsError("permission-denied", "الحساب موقوف.");
  return { uid: auth.uid, ...p };
}

function level(role) { return ROLE_LEVEL[role] || 0; }

function assertCompanyAccess(profile, companyId) {
  if (profile.role === "superadmin") return;
  if (!companyId || profile.companyId !== companyId)
    throw new HttpsError("permission-denied", "مش مسموح لك بالشركة دي.");
}

/**
 * حفظ الدور والشركة في توكن الدخول (Custom Claims).
 * قواعد الأمان بتقرا منها مباشرة بدل ما تستعلم من قاعدة البيانات —
 * أسرع وأضمن، خصوصاً في رفع الملفات.
 */
async function syncClaims(uid, { role, companyId }) {
  try {
    await admin.auth().setCustomUserClaims(uid, {
      role: role || null,
      companyId: companyId || null,
    });
  } catch (e) {
    logger.error(`setCustomUserClaims failed for ${uid}`, e);
    throw e;
  }
}

async function audit(companyId, action, actor, details = {}) {
  try {
    await db.collection(`companies/${companyId}/auditLog`).add({
      action, actorId: actor.uid, actorName: actor.name || "", details,
      at: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) { logger.warn("audit failed", e); }
}

// ============================================================
//  1) إدارة المستخدمين
// ============================================================
const ALLOWED_EXTRA = ["publisher", "products", "orders", "ai", "analytics"];

exports.createUser = onCall(async (req) => {
  const profile = await requireProfile(req.auth);
  const { name, email, password, role, companyId } = req.data || {};
  const extraScreens = (Array.isArray(req.data?.extraScreens) ? req.data.extraScreens : [])
    .filter((s) => ALLOWED_EXTRA.includes(s));

  if (level(profile.role) < level("owner"))
    throw new HttpsError("permission-denied", "مش مسموح لك تضيف مستخدمين.");
  assertCompanyAccess(profile, companyId);
  if (level(role) >= level(profile.role) && profile.role !== "superadmin")
    throw new HttpsError("permission-denied", "مينفعش تدّي صلاحية أعلى من أو تساوي صلاحيتك.");
  if (!name || !email || !password || password.length < 6)
    throw new HttpsError("invalid-argument", "بيانات ناقصة أو كلمة مرور أقل من 6 حروف.");

  // التحقق من حد الباقة
  const companySnap = await db.doc(`companies/${companyId}`).get();
  if (!companySnap.exists) throw new HttpsError("not-found", "الشركة مش موجودة.");
  const maxAgents = companySnap.data()?.features?.maxAgents || 0;
  if (maxAgents > 0) {
    const existing = await db.collection("users").where("companyId", "==", companyId).count().get();
    if (existing.data().count >= maxAgents)
      throw new HttpsError("resource-exhausted", "LIMIT: وصلت للحد الأقصى للمستخدمين في الباقة.");
  }

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({ email, password, displayName: name });
  } catch (e) {
    if (e.code === "auth/email-already-exists")
      throw new HttpsError("already-exists", "البريد ده مستخدم قبل كده.");
    throw new HttpsError("internal", e.message);
  }

  await db.doc(`users/${userRecord.uid}`).set({
    name, email, role, companyId, active: true,
    extraScreens: role === "agent" ? extraScreens : [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: profile.uid,
  });

  await syncClaims(userRecord.uid, { role, companyId });
  await audit(companyId, "user.create", profile, { email, role });
  return { uid: userRecord.uid };
});

exports.updateUser = onCall(async (req) => {
  const profile = await requireProfile(req.auth);
  const { uid, name, role, password, companyId } = req.data || {};
  if (level(profile.role) < level("owner"))
    throw new HttpsError("permission-denied", "مش مسموح لك.");

  const targetSnap = await db.doc(`users/${uid}`).get();
  if (!targetSnap.exists) throw new HttpsError("not-found", "المستخدم مش موجود.");
  const target = targetSnap.data();

  assertCompanyAccess(profile, target.companyId || companyId);
  if (profile.role !== "superadmin" && level(target.role) >= level(profile.role))
    throw new HttpsError("permission-denied", "مينفعش تعدّل حد صلاحيته أعلى منك أو زيّك.");

  const updates = {};
  if (name) updates.name = name;
  if (role) {
    if (profile.role !== "superadmin" && level(role) >= level(profile.role))
      throw new HttpsError("permission-denied", "صلاحية أعلى من المسموح.");
    updates.role = role;
  }
  if (Array.isArray(req.data?.extraScreens)) {
    const effectiveRole = role || target.role;
    updates.extraScreens = effectiveRole === "agent"
      ? req.data.extraScreens.filter((s) => ALLOWED_EXTRA.includes(s)) : [];
  }
  if (Object.keys(updates).length) await db.doc(`users/${uid}`).update(updates);
  if (password) {
    if (password.length < 6) throw new HttpsError("invalid-argument", "كلمة المرور قصيرة.");
    await admin.auth().updateUser(uid, { password });
  }

  // لو الدور اتغيّر، نحدّث التوكن كمان
  if (updates.role) await syncClaims(uid, { role: updates.role, companyId: target.companyId });

  await audit(target.companyId, "user.update", profile, { uid, ...updates });
  return { ok: true };
});

// ============================================================
//  2) ربط المنصات — التوكن بيتشفّر وبيتخزن في مكان العميل مايقراهوش
// ============================================================
exports.saveIntegration = onCall({ secrets: [TOKEN_ENC_KEY] }, async (req) => {
  const profile = await requireProfile(req.auth);
  const { companyId, platform, token, chatId } = req.data || {};

  if (level(profile.role) < level("owner"))
    throw new HttpsError("permission-denied", "مش مسموح لك تربط منصات.");
  assertCompanyAccess(profile, companyId);
  if (!token || !platform) throw new HttpsError("invalid-argument", "بيانات ناقصة.");

  if (platform === "telegram") {
    let me;
    try { me = await telegram.getMe(token); }
    catch { throw new HttpsError("invalid-argument", "التوكن غلط أو البوت متوقف."); }

    const secretToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
    if (!projectId) throw new HttpsError("internal", "مش عارف معرّف المشروع.");
    const url = `https://us-central1-${projectId}.cloudfunctions.net/telegramWebhook?c=${companyId}`;

    await db.doc(`companies/${companyId}/secrets/telegram`).set({
      token: encrypt(token, TOKEN_ENC_KEY.value()),
      chatId: chatId || "",
      webhookSecret: secretToken,
      botUsername: me.username || "",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    try { await telegram.setWebhook(token, url, secretToken); }
    catch (e) { logger.warn("setWebhook failed (هيتظبط يدوي)", e.message); }

    await db.doc(`companies/${companyId}`).set({
      integrations: { telegram: { connected: true, botUsername: me.username || "" } },
      // يوزر البوت بيدخل الروابط الذكية تلقائياً عشان العميل يعرف يكلّم مين
      constants: { telegramBot: me.username || "" },
    }, { merge: true });

    await audit(companyId, "integration.telegram.connect", profile, { bot: me.username });
    return { ok: true, bot: me.username };
  }

  throw new HttpsError("unimplemented", "المنصة دي لسه مش متاحة.");
});

// ============================================================
//  3) ويب هوك ميتا (فيسبوك / انستجرام)
//     ملاحظة: مش هيشتغل على صفحات العملاء غير بعد App Review
// ============================================================
exports.metaWebhook = onRequest(
  { secrets: [TOKEN_ENC_KEY, META_APP_SECRET, META_VERIFY_TOKEN] },
  async (req, res) => {
    // --- التحقق الأولي من ميتا ---
    if (req.method === "GET") {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];
      if (mode === "subscribe" && token === META_VERIFY_TOKEN.value()) {
        logger.info("Meta webhook verified");
        return res.status(200).send(String(challenge || ""));
      }
      return res.sendStatus(403);
    }

    if (req.method !== "POST") return res.sendStatus(405);

    // --- التحقق من التوقيع: بدونها أي حد يقدر يبعت أحداث مزيفة ---
    const sig = req.get("x-hub-signature-256");
    if (!verifyMetaSignature(req.rawBody, sig, META_APP_SECRET.value())) {
      logger.warn("Invalid Meta signature");
      return res.sendStatus(403);
    }

    // --- الرد فوراً على ميتا، والمعالجة بعدها ---
    res.status(200).send("EVENT_RECEIVED");

    try {
      const body = req.body || {};
      if (body.object !== "page" && body.object !== "instagram") return;

      for (const entry of body.entry || []) {
        const pageId = String(entry.id);
        const company = await findCompanyByPage(pageId);
        if (!company) { logger.warn("مفيش شركة مربوطة بالصفحة", pageId); continue; }

        // رسائل الماسنجر
        for (const ev of entry.messaging || []) {
          if (!ev.message?.text) continue;
          await handleIncoming({
            company,
            platform: body.object === "instagram" ? "instagram" : "facebook",
            externalId: ev.sender.id,
            customerName: "عميل",
            text: ev.message.text,
            channel: "message",
          });
        }

        // التعليقات (بتيجي في changes مش messaging)
        for (const ch of entry.changes || []) {
          const v = ch.value || {};
          if (ch.field !== "feed" || v.item !== "comment" || v.verb !== "add") continue;
          if (v.from?.id === pageId) continue; // تعليق الصفحة نفسها
          await handleIncoming({
            company,
            platform: "facebook",
            externalId: v.from?.id,
            customerName: v.from?.name || "عميل",
            text: v.message || "",
            channel: "comment",
            postId: v.post_id,
            commentId: v.comment_id,
          });
        }
      }
    } catch (err) {
      logger.error("metaWebhook error", err);
    }
  });

// ============================================================
//  4) ويب هوك تليجرام
// ============================================================
exports.telegramWebhook = onRequest(
  { secrets: [TOKEN_ENC_KEY] },
  async (req, res) => {
    if (req.method !== "POST") return res.sendStatus(405);

    const companyId = String(req.query.c || "");
    if (!companyId) return res.sendStatus(400);

    res.status(200).send("OK"); // تليجرام بيحب رد سريع

    try {
      const secretSnap = await db.doc(`companies/${companyId}/secrets/telegram`).get();
      if (!secretSnap.exists) return;
      const secretData = secretSnap.data();

      // التحقق من السر اللي بعتناه لتليجرام وقت الربط
      const headerSecret = req.get("x-telegram-bot-api-secret-token");
      if (secretData.webhookSecret && headerSecret !== secretData.webhookSecret) {
        logger.warn("Telegram secret mismatch");
        return;
      }

      const companySnap = await db.doc(`companies/${companyId}`).get();
      if (!companySnap.exists) return;

      // ---------- بوست نزل في القناة ----------
      // مهم: ده مش رسالة عميل — ده منشور. لازم نفصله عشان البوت ما يردّش عليه.
      const channelPost = req.body?.channel_post;
      if (channelPost) {
        await recordChannelPost(companyId, secretData, channelPost);
        return;
      }

      // ---------- رسالة من عميل ----------
      const msg = req.body?.message;
      if (!msg?.text) return;

      // الدخول من لينك بوست: /start post_<id> — العميل جاي من بوست معيّن
      let contextPostId = null;
      let text = msg.text;
      const startMatch = /^\/start\s+post_(\S+)/.exec(msg.text.trim());
      if (startMatch) {
        contextPostId = startMatch[1];
        // نستبدل أمر /start برسالة طبيعية عشان الـ AI يرحّب ويربطها بالبوست
        text = "السلام عليكم، ممكن تفاصيل عن العرض ده؟";
      } else if (msg.text.trim() === "/start") {
        text = "السلام عليكم";
      }

      // أوامر /start بتظهر في شات العميل وشكلها وحش — نمسحها بعد ما نقراها
      if (startMatch || msg.text.trim() === "/start") {
        try {
          const token = decrypt(secretData.token, TOKEN_ENC_KEY.value());
          await telegram.deleteMessage(token, msg.chat.id, msg.message_id);
        } catch { /* البوت ممكن مايكونش له صلاحية المسح — مش مشكلة */ }
      }

      await handleIncoming({
        company: { id: companyId, ...companySnap.data() },
        platform: "telegram",
        externalId: String(msg.chat.id),
        customerName: [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || "عميل",
        text,
        channel: "message",
        contextPostId,
      });
    } catch (err) {
      logger.error("telegramWebhook error", err);
    }
  });

// ============================================================
//  المعالجة الموحّدة لأي رسالة واردة من أي منصة
// ============================================================
async function handleIncoming({ company, platform, externalId, customerName, text, channel, postId, commentId, contextPostId }) {
  const companyId = company.id;
  const convId = `${platform}_${externalId}`;
  const convRef = db.doc(`companies/${companyId}/conversations/${convId}`);
  const convSnap = await convRef.get();
  const conv = convSnap.exists ? convSnap.data() : null;

  // البوست اللي العميل جاي منه (من deep-link أو من تعليق)، أو آخر بوست اتربط بالمحادثة
  const activePostId = contextPostId || postId || conv?.contextPostId || null;

  // تسجيل رسالة العميل
  await convRef.set({
    platform, externalId, customerName,
    lastMessage: text.slice(0, 120),
    lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
    messageCount: admin.firestore.FieldValue.increment(1),
    status: conv?.status === "in_progress" ? "in_progress" : (conv?.status || "new"),
    awaitingSince: conv?.awaitingSince || admin.firestore.FieldValue.serverTimestamp(),
    aiEnabled: conv?.aiEnabled !== false,
    contextPostId: activePostId,
    createdAt: conv?.createdAt || admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  await convRef.collection("messages").add({
    from: "customer", text,
    channel, postId: postId || null, commentId: commentId || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // الرد الآلي متوقف؟
  const aiOn = company.features?.canUseAI !== false && company.ai?.enabled !== false && conv?.aiEnabled !== false;
  if (!aiOn) {
    await convRef.set({ status: "needs_human" }, { merge: true });
    return;
  }

  // تجهيز البيانات للـ AI
  const [productsSnap, historySnap] = await Promise.all([
    db.collection(`companies/${companyId}/products`).limit(150).get(),
    convRef.collection("messages").orderBy("createdAt", "desc").limit(5).get(),
  ]);
  const products = productsSnap.docs.map((d) => d.data());
  const history = historySnap.docs.map((d) => d.data()).reverse();

  // سياق البوست: لو العميل جاي من بوست معيّن، نجيب منتجه وسعره
  let postContext = null;
  if (activePostId) {
    try {
      const postSnap = await db.doc(`companies/${companyId}/posts/${activePostId}`).get();
      if (postSnap.exists) {
        const pd = postSnap.data();
        if (pd.price || pd.productName) {
          postContext = `العميل ده بيسأل عن بوست معيّن: "${(pd.caption || "").slice(0, 100)}"`
            + (pd.productName ? ` — المنتج: ${pd.productName}` : "")
            + (pd.price ? ` — سعره: ${pd.price} جنيه.` : ".");
        }
      }
    } catch (e) { logger.warn("post context failed", e.message); }
  }

  let result;
  try {
    result = await generateReply({
      company, products, userMessage: text, history, channel, postContext,
    });
  } catch (e) {
    logger.error("AI failed", e);
    await convRef.set({ status: "needs_human" }, { merge: true });
    return;
  }

  // تعليق مسيء → إخفاء + تسجيل، من غير رد
  if (result.isAbusive && company.features?.canUseModeration) {
    await db.collection(`companies/${companyId}/moderationLog`).add({
      platform, customerName, externalId, text, commentId: commentId || null,
      action: "flagged", at: admin.firestore.FieldValue.serverTimestamp(),
    });
    await convRef.set({ status: "needs_human", isAbusive: true }, { merge: true });
    return;
  }

  // الرسائل الخاصة بيترفق معاها الثوابت المختارة؛ التعليقات العامة بتفضل مختصرة
  const finalReply = channel === "message"
    ? appendConstants(result.reply, company, platform)
    : result.reply;

  // ⚡ الإرسال المباشر: بدل ما نستنى تريجر تاني يقرا من قاعدة البيانات ويبعت
  // (وده كان بيضيف وقت استيقاظ كامل)، بنبعت من هنا على طول.
  let delivered = false;
  if (channel === "message" && platform === "telegram") {
    try {
      const s = await db.doc(`companies/${companyId}/secrets/telegram`).get();
      if (s.exists) {
        const token = decrypt(s.data().token, TOKEN_ENC_KEY.value());
        await telegram.sendMessage(token, externalId, finalReply);
        delivered = true;
      }
    } catch (e) { logger.warn("direct send failed, falling back to trigger", e.message); }
  }

  await convRef.collection("messages").add({
    from: "ai", text: finalReply, intent: result.intent,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    // لو اتبعت خلاص، التريجر هيتخطاها؛ لو لأ هياخدها
    deliveryStatus: delivered ? "sent" : "pending",
    sentAt: delivered ? admin.firestore.FieldValue.serverTimestamp() : null,
  });

  await convRef.set({
    status: result.needsHuman ? "needs_human" : "ai_handled",
    isComplaint: result.isComplaint === true,
    lastIntent: result.intent,
    lastMessage: result.reply.slice(0, 120),
    lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

// ============================================================
//  5) إرسال أي رسالة (AI أو موظف) للمنصة بتاعتها
// ============================================================
exports.dispatchOutbound = onDocumentCreated(
  { document: "companies/{companyId}/conversations/{convId}/messages/{msgId}", secrets: [TOKEN_ENC_KEY] },
  async (event) => {
    const msg = event.data?.data();
    if (!msg || msg.from === "customer" || msg.from === "note") return;
    if (msg.deliveryStatus === "sent") return;

    const { companyId, convId } = event.params;
    const msgRef = event.data.ref;

    try {
      const convRef = db.doc(`companies/${companyId}/conversations/${convId}`);
      const convSnap = await convRef.get();
      if (!convSnap.exists) return;
      const conv = convSnap.data();

      // قياس وقت الرد: الفرق بين وصول رسالة العميل وأول رد عليها
      if (conv.awaitingSince) {
        const waitedMs = Date.now() - conv.awaitingSince.toMillis();
        if (waitedMs >= 0 && waitedMs < 7 * 24 * 3600 * 1000) {
          await convRef.update({
            awaitingSince: admin.firestore.FieldValue.delete(),
            lastResponseMs: waitedMs,
            totalResponseMs: admin.firestore.FieldValue.increment(waitedMs),
            responseCount: admin.firestore.FieldValue.increment(1),
            [msg.from === "agent" ? "humanReplies" : "aiReplies"]:
              admin.firestore.FieldValue.increment(1),
          });
        }
      }

      if (conv.platform === "telegram") {
        const secretSnap = await db.doc(`companies/${companyId}/secrets/telegram`).get();
        if (!secretSnap.exists) throw new Error("مفيش توكن تليجرام مربوط");
        const token = decrypt(secretSnap.data().token, TOKEN_ENC_KEY.value());
        await telegram.sendMessage(token, conv.externalId, msg.text);
      } else {
        // فيسبوك/انستجرام/واتساب — هيتفعّلوا بعد اعتماد ميتا
        await msgRef.update({ deliveryStatus: "skipped", deliveryNote: "المنصة لسه مش مربوطة" });
        return;
      }

      await msgRef.update({ deliveryStatus: "sent", sentAt: admin.firestore.FieldValue.serverTimestamp() });
    } catch (e) {
      logger.error("dispatchOutbound failed", e);
      await msgRef.update({ deliveryStatus: "failed", deliveryError: String(e.message).slice(0, 200) });
    }
  });
// ============================================================
//  6) الناشر — نشر فوري بمجرد الحفظ، والمجدول بيتفحص كل دقيقة
// ============================================================

/** نشر بوست واحد على كل منصاته. بيرجّع true لو نزل على منصة واحدة على الأقل. */
async function publishOnePost(companyId, postRef, post) {
  const results = {};
  const messageIds = {};   // معرّف الرسالة على كل منصة (لتقرير البوست)
  const audience = {};     // عدد أعضاء القناة وقت النشر

  for (const platform of post.platforms || []) {
    try {
      let text = post.versions?.[platform] || post.caption;

      if (platform === "telegram") {
        const s = await db.doc(`companies/${companyId}/secrets/telegram`).get();
        if (!s.exists) throw new Error("مفيش توكن تليجرام");
        const token = decrypt(s.data().token, TOKEN_ENC_KEY.value());
        const chatId = s.data().chatId;
        if (!chatId) throw new Error("مفيش معرّف قناة");

        // زرار "اسأل عن العرض ده" تحت البوست — بيودّي البوت ومعاه معرّف البوست
        // فلما العميل يكلّم البوت، بيعرف إنه بيسأل عن البوست ده تحديداً
        const askBtn = telegram.askButton(s.data().botUsername, postRef.id);

        const media = Array.isArray(post.media) ? post.media : [];
        const photos = media.filter((m) => m.type === "image" && m.url);
        const videos = media.filter((m) => m.type === "video" && m.url);

        if (photos.length || videos.length) {
          // تليجرام بيحط الكابشن على أول ملف بس (الحد 1024 حرف)
          const caption = text.length > 1024 ? text.slice(0, 1021) + "..." : text;
          const first = photos[0] || videos[0];
          // الزرار بيتحط على آخر رسالة عشان يبان تحت البوست كله
          const single = media.length === 1 && text.length <= 1024;
          const sent = first.type === "image"
            ? await telegram.sendPhoto(token, chatId, first.url, caption, single ? askBtn : undefined)
            : await telegram.sendVideo(token, chatId, first.url, caption, single ? askBtn : undefined);
          messageIds.telegram = sent?.message_id || null;

          const rest = media.filter((x) => x !== first && x.url);
          for (let i = 0; i < rest.length; i++) {
            const m = rest[i];
            const isLast = i === rest.length - 1 && text.length <= 1024;
            if (m.type === "image") await telegram.sendPhoto(token, chatId, m.url, "", isLast ? askBtn : undefined);
            else await telegram.sendVideo(token, chatId, m.url, "", isLast ? askBtn : undefined);
          }
          if (text.length > 1024) await telegram.sendMessage(token, chatId, text, askBtn);
        } else {
          const sent = await telegram.sendMessage(token, chatId, text, askBtn);
          messageIds.telegram = sent?.message_id || null;
        }

        try { audience.telegram = await telegram.getChatMemberCount(token, chatId); }
        catch { /* مش مشكلة لو فشل */ }

        results[platform] = "sent";
      } else {
        results[platform] = "skipped"; // لسه مش مربوط
      }
    } catch (e) {
      results[platform] = "failed: " + String(e.message).slice(0, 120);
      logger.error(`publish ${platform} failed`, e);
    }
  }

  const anySent = Object.values(results).includes("sent");
  await postRef.update({
    status: anySent ? "published" : "failed",
    results, messageIds, audience,
    publishedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const preview = String(post.caption || "").slice(0, 70);
  const failed = Object.entries(results).filter(([, v]) => String(v).startsWith("failed"));
  await notify(await usersAtLeast(companyId, "manager"), anySent
    ? {
        type: "post_published",
        title: "البوست نزل بنجاح ✅",
        body: failed.length ? `${preview} — بس فشل على: ${failed.map(([p]) => p).join("، ")}` : preview,
      }
    : {
        type: "post_failed",
        title: "فشل نشر بوست ❌",
        body: `${preview} — ${failed[0]?.[1] || "سبب غير معروف"}`,
      });

  return anySent;
}

/** النشر الفوري: بمجرد ما البوست يتحفظ بدون موعد، ينزل على طول */
exports.onPostQueued = onDocumentCreated(
  { document: "companies/{companyId}/posts/{postId}", secrets: [TOKEN_ENC_KEY] },
  async (event) => {
    const post = event.data?.data();
    if (!post || post.status !== "queued") return;
    if (post.scheduledAt) return;   // ده مجدول، الدالة المجدولة هتاخده

    try {
      await publishOnePost(event.params.companyId, event.data.ref, post);
    } catch (e) {
      logger.error("instant publish failed", e);
      await event.data.ref.update({
        status: "failed",
        results: { _error: String(e.message).slice(0, 200) },
      });
    }
  });

/** المجدول: بيمشي كل دقيقة عشان البوست ينزل في معاده بالظبط */
exports.runScheduledPosts = onSchedule(
  { schedule: "every 1 minutes", timeZone: "Africa/Cairo", secrets: [TOKEN_ENC_KEY] },
  async () => {
    const now = admin.firestore.Timestamp.now();
    // ملحوظة: != في فايرستور بيستبعد المستندات اللي الحقل ناقص فيها، فبنفلتر محلياً
    const companies = await db.collection("companies").get();

    for (const companyDoc of companies.docs) {
      if (companyDoc.data().active === false) continue;
      const companyId = companyDoc.id;
      const due = await db.collection(`companies/${companyId}/posts`)
        .where("status", "==", "queued").limit(20).get();

      for (const postDoc of due.docs) {
        const post = postDoc.data();
        if (post.scheduledAt && post.scheduledAt.toMillis() > now.toMillis()) continue;
        try {
          await publishOnePost(companyId, postDoc.ref, post);
        } catch (e) { logger.error("scheduled publish failed", e); }
      }
    }
  });

// ============================================================
//  7) تجميع إحصائيات آخر اليوم (أساس التقارير)
// ============================================================
exports.dailyRollup = onSchedule(
  { schedule: "55 23 * * *", timeZone: "Africa/Cairo", secrets: [TOKEN_ENC_KEY] },
  async () => {
    const today = new Date();
    const dayId = today.toISOString().slice(0, 10);
    const from = new Date(today); from.setHours(0, 0, 0, 0);

    const companies = await db.collection("companies").get();
    for (const c of companies.docs) {
      const companyId = c.id;
      try {
        await rollupCompany(companyId, dayId, from);
      } catch (e) {
        logger.error(`rollup failed for ${companyId}`, e);
      }
    }
    logger.info("dailyRollup done", dayId);
  });

/** تجميع إحصائيات شركة واحدة ليوم واحد */
async function rollupCompany(companyId, dayId, from) {
  const [convs, orders, posts] = await Promise.all([
    db.collection(`companies/${companyId}/conversations`).where("lastMessageAt", ">=", from).get(),
    db.collection(`companies/${companyId}/orders`).where("createdAt", ">=", from).get(),
    db.collection(`companies/${companyId}/posts`).where("createdAt", ">=", from).get(),
  ]);

  const list = convs.docs.map((d) => d.data());

  // متوسط وقت الرد بالدقايق
  const withResponses = list.filter((x) => x.responseCount > 0);
  const totalMs = withResponses.reduce((s, x) => s + (x.totalResponseMs || 0), 0);
  const totalCount = withResponses.reduce((s, x) => s + (x.responseCount || 0), 0);
  const avgResponseMin = totalCount ? Math.round(totalMs / totalCount / 60000) : 0;

  // مؤشر الرضا: نسبة المحادثات اللي مافيهاش شكوى ومقفولة
  const resolved = list.filter((x) => x.status === "resolved" || x.status === "ai_handled").length;
  const complaints = list.filter((x) => x.isComplaint).length;
  const satisfaction = list.length
    ? Math.round(((list.length - complaints) / list.length) * 100) : 100;

  // العملاء الفريدين + التوزيع حسب المنصة
  const byPlatform = {};
  list.forEach((x) => { byPlatform[x.platform] = (byPlatform[x.platform] || 0) + 1; });

  // المتابعين لكل منصة
  const followers = await collectFollowers(companyId);

  await db.doc(`companies/${companyId}/stats/${dayId}`).set({
    date: dayId,
    conversations: list.length,
    customers: new Set(list.map((x) => x.externalId).filter(Boolean)).size,
    aiHandled: list.filter((x) => x.status === "ai_handled").length,
    needsHuman: list.filter((x) => x.status === "needs_human").length,
    resolved,
    complaints,
    satisfaction,
    avgResponseMin,
    aiReplies: list.reduce((s, x) => s + (x.aiReplies || 0), 0),
    humanReplies: list.reduce((s, x) => s + (x.humanReplies || 0), 0),
    orders: orders.size,
    revenue: orders.docs.reduce((s, o) => s + (Number(o.data().total) || 0), 0),
    posts: posts.size,
    byPlatform,
    followers,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

/** عدد المتابعين لكل منصة مربوطة */
async function collectFollowers(companyId) {
  const followers = {};

  // تليجرام — عدد أعضاء القناة
  try {
    const s = await db.doc(`companies/${companyId}/secrets/telegram`).get();
    if (s.exists && s.data().chatId) {
      const token = decrypt(s.data().token, TOKEN_ENC_KEY.value());
      followers.telegram = await telegram.getChatMemberCount(token, s.data().chatId);
    }
  } catch (e) { logger.warn(`telegram followers ${companyId}: ${e.message}`); }

  // فيسبوك/انستجرام — هيتضافوا أول ما ميتا توافق على التطبيق
  return followers;
}

// ============================================================
//  8) تحديث عدد المتابعين كل 6 ساعات (عشان الرسم البياني يبقى ناعم)
// ============================================================
exports.refreshFollowers = onSchedule(
  { schedule: "0 */6 * * *", timeZone: "Africa/Cairo", secrets: [TOKEN_ENC_KEY] },
  async () => {
    const dayId = new Date().toISOString().slice(0, 10);
    const companies = await db.collection("companies").get();

    for (const c of companies.docs) {
      if (c.data().active === false) continue;
      try {
        const followers = await collectFollowers(c.id);
        if (Object.keys(followers).length) {
          await db.doc(`companies/${c.id}/stats/${dayId}`).set(
            { date: dayId, followers }, { merge: true });
        }
      } catch (e) { logger.warn(`followers ${c.id}: ${e.message}`); }
    }
  });

// ============================================================
//  9) تشغيل التجميع يدوياً (زرار "تحديث" في شاشة الإحصائيات)
// ============================================================
exports.runRollupNow = onCall({ secrets: [TOKEN_ENC_KEY] }, async (req) => {
  const profile = await requireProfile(req.auth);
  if (level(profile.role) < level("owner"))
    throw new HttpsError("permission-denied", "مش مسموح لك.");

  const { companyId } = req.data || {};
  const cid = companyId || profile.companyId;
  assertCompanyAccess(profile, cid);

  const today = new Date();
  const dayId = today.toISOString().slice(0, 10);
  const from = new Date(today); from.setHours(0, 0, 0, 0);

  try {
    await rollupCompany(cid, dayId, from);
    return { ok: true, date: dayId };
  } catch (e) {
    logger.error("runRollupNow failed", e);
    throw new HttpsError("internal", "تعذّر تحديث الإحصائيات: " + String(e.message).slice(0, 150));
  }
});

// ============================================================
//  مسح البوست من المنصة لما يتمسح من النظام
// ============================================================
exports.onPostDeleted = onDocumentDeleted(
  { document: "companies/{companyId}/posts/{postId}", secrets: [TOKEN_ENC_KEY] },
  async (event) => {
    const post = event.data?.data();
    if (!post?.messageIds) return;   // مسودة أو مانزلش، مفيش حاجة تتمسح

    const { companyId } = event.params;

    if (post.messageIds.telegram) {
      try {
        const s = await db.doc(`companies/${companyId}/secrets/telegram`).get();
        if (s.exists && s.data().chatId) {
          const token = decrypt(s.data().token, TOKEN_ENC_KEY.value());
          await telegram.deleteMessage(token, s.data().chatId, post.messageIds.telegram);
          logger.info(`تم مسح بوست تليجرام ${post.messageIds.telegram}`);
        }
      } catch (e) {
        // تليجرام بيمنع مسح رسالة أقدم من 48 ساعة
        logger.warn(`تعذّر مسح بوست تليجرام: ${e.message}`);
      }
    }
    // فيسبوك/انستجرام هيتضافوا بعد اعتماد ميتا
  });

/**
 * تسجيل بوست نزل في القناة (سواء من النظام أو يدوي من تليجرام).
 * ده بيخلي أي منشور في القناة يبقى ليه صفحة في النظام تقدر تحطله سعر.
 */
async function recordChannelPost(companyId, secretData, channelPost) {
  const chatId = String(channelPost.chat?.id || "");
  if (!chatId || String(secretData.chatId || "").replace(/^@/, "") !== String(channelPost.chat?.username || "")
      && String(secretData.chatId) !== chatId) {
    return;   // مش قناة الشركة دي
  }

  const messageId = channelPost.message_id;
  const caption = channelPost.text || channelPost.caption || "";
  if (!messageId) return;

  // لو البوست ده اتنشر من النظام أصلاً، مانعملوش نسخة تانية
  const existing = await db.collection(`companies/${companyId}/posts`)
    .where("messageIds.telegram", "==", messageId).limit(1).get();
  if (!existing.empty) return;

  const media = [];
  if (channelPost.photo?.length) media.push({ type: "image", fromTelegram: true });
  if (channelPost.video) media.push({ type: "video", fromTelegram: true });

  await db.collection(`companies/${companyId}/posts`).add({
    caption,
    productName: "",
    price: 0,
    platforms: ["telegram"],
    versions: { telegram: caption },
    media,
    messageIds: { telegram: messageId },
    audience: {},
    results: { telegram: "sent" },
    status: "published",
    source: "telegram",          // اتنشر من تليجرام مش من النظام
    scheduledAt: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    publishedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdByName: "تليجرام",
  });

  logger.info(`اتسجّل بوست من القناة: ${messageId}`);
}

// ============================================================
//  أدوات داخلية
// ============================================================
async function findCompanyByPage(pageId) {
  const snap = await db.collection("companies").where("pageIds", "array-contains", pageId).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ============================================================
//  اختبار الاتصال بالذكاء الاصطناعي (زرار في شاشة إعدادات AI)
// ============================================================
exports.aiHealthCheck = onCall(async (req) => {
  const profile = await requireProfile(req.auth);
  if (level(profile.role) < level("manager"))
    throw new HttpsError("permission-denied", "مش مسموح لك.");
  try {
    const reply = await ping();
    return { ok: true, reply };
  } catch (e) {
    return { ok: false, error: String(e.message).slice(0, 300) };
  }
});

// ============================================================
//  مساعد كتابة البوستات بالذكاء الاصطناعي
// ============================================================
exports.aiAssistPost = onCall(async (req) => {
  const profile = await requireProfile(req.auth);
  const { text, task, companyId } = req.data || {};

  if (level(profile.role) < level("manager"))
    throw new HttpsError("permission-denied", "مش مسموح لك.");
  assertCompanyAccess(profile, companyId);

  if (!text || !String(text).trim())
    throw new HttpsError("invalid-argument", "اكتب نص البوست الأول.");
  if (String(text).length > 5000)
    throw new HttpsError("invalid-argument", "النص طويل جداً.");
  if (!ASSIST_TASKS[task])
    throw new HttpsError("invalid-argument", "نوع المساعدة غير معروف.");

  const companySnap = await db.doc(`companies/${companyId}`).get();
  if (!companySnap.exists) throw new HttpsError("not-found", "الشركة مش موجودة.");
  const company = companySnap.data();

  if (company.features?.canUseAI === false)
    throw new HttpsError("permission-denied", "ميزة الذكاء الاصطناعي مقفولة للشركة دي.");

  try {
    const result = await assistPost({ text: String(text), task, company });
    if (!result) throw new Error("رد فاضي");
    return { ok: true, text: result };
  } catch (e) {
    logger.error("aiAssistPost failed", e);
    throw new HttpsError("internal", "تعذّر توليد النص: " + String(e.message).slice(0, 200));
  }
});

// ============================================================
//  مركز المساعدة — المساعد الذكي
// ============================================================
exports.helpAssistant = onCall(async (req) => {
  const profile = await requireProfile(req.auth);
  const { question, companyId } = req.data || {};

  if (!question || !String(question).trim())
    throw new HttpsError("invalid-argument", "اكتب سؤالك.");
  if (String(question).length > 1000)
    throw new HttpsError("invalid-argument", "السؤال طويل جداً.");

  const cid = companyId || profile.companyId;
  assertCompanyAccess(profile, cid);

  const companySnap = await db.doc(`companies/${cid}`).get();
  if (!companySnap.exists) throw new HttpsError("not-found", "الشركة مش موجودة.");
  const company = companySnap.data();

  const ROLE_LABEL = {
    superadmin: "منشئ النظام", owner: "صاحب المكان",
    manager: "مدير سوشيال ميديا", agent: "موظف خدمة عملاء",
  };

  try {
    const result = await helpAnswer({
      question: String(question),
      knowledge: buildKnowledgeText(company.features || {}),
      companyName: company.name,
      roleLabel: ROLE_LABEL[profile.role],
    });

    // نسجّل السؤال عشان نعرف الناس بتسأل في إيه
    await db.collection(`companies/${cid}/helpLog`).add({
      question: String(question).slice(0, 500),
      resolved: result.resolved,
      userId: profile.uid,
      userName: profile.name || "",
      at: admin.firestore.FieldValue.serverTimestamp(),
    });

    return result;
  } catch (e) {
    logger.error("helpAssistant failed", e);
    throw new HttpsError("internal", "تعذّر الرد دلوقتي. جرّب تاني أو حوّل للدعم.");
  }
});

// ============================================================
//  الاقتراحات
// ============================================================
exports.submitSuggestion = onCall(async (req) => {
  const profile = await requireProfile(req.auth);
  const { text, companyId, source } = req.data || {};

  if (!text || String(text).trim().length < 5)
    throw new HttpsError("invalid-argument", "اكتب تفاصيل الاقتراح.");
  if (String(text).length > 2000)
    throw new HttpsError("invalid-argument", "النص طويل جداً.");

  const cid = companyId || profile.companyId;
  assertCompanyAccess(profile, cid);

  const companySnap = await db.doc(`companies/${cid}`).get();
  const companyName = companySnap.exists ? companySnap.data().name : "";

  // منع التكرار: نفس المستخدم مايبعتش أكتر من 5 اقتراحات في الساعة
  const hourAgo = new Date(Date.now() - 3600 * 1000);
  const recent = await db.collection("suggestions")
    .where("userId", "==", profile.uid)
    .where("createdAt", ">=", hourAgo).count().get();
  if (recent.data().count >= 5)
    throw new HttpsError("resource-exhausted", "بعتت اقتراحات كتير في وقت قصير. استنى شوية.");

  const ref = await db.collection("suggestions").add({
    text: String(text).trim(),
    companyId: cid,
    companyName,
    userId: profile.uid,
    userName: profile.name || "",
    userRole: profile.role,
    source: source === "assistant" ? "assistant" : "manual",
    status: "new",
    adminNote: "",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await notify(await superAdmins(), {
    type: "suggestion_new",
    title: "اقتراح جديد من شركة",
    body: `${companyName}: ${String(text).trim().slice(0, 90)}`,
    meta: { suggestionId: ref.id, companyId: cid },
  });

  return { ok: true, id: ref.id };
});

exports.updateSuggestion = onCall(async (req) => {
  const profile = await requireProfile(req.auth);
  if (profile.role !== "superadmin")
    throw new HttpsError("permission-denied", "لمنشئ النظام فقط.");

  const { id, status, adminNote } = req.data || {};
  const allowed = ["new", "reviewing", "done", "rejected"];
  if (!id || !allowed.includes(status))
    throw new HttpsError("invalid-argument", "بيانات ناقصة.");

  const snap = await db.doc(`suggestions/${id}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "الاقتراح مش موجود.");
  const sugg = snap.data();

  await snap.ref.update({
    status,
    adminNote: String(adminNote || "").slice(0, 500),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // نبلّغ صاحب الاقتراح لما حالته تتغير
  if (sugg.status !== status) {
    const LABEL = { reviewing: "قيد الدراسة", done: "تم التنفيذ ✅", rejected: "مش هيتنفذ حالياً" };
    if (LABEL[status]) {
      await notify([sugg.userId], {
        type: "support_reply",
        title: "تحديث على اقتراحك",
        body: `${LABEL[status]} — ${String(sugg.text).slice(0, 70)}`,
        link: "#/help",
      });
    }
  }

  return { ok: true };
});

// ============================================================
//  شات الدعم (الشركة ↔ إدارة النظام)
// ============================================================
exports.sendSupportMessage = onCall(async (req) => {
  const profile = await requireProfile(req.auth);
  const { text, companyId } = req.data || {};

  if (!text || !String(text).trim())
    throw new HttpsError("invalid-argument", "اكتب رسالتك.");
  if (String(text).length > 2000)
    throw new HttpsError("invalid-argument", "الرسالة طويلة جداً.");

  const isAdmin = profile.role === "superadmin";
  const cid = isAdmin ? companyId : profile.companyId;
  if (!cid) throw new HttpsError("invalid-argument", "مفيش شركة محددة.");
  if (!isAdmin) assertCompanyAccess(profile, cid);

  const companySnap = await db.doc(`companies/${cid}`).get();
  if (!companySnap.exists) throw new HttpsError("not-found", "الشركة مش موجودة.");
  const companyName = companySnap.data().name;

  const threadRef = db.doc(`supportThreads/${cid}`);
  const body = String(text).trim();

  await threadRef.set({
    companyId: cid,
    companyName,
    status: "open",
    lastMessage: body.slice(0, 120),
    lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
    lastFrom: isAdmin ? "admin" : "company",
    unreadForAdmin: isAdmin ? 0 : admin.firestore.FieldValue.increment(1),
    unreadForCompany: isAdmin ? admin.firestore.FieldValue.increment(1) : 0,
  }, { merge: true });

  await threadRef.collection("messages").add({
    from: isAdmin ? "admin" : "company",
    text: body,
    userId: profile.uid,
    userName: profile.name || "",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  if (isAdmin) {
    await notify(await usersAtLeast(cid, "owner"), {
      type: "support_reply",
      title: "رد من دعم النظام",
      body: body.slice(0, 90),
      link: "#/help",
    });
  } else {
    await notify(await superAdmins(), {
      type: "support_message",
      title: `رسالة دعم من ${companyName}`,
      body: body.slice(0, 90),
      meta: { companyId: cid },
    });
  }

  return { ok: true };
});

/** تصفير عداد غير المقروء */
exports.markSupportRead = onCall(async (req) => {
  const profile = await requireProfile(req.auth);
  const { companyId } = req.data || {};
  const isAdmin = profile.role === "superadmin";
  const cid = isAdmin ? companyId : profile.companyId;
  if (!cid) return { ok: true };
  if (!isAdmin) assertCompanyAccess(profile, cid);

  await db.doc(`supportThreads/${cid}`).set(
    isAdmin ? { unreadForAdmin: 0 } : { unreadForCompany: 0 }, { merge: true });
  return { ok: true };
});

// ============================================================
//  المشغّلات التلقائية للإشعارات
// ============================================================

/** طلب جديد → صاحب المكان ومدير السوشيال */
exports.onOrderCreated = onDocumentCreated("companies/{companyId}/orders/{orderId}", async (event) => {
  const order = event.data?.data();
  if (!order) return;
  const { companyId } = event.params;

  await notify(await usersAtLeast(companyId, "manager"), {
    type: "order_new",
    title: "طلب جديد 🛍️",
    body: `${order.customerName || "عميل"}${order.total ? ` — ${order.total} جنيه` : ""}`,
    meta: { orderId: event.params.orderId },
  });
});

/** محادثة اتحوّلت لتحتاج رد بشري، أو اتسجلت كشكوى */
exports.onConversationFlagged = onDocumentUpdated(
  "companies/{companyId}/conversations/{convId}",
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const { companyId } = event.params;

    // شكوى جديدة
    if (!before.isComplaint && after.isComplaint) {
      await notify(await usersAtLeast(companyId, "agent"), {
        type: "complaint_new",
        title: "شكوى جديدة ⚠️",
        body: `${after.customerName || "عميل"}: ${String(after.lastMessage || "").slice(0, 80)}`,
      });
      return;
    }

    // محتاجة تدخل بشري
    if (before.status !== "needs_human" && after.status === "needs_human") {
      await notify(await usersAtLeast(companyId, "agent"), {
        type: "chat_assigned",
        title: "محادثة محتاجة رد",
        body: `${after.customerName || "عميل"}: ${String(after.lastMessage || "").slice(0, 80)}`,
      });
    }
  });

/** تعليق مسيء اتخفى */
exports.onModerationLogged = onDocumentCreated(
  "companies/{companyId}/moderationLog/{logId}",
  async (event) => {
    const entry = event.data?.data();
    if (!entry) return;
    await notify(await usersAtLeast(event.params.companyId, "manager"), {
      type: "comment_hidden",
      title: "تعليق غير لائق اتخفى تلقائياً 🛡️",
      body: `${entry.customerName || "مستخدم"}: ${String(entry.text || "").slice(0, 70)}`,
    });
  });

/** ربط أو فك ربط منصة → إشعار لمنشئ النظام */
exports.onIntegrationChanged = onDocumentUpdated("companies/{companyId}", async (event) => {
  const before = event.data?.before?.data() || {};
  const after = event.data?.after?.data() || {};
  const b = JSON.stringify(before.integrations || {});
  const a = JSON.stringify(after.integrations || {});
  if (b === a) return;

  await notify(await superAdmins(), {
    type: "integration_change",
    title: "تغيير في ربط المنصات",
    body: `${after.name || event.params.companyId} عدّلت ربط منصاتها`,
    meta: { companyId: event.params.companyId },
  });
});

// ============================================================
//  توليد قوالب الرد على التعليقات بالذكاء الاصطناعي
// ============================================================
exports.generateTemplates = onCall(async (req) => {
  const profile = await requireProfile(req.auth);
  const { companyId, extraHint } = req.data || {};

  if (level(profile.role) < level("manager"))
    throw new HttpsError("permission-denied", "مش مسموح لك.");
  const cid = companyId || profile.companyId;
  assertCompanyAccess(profile, cid);

  const snap = await db.doc(`companies/${cid}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "الشركة مش موجودة.");
  const company = snap.data();

  if (company.features?.canUseAI === false)
    throw new HttpsError("permission-denied", "ميزة الذكاء الاصطناعي مقفولة للشركة دي.");
  if (extraHint && String(extraHint).length > 300)
    throw new HttpsError("invalid-argument", "التوجيه طويل جداً.");

  try {
    const templates = await generateTemplates({
      companyName: company.name,
      businessType: company.ai?.businessType || company.businessType || "",
      tone: company.ai?.tone || "egyptian",
      extraHint: String(extraHint || "").slice(0, 300),
    });
    if (!templates.length) throw new Error("مرجعش قوالب");
    return { ok: true, templates };
  } catch (e) {
    logger.error("generateTemplates failed", e);
    throw new HttpsError("internal", "تعذّر توليد القوالب. جرّب تاني.");
  }
});

// ============================================================
//  مزامنة صلاحيات التوكن للمستخدمين الحاليين
//  بتتنادى تلقائياً أول ما المستخدم يدخل ولقى توكنه ناقص
// ============================================================
exports.refreshMyClaims = onCall(async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "لازم تسجل دخول.");
  const uid = req.auth.uid;

  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "المستخدم مش مسجل في النظام.");

  const p = snap.data();
  if (p.active === false) throw new HttpsError("permission-denied", "الحساب موقوف.");

  await syncClaims(uid, { role: p.role, companyId: p.companyId });
  return { ok: true, role: p.role, companyId: p.companyId || null };
});

/** مزامنة كل المستخدمين مرة واحدة — لمنشئ النظام */
exports.syncAllClaims = onCall(async (req) => {
  const profile = await requireProfile(req.auth);
  if (profile.role !== "superadmin")
    throw new HttpsError("permission-denied", "لمنشئ النظام فقط.");

  const users = await db.collection("users").get();
  let done = 0, failed = 0;

  for (const u of users.docs) {
    try {
      const d = u.data();
      await syncClaims(u.id, { role: d.role, companyId: d.companyId });
      done++;
    } catch { failed++; }
  }

  return { ok: true, done, failed };
});
