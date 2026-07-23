// ============================================================
//  Nexo CRM — الدوال السحابية
//  المفاتيح كلها في Firebase Secrets، مفيش أي مفتاح مكتوب في الكود
// ============================================================
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { setGlobalOptions, logger } = require("firebase-functions/v2");
const admin = require("firebase-admin");

const { encrypt, decrypt, verifyMetaSignature } = require("./lib/crypto");
const { generateReply, assistPost, helpAnswer, ping, ASSIST_TASKS } = require("./lib/ai");
const { buildKnowledgeText } = require("./lib/kb");
const { notify, usersOf, usersAtLeast, superAdmins } = require("./lib/notify");
const telegram = require("./lib/telegram");

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
exports.createUser = onCall(async (req) => {
  const profile = await requireProfile(req.auth);
  const { name, email, password, role, companyId } = req.data || {};

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
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: profile.uid,
  });

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
  if (Object.keys(updates).length) await db.doc(`users/${uid}`).update(updates);
  if (password) {
    if (password.length < 6) throw new HttpsError("invalid-argument", "كلمة المرور قصيرة.");
    await admin.auth().updateUser(uid, { password });
  }

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

      const msg = req.body?.message || req.body?.channel_post;
      if (!msg?.text) return;

      const companySnap = await db.doc(`companies/${companyId}`).get();
      if (!companySnap.exists) return;

      await handleIncoming({
        company: { id: companyId, ...companySnap.data() },
        platform: "telegram",
        externalId: String(msg.chat.id),
        customerName: [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || "عميل",
        text: msg.text,
        channel: "message",
      });
    } catch (err) {
      logger.error("telegramWebhook error", err);
    }
  });

// ============================================================
//  المعالجة الموحّدة لأي رسالة واردة من أي منصة
// ============================================================
async function handleIncoming({ company, platform, externalId, customerName, text, channel, postId, commentId }) {
  const companyId = company.id;
  const convId = `${platform}_${externalId}`;
  const convRef = db.doc(`companies/${companyId}/conversations/${convId}`);
  const convSnap = await convRef.get();
  const conv = convSnap.exists ? convSnap.data() : null;

  // تسجيل رسالة العميل
  await convRef.set({
    platform, externalId, customerName,
    lastMessage: text.slice(0, 120),
    lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
    messageCount: admin.firestore.FieldValue.increment(1),
    status: conv?.status === "in_progress" ? "in_progress" : (conv?.status || "new"),
    aiEnabled: conv?.aiEnabled !== false,
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
    db.collection(`companies/${companyId}/products`).limit(300).get(),
    convRef.collection("messages").orderBy("createdAt", "desc").limit(6).get(),
  ]);
  const products = productsSnap.docs.map((d) => d.data());
  const history = historySnap.docs.map((d) => d.data()).reverse();

  let result;
  try {
    result = await generateReply({
      company, products, userMessage: text, history, channel,
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

  await convRef.collection("messages").add({
    from: "ai", text: result.reply, intent: result.intent,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    deliveryStatus: "pending",
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
      const convSnap = await db.doc(`companies/${companyId}/conversations/${convId}`).get();
      if (!convSnap.exists) return;
      const conv = convSnap.data();

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
//  6) الناشر المجدول — بيشتغل كل 5 دقايق وينشر اللي جه معاده
// ============================================================
exports.runScheduledPosts = onSchedule(
  { schedule: "every 5 minutes", timeZone: "Africa/Cairo", secrets: [TOKEN_ENC_KEY] },
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

        const results = {};
        for (const platform of post.platforms || []) {
          try {
            const text = post.versions?.[platform] || post.caption;
            if (platform === "telegram") {
              const s = await db.doc(`companies/${companyId}/secrets/telegram`).get();
              if (!s.exists) throw new Error("مفيش توكن تليجرام");
              const token = decrypt(s.data().token, TOKEN_ENC_KEY.value());
              const chatId = s.data().chatId;
              if (!chatId) throw new Error("مفيش معرّف قناة");

              const media = Array.isArray(post.media) ? post.media : [];
              const photos = media.filter((m) => m.type === "image" && m.url);
              const videos = media.filter((m) => m.type === "video" && m.url);

              if (photos.length || videos.length) {
                // تليجرام بيحط الكابشن على أول ملف بس (الحد 1024 حرف)
                const caption = text.length > 1024 ? text.slice(0, 1021) + "..." : text;
                const first = photos[0] || videos[0];
                if (first.type === "image") await telegram.sendPhoto(token, chatId, first.url, caption);
                else await telegram.sendVideo(token, chatId, first.url, caption);

                for (const m of media.filter((x) => x !== first && x.url)) {
                  if (m.type === "image") await telegram.sendPhoto(token, chatId, m.url, "");
                  else await telegram.sendVideo(token, chatId, m.url, "");
                }
                // لو النص أطول من حد الكابشن، نبعت الباقي كرسالة
                if (text.length > 1024) await telegram.sendMessage(token, chatId, text);
              } else {
                await telegram.sendMessage(token, chatId, text);
              }
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
        await postDoc.ref.update({
          status: anySent ? "published" : "failed",
          results,
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
      }
    }
  });

// ============================================================
//  7) تجميع إحصائيات آخر اليوم (أساس التقارير)
// ============================================================
exports.dailyRollup = onSchedule(
  { schedule: "55 23 * * *", timeZone: "Africa/Cairo" },
  async () => {
    const today = new Date();
    const dayId = today.toISOString().slice(0, 10);
    const from = new Date(today); from.setHours(0, 0, 0, 0);

    const companies = await db.collection("companies").get();
    for (const c of companies.docs) {
      const companyId = c.id;
      const [convs, orders] = await Promise.all([
        db.collection(`companies/${companyId}/conversations`).where("lastMessageAt", ">=", from).get(),
        db.collection(`companies/${companyId}/orders`).where("createdAt", ">=", from).get(),
      ]);

      const list = convs.docs.map((d) => d.data());
      await db.doc(`companies/${companyId}/stats/${dayId}`).set({
        date: dayId,
        conversations: list.length,
        aiHandled: list.filter((x) => x.status === "ai_handled").length,
        needsHuman: list.filter((x) => x.status === "needs_human").length,
        complaints: list.filter((x) => x.isComplaint).length,
        orders: orders.size,
        revenue: orders.docs.reduce((s, o) => s + (Number(o.data().total) || 0), 0),
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    logger.info("dailyRollup done", dayId);
  });

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
