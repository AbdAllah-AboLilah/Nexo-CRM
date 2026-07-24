// ============================================================
//  المصادقة والصلاحيات (Roles)
// ============================================================
import {
  auth, db, onAuthStateChanged, signOut as fbSignOut,
  doc, getDoc, setDoc, serverTimestamp,
} from "./firebase.js";
import { SUPER_ADMIN_EMAIL, ROLES } from "./config.js";

/** بيانات الجلسة الحالية */
export const session = {
  user: null,        // Firebase Auth user
  profile: null,     // users/{uid}
  company: null,     // companies/{companyId}
  companyId: null,   // الشركة اللي شغال عليها حالياً (ممكن تتغير لو Super Admin)
};

export function isSuper() {
  return session.profile?.role === "superadmin";
}

export function roleLevel() {
  return ROLES[session.profile?.role]?.level ?? 0;
}

/** هل الدور الحالي يساوي أو أعلى من الدور المطلوب؟ */
export function atLeast(role) {
  return roleLevel() >= (ROLES[role]?.level ?? 999);
}

/** هل الميزة دي مفتوحة للشركة الحالية؟ */
export function hasFeature(key) {
  if (!key) return true;
  if (isSuper() && !session.companyId) return true;
  return session.company?.features?.[key] === true;
}

/** هل المستخدم يقدر يشوف عنصر القائمة ده؟ */
export function canSee(navItem) {
  if (!session.profile) return false;
  const byRole = navItem.roles.includes(session.profile.role);
  // صلاحيات إضافية: صاحب المكان ممكن يفتح للموظف شاشات فوق دوره
  const byExtra = Array.isArray(session.profile.extraScreens)
    && session.profile.extraScreens.includes(navItem.id);
  if (!byRole && !byExtra) return false;
  if (navItem.feature && !hasFeature(navItem.feature)) return false;
  return true;
}

/**
 * حارس الصفحة: بيستنى Firebase يقرر، وبعدين بيجيب البروفايل والشركة.
 * لو مفيش مستخدم → يرجّع للـ login.
 */
export function guard() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub();
      if (!user) {
        location.replace("login.html");
        return;
      }
      session.user = user;
      session.profile = await loadOrCreateProfile(user);

      if (!session.profile || session.profile.active === false) {
        await fbSignOut(auth);
        location.replace("login.html?blocked=1");
        return;
      }

      // Super Admin ممكن يكون شايف كل الشركات؛ الباقي مربوط بشركته
      const savedTenant = localStorage.getItem("nexo.tenant");
      session.companyId = isSuper()
        ? (savedTenant || session.profile.companyId || null)
        : session.profile.companyId || null;

      if (session.companyId) session.company = await loadCompany(session.companyId);
      resolve(session);
    });
  });
}

async function loadOrCreateProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = { id: snap.id, ...snap.data() };
    // ضمان إن الإيميل المعتمد يفضل Super Admin دايماً
    if (user.email === SUPER_ADMIN_EMAIL && data.role !== "superadmin") {
      await setDoc(ref, { role: "superadmin" }, { merge: true });
      data.role = "superadmin";
    }
    return data;
  }

  // أول دخول للإيميل المعتمد → ننشئ حساب منشئ النظام تلقائياً
  if (user.email === SUPER_ADMIN_EMAIL) {
    const profile = {
      name: "Abo-Lilah",
      email: user.email,
      role: "superadmin",
      companyId: null,
      active: true,
      createdAt: serverTimestamp(),
    };
    await setDoc(ref, profile);
    return { id: user.uid, ...profile, role: "superadmin", active: true };
  }

  return null; // مستخدم مش متسجل في النظام
}

export async function loadCompany(companyId) {
  if (!companyId) return null;
  const snap = await getDoc(doc(db, "companies", companyId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** تبديل الشركة اللي بيشتغل عليها Super Admin (الدخول كشركة) */
export async function switchTenant(companyId) {
  if (!isSuper()) return;
  if (companyId) localStorage.setItem("nexo.tenant", companyId);
  else localStorage.removeItem("nexo.tenant");
  session.companyId = companyId;
  session.company = await loadCompany(companyId);
}

export async function refreshCompany() {
  if (session.companyId) session.company = await loadCompany(session.companyId);
}

export async function logout() {
  localStorage.removeItem("nexo.tenant");
  await fbSignOut(auth);
  location.replace("login.html");
}

/** مسار مجموعة جوّه الشركة الحالية */
export function tenantPath(...parts) {
  if (!session.companyId) throw new Error("NO_TENANT");
  return ["companies", session.companyId, ...parts];
}
