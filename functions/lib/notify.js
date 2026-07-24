// ============================================================
//  محرك الإشعارات
//  كل إشعار بيتكتب في users/{uid}/notifications
// ============================================================
const admin = require("firebase-admin");

const LEVEL = { superadmin: 100, owner: 80, manager: 60, agent: 40 };

/** أنواع الإشعارات — العنوان والأيقونة واللون والشاشة اللي بتفتح */
const TYPES = {
  // ليك أنت (منشئ النظام)
  suggestion_new:    { icon: "fa-lightbulb",       color: "warning", link: "#/support?tab=suggestions" },
  support_message:   { icon: "fa-headset",         color: "primary", link: "#/support?tab=threads" },
  integration_change:{ icon: "fa-plug",            color: "primary", link: "#/companies" },
  quota_warning:     { icon: "fa-gauge-high",      color: "warning", link: "#/companies" },
  system_error:      { icon: "fa-triangle-exclamation", color: "danger", link: "#/companies" },

  // لصاحب المكان
  order_new:         { icon: "fa-shopping-bag",    color: "success", link: "#/orders" },
  complaint_new:     { icon: "fa-face-frown",      color: "danger",  link: "#/inbox" },
  reply_overdue:     { icon: "fa-clock",           color: "warning", link: "#/inbox" },
  report_ready:      { icon: "fa-file-lines",      color: "primary", link: "#/analytics" },
  support_reply:     { icon: "fa-comment-dots",    color: "primary", link: "#/help?tab=support" },
  feature_unlocked:  { icon: "fa-unlock",          color: "success", link: "#/settings" },

  // لمدير السوشيال ميديا
  post_published:    { icon: "fa-circle-check",    color: "success", link: "#/publisher" },
  post_failed:       { icon: "fa-circle-xmark",    color: "danger",  link: "#/publisher" },
  comment_hidden:    { icon: "fa-shield-halved",   color: "warning", link: "#/inbox" },
  product_missing:   { icon: "fa-box-open",        color: "warning", link: "#/products" },

  // لموظف خدمة العملاء
  chat_assigned:     { icon: "fa-inbox",           color: "primary", link: "#/inbox" },
};

/** جِب مستخدمي شركة بأدوار معينة */
async function usersOf(companyId, roles) {
  const snap = await admin.firestore().collection("users")
    .where("companyId", "==", companyId).get();
  return snap.docs
    .filter((d) => roles.includes(d.data().role) && d.data().active !== false)
    .map((d) => d.id);
}

/** جِب كل منشئي النظام */
async function superAdmins() {
  const snap = await admin.firestore().collection("users")
    .where("role", "==", "superadmin").get();
  return snap.docs.filter((d) => d.data().active !== false).map((d) => d.id);
}

/** كل من دوره أعلى من أو يساوي المستوى ده داخل الشركة */
async function usersAtLeast(companyId, role) {
  const min = LEVEL[role] || 0;
  const roles = Object.keys(LEVEL).filter((r) => LEVEL[r] >= min);
  return usersOf(companyId, roles);
}

/**
 * إرسال إشعار لمجموعة مستخدمين
 * @param {string[]} userIds
 * @param {{type:string,title:string,body?:string,link?:string,meta?:object}} payload
 */
async function notify(userIds, payload) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return 0;

  const meta = TYPES[payload.type] || { icon: "fa-bell", color: "primary", link: "#/dashboard" };
  const db = admin.firestore();
  const batch = db.batch();

  ids.forEach((uid) => {
    const ref = db.collection(`users/${uid}/notifications`).doc();
    batch.set(ref, {
      type: payload.type,
      title: payload.title,
      body: payload.body || "",
      icon: meta.icon,
      color: meta.color,
      link: payload.link || meta.link,
      meta: payload.meta || {},
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  await batch.commit();
  return ids.length;
}

module.exports = { notify, usersOf, usersAtLeast, superAdmins, TYPES, LEVEL };
