// ============================================================
//  أدوات مساعدة للواجهة (بدون أي مكتبات خارجية)
// ============================================================

/** إنشاء عنصر HTML بسرعة */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    // النصوص الطويلة (textarea) مابتقراش خاصية value كـ attribute —
    // لازم تتحط على الخاصية نفسها، وإلا الحقل بيطلع فاضي
    else if (k === "value" && tag === "textarea") node.value = v ?? "";
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c == null) return;
    node.append(c.nodeType ? c : document.createTextNode(c));
  });
  return node;
}

/** تهريب النصوص قبل ما تتحط في innerHTML */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- إشعارات ----------
let toastBox;
export function toast(message, type = "info", ms = 3500) {
  if (!toastBox) {
    toastBox = el("div", { class: "toast-box", id: "toastBox" });
    document.body.append(toastBox);
  }
  const icons = { info: "fa-circle-info", success: "fa-circle-check", error: "fa-circle-exclamation", warn: "fa-triangle-exclamation" };
  const t = el("div", { class: `toast toast-${type}`, html: `<i class="fas ${icons[type] || icons.info}"></i><span>${esc(message)}</span>` });
  toastBox.append(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 250); }, ms);
}

// ---------- نافذة منبثقة ----------
export function modal({ title, body, actions = [], width = 520 }) {
  const overlay = el("div", { class: "modal-overlay" });
  const box = el("div", { class: "modal", style: `max-width:${width}px` });
  const head = el("div", { class: "modal-head" }, [
    el("h3", { text: title }),
    el("button", { class: "icon-btn", html: '<i class="fas fa-xmark"></i>', onClick: close }),
  ]);
  const content = el("div", { class: "modal-body" });
  if (typeof body === "string") content.innerHTML = body;
  else if (body) content.append(body);

  const foot = el("div", { class: "modal-foot" });
  actions.forEach((a) => {
    const b = el("button", { class: `btn ${a.class || "btn-light"}`, text: a.label });
    b.addEventListener("click", () => a.onClick?.({ close, box, content, button: b }));
    foot.append(b);
  });

  box.append(head, content, foot);
  overlay.append(box);
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add("show"));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  function close() { overlay.classList.remove("show"); setTimeout(() => overlay.remove(), 200); }
  return { close, content, overlay };
}

export function confirmBox(message, { title = "تأكيد", danger = true } = {}) {
  return new Promise((resolve) => {
    const m = modal({
      title,
      body: `<p class="text-muted" style="line-height:1.9">${esc(message)}</p>`,
      width: 440,
      actions: [
        { label: "إلغاء", class: "btn-light", onClick: ({ close }) => { close(); resolve(false); } },
        { label: "تأكيد", class: danger ? "btn-danger" : "btn-primary", onClick: ({ close }) => { close(); resolve(true); } },
      ],
    });
  });
}

// ---------- نماذج ----------
export function field({ label, name, value = "", type = "text", placeholder = "", hint = "", options, rows = 3, required = false }) {
  const wrap = el("div", { class: "field" });
  if (label) wrap.append(el("label", { text: label, for: name }));
  let input;
  if (type === "textarea") {
    input = el("textarea", { class: "form-control", id: name, name, rows, placeholder });
    input.value = value ?? "";
  } else if (type === "select") {
    input = el("select", { class: "form-control", id: name, name });
    (options || []).forEach((o) => {
      const opt = el("option", { value: o.value, text: o.label });
      if (String(o.value) === String(value)) opt.selected = true;
      input.append(opt);
    });
  } else if (type === "checkbox") {
    input = el("input", { type: "checkbox", id: name, name, class: "chk" });
    input.checked = !!value;
  } else {
    input = el("input", { class: "form-control", id: name, name, type, placeholder });
    input.value = value ?? "";
  }
  if (required) input.required = true;
  wrap.append(input);
  if (hint) wrap.append(el("small", { class: "hint", text: hint }));
  return { wrap, input };
}

/** حقل كلمة مرور مع زرار إظهار/إخفاء */
export function passwordField({ label, name, placeholder = "••••••••", hint = "" }) {
  const wrap = el("div", { class: "field" });
  if (label) wrap.append(el("label", { text: label, for: name }));
  const box = el("div", { class: "pwd-wrap" });
  const input = el("input", { class: "form-control", id: name, name, type: "password", placeholder, autocomplete: "new-password" });
  const eye = el("button", { type: "button", class: "pwd-eye", html: '<i class="fas fa-eye"></i>', "aria-label": "إظهار" });
  eye.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    eye.innerHTML = `<i class="fas fa-eye${show ? "-slash" : ""}"></i>`;
  });
  box.append(input, eye);
  wrap.append(box);
  if (hint) wrap.append(el("small", { class: "hint", text: hint }));
  return { wrap, input };
}

export function toggle({ label, name, checked = false, hint = "", disabled = false, onChange }) {
  const input = el("input", { type: "checkbox", id: name, name });
  input.checked = !!checked;
  input.disabled = !!disabled;
  if (onChange) input.addEventListener("change", () => onChange(input.checked));
  const row = el("label", { class: `switch-row${disabled ? " is-disabled" : ""}`, for: name }, [
    input,
    el("span", { class: "switch" }),
    el("span", { class: "switch-label" }, [
      el("strong", { text: label }),
      hint ? el("small", { text: hint }) : null,
    ]),
  ]);
  return { row, input };
}

// ---------- تنسيق ----------
export function fmtDate(ts) {
  const d = toDate(ts);
  if (!d) return "—";
  return d.toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateTime(ts) {
  const d = toDate(ts);
  if (!d) return "—";
  return d.toLocaleString("ar-EG", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtTimeAgo(ts) {
  const d = toDate(ts);
  if (!d) return "";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "الآن";
  if (s < 3600) return `${Math.floor(s / 60)} د`;
  if (s < 86400) return `${Math.floor(s / 3600)} س`;
  if (s < 604800) return `${Math.floor(s / 86400)} ي`;
  return fmtDate(ts);
}

export function toDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts instanceof Date) return ts;
  if (typeof ts === "number") return new Date(ts);
  const d = new Date(ts);
  return isNaN(d) ? null : d;
}

export function money(n) {
  const v = Number(n || 0);
  return `${v.toLocaleString("ar-EG", { maximumFractionDigits: 2 })} ج`;
}

// ---------- حالات فارغة وتحميل ----------
export function emptyState(icon, title, sub = "", action = null) {
  const box = el("div", { class: "empty" }, [
    el("i", { class: `fas ${icon}` }),
    el("h3", { text: title }),
    sub ? el("p", { text: sub }) : null,
  ]);
  if (action) box.append(action);
  return box;
}

export function spinner(text = "جاري التحميل...") {
  return el("div", { class: "loading" }, [el("div", { class: "spin" }), el("span", { text })]);
}

export function card(title, ...content) {
  const c = el("div", { class: "card" });
  if (title) c.append(el("h3", { class: "card-title", text: title }));
  content.forEach((x) => x && c.append(x));
  return c;
}

/** أسبوع السبت → الجمعة (التقويم المصري) */
export function weekStart(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();          // 0=أحد ... 6=سبت
  const diff = (day + 1) % 7;      // السبت = بداية الأسبوع
  d.setDate(d.getDate() - diff);
  return d;
}
