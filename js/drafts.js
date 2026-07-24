// ============================================================
//  الحفظ التلقائي للمسودات
//  أي حاجة بتكتبها بتتحفظ على الجهاز فوراً — حتى لو الجهاز طفي فجأة
// ============================================================
import { el, esc, toast, fmtTimeAgo } from "./ui.js";

const PREFIX = "nexo.draft.";
const MAX_AGE = 7 * 24 * 3600 * 1000;   // المسودة بتعيش أسبوع

function storageKey(key) { return PREFIX + key; }

export function saveDraft(key, data) {
  try {
    localStorage.setItem(storageKey(key), JSON.stringify({ at: Date.now(), data }));
    return true;
  } catch { return false; }   // المساحة اتملت أو التخزين مقفول
}

export function loadDraft(key) {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.at || Date.now() - parsed.at > MAX_AGE) {
      localStorage.removeItem(storageKey(key));
      return null;
    }
    return parsed;
  } catch { return null; }
}

export function clearDraft(key) {
  try { localStorage.removeItem(storageKey(key)); } catch { /* تجاهل */ }
}

/** هل المسودة فيها محتوى فعلي؟ */
function hasContent(data) {
  if (!data || typeof data !== "object") return false;
  return Object.values(data).some((v) => {
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "number") return v !== 0;
    return false;
  });
}

/**
 * ربط فورم بالحفظ التلقائي.
 * @param {string} key        معرّف المسودة
 * @param {object} opts
 *   serialize()  → يرجّع كائن الحالة الحالية
 *   restore(d)   → بيرجّع الحالة للفورم
 *   watch        → عناصر بنسمع تغييرها
 *   mount        → مكان عرض شريط الاستعادة والمؤشر
 */
export function attachDraft(key, { serialize, restore, watch = [], mount, label = "المسودة" }) {
  let timer = null;
  let indicator = null;

  if (mount) {
    indicator = el("small", { class: "draft-status" });
    mount.append(indicator);
  }

  function flush() {
    const data = serialize();
    if (!hasContent(data)) { clearDraft(key); setStatus(""); return; }
    const ok = saveDraft(key, data);
    setStatus(ok ? "✓ اتحفظت تلقائياً" : "⚠️ تعذّر الحفظ المحلي");
  }

  function setStatus(text) {
    if (!indicator) return;
    indicator.textContent = text;
    indicator.classList.toggle("saved", text.startsWith("✓"));
  }

  function onChange() {
    clearTimeout(timer);
    setStatus("جاري الحفظ...");
    timer = setTimeout(flush, 600);
  }

  watch.forEach((node) => {
    if (!node) return;
    node.addEventListener("input", onChange);
    node.addEventListener("change", onChange);
  });

  // حفظ فوري لو المستخدم قفل الصفحة أو التطبيق راح للخلفية
  const onHide = () => { clearTimeout(timer); flush(); };
  window.addEventListener("beforeunload", onHide);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") onHide();
  });

  /** عرض شريط الاستعادة لو فيه مسودة محفوظة */
  function offerRestore(target) {
    const draft = loadDraft(key);
    if (!draft || !hasContent(draft.data)) return null;

    const bar = el("div", { class: "draft-bar" }, [
      el("div", { class: "draft-bar-text" }, [
        el("i", { class: "fas fa-clock-rotate-left" }),
        el("span", { html: `فيه ${esc(label)} محفوظة من <strong>${esc(fmtTimeAgo(draft.at))}</strong>` }),
      ]),
    ]);

    const restoreBtn = el("button", { class: "btn btn-primary btn-sm", text: "استعادة" });
    restoreBtn.addEventListener("click", () => {
      restore(draft.data);
      bar.remove();
      toast("تم استرجاع المسودة", "success");
    });

    const dropBtn = el("button", { class: "btn btn-light btn-sm", text: "تجاهل" });
    dropBtn.addEventListener("click", () => { clearDraft(key); bar.remove(); });

    bar.append(el("div", { class: "draft-bar-actions" }, [restoreBtn, dropBtn]));
    (target || mount)?.prepend(bar);
    return bar;
  }

  return {
    offerRestore,
    flush,
    clear: () => { clearTimeout(timer); clearDraft(key); setStatus(""); },
    destroy: () => {
      clearTimeout(timer);
      window.removeEventListener("beforeunload", onHide);
    },
  };
}

/**
 * حفظ تلقائي لمربع نص واحد (زي مربع الرد في الشات).
 * بيرجّع دوال بسيطة للتحكم.
 */
export function attachTextDraft(key, textarea) {
  if (!textarea) return { clear: () => {}, destroy: () => {} };
  let timer = null;

  const saved = loadDraft(key);
  if (saved?.data?.text) textarea.value = saved.data.text;

  const flush = () => {
    const text = textarea.value.trim();
    if (text) saveDraft(key, { text });
    else clearDraft(key);
  };

  const onInput = () => { clearTimeout(timer); timer = setTimeout(flush, 500); };
  textarea.addEventListener("input", onInput);

  const onHide = () => { clearTimeout(timer); flush(); };
  window.addEventListener("beforeunload", onHide);

  return {
    clear: () => { clearTimeout(timer); clearDraft(key); },
    destroy: () => {
      clearTimeout(timer);
      textarea.removeEventListener("input", onInput);
      window.removeEventListener("beforeunload", onHide);
    },
  };
}
