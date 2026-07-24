// ============================================================
//  الثوابت وبيانات الشركة + ربط المنصات
// ============================================================
import { db, doc, updateDoc, fns, httpsCallable } from "../firebase.js";
import { session, refreshCompany, atLeast, hasFeature } from "../auth.js";
import { DEFAULT_CONSTANTS, PLATFORMS, LINK_LABELS } from "../config.js";
import { el, card, esc, toast, field, modal, spinner } from "../ui.js";

export async function render(root) {
  const c = session.company;
  if (!c) return;

  root.append(el("div", { class: "page-head" }, [
    el("div", {}, [
      el("h2", { text: "الثوابت وبيانات الشركة" }),
      el("div", { class: "sub", text: "البيانات دي بيستخدمها البوت في الردود، وتقدر ترفقها في أي بوست بضغطة زر" }),
    ]),
  ]));

  const tabs = el("div", { class: "tabs" });
  const pane = el("div");
  root.append(tabs, pane);

  const tabDefs = [
    { id: "constants", label: "الثوابت" },
    { id: "links", label: "روابط التواصل" },
    { id: "integrations", label: "ربط المنصات" },
  ];
  let activeTab = "constants";

  tabDefs.forEach((t) => {
    const b = el("button", { text: t.label, class: t.id === activeTab ? "active" : "" });
    b.addEventListener("click", () => {
      activeTab = t.id;
      tabs.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      draw();
    });
    tabs.append(b);
  });

  draw();

  function draw() {
    pane.innerHTML = "";
    if (activeTab === "constants") pane.append(constantsCard());
    else if (activeTab === "links") pane.append(linksCard());
    else pane.append(integrationsCard());
  }
}

// ---------- الثوابت ----------
function constantsCard() {
  const c = session.company;
  const k = { ...DEFAULT_CONSTANTS, ...(c.constants || {}) };
  const box = card("البيانات الثابتة للشركة");
  const editable = atLeast("owner");

  const address = field({ label: "العنوان", name: "address", type: "textarea", rows: 2, value: k.address, placeholder: "أونلاين — بنخدم كل المحافظات" });
  const hours = field({ label: "مواعيد العمل", name: "workingHours", type: "textarea", rows: 2, value: k.workingHours, placeholder: "يومياً من 10 صباحاً لـ 10 مساءً — الجمعة إجازة" });
  const phones = field({ label: "أرقام التواصل", name: "phones", value: k.phones, placeholder: "01xxxxxxxxx / 01xxxxxxxxx" });
  const policy = field({ label: "سياسة الاستبدال والاسترجاع", name: "exchangePolicy", type: "textarea", rows: 3, value: k.exchangePolicy, placeholder: "الاستبدال خلال 14 يوم بشرط ..." });

  box.append(address.wrap, hours.wrap, phones.wrap, policy.wrap);
  box.append(el("p", { class: "hint", text: "الذكاء الاصطناعي بيقرأ الكلام ده أوتوماتيك ويرد بيه لو حد سأل عن العنوان أو المواعيد." }));

  if (editable) {
    box.append(saveBtn(async (b) => {
      const constants = {
        ...k,
        address: address.input.value.trim(),
        workingHours: hours.input.value.trim(),
        phones: phones.input.value.trim(),
        exchangePolicy: policy.input.value.trim(),
      };
      await updateDoc(doc(db, "companies", session.companyId), { constants });
      await refreshCompany();
      toast("تم حفظ الثوابت", "success");
    }));
  }
  return box;
}

// ---------- روابط التواصل ----------
function linksCard() {
  const c = session.company;
  const k = { ...DEFAULT_CONSTANTS, ...(c.constants || {}) };
  const box = card("روابط التواصل السريعة (Deep Links)");
  box.append(el("p", { class: "text-muted", style: "margin-bottom:16px",
    text: "اكتب البيانات هنا مرة واحدة، والنظام هيولّد الروابط الجاهزة ويحطها في البوستات — مع الاستبعاد الذكي (مش هيحط لينك تليجرام في بوست نازل على تليجرام)." }));

  const wa = field({ label: "رقم واتساب (بكود الدولة بدون +)", name: "whatsappNumber", value: k.whatsappNumber, placeholder: "201234567890" });
  const ig = field({ label: "يوزر انستجرام (بدون @)", name: "instagramUser", value: k.instagramUser, placeholder: "NexoApp" });
  const tg = field({ label: "قناة/يوزر تليجرام (بدون @)", name: "telegramChannel", value: k.telegramChannel, placeholder: "NexoApp" });
  const fb = field({ label: "رابط صفحة فيسبوك", name: "facebookPage", value: k.facebookPage, placeholder: "https://facebook.com/NexoApp" });

  box.append(el("div", { class: "form-row" }, [wa.wrap, ig.wrap]), el("div", { class: "form-row" }, [tg.wrap, fb.wrap]));

  const preview = el("div", { class: "ai-insight", style: "margin-top:8px" });
  box.append(preview);
  const update = () => {
    const links = buildLinks({
      whatsappNumber: wa.input.value.trim(),
      instagramUser: ig.input.value.trim(),
      telegramChannel: tg.input.value.trim(),
      facebookPage: fb.input.value.trim(),
    });
    preview.innerHTML = `<strong>معاينة الروابط المولّدة</strong>${
      Object.keys(links).length
        ? Object.entries(links).map(([p, u]) => `<div>${esc(LINK_LABELS[p] || PLATFORMS[p]?.label || p)}: <code>${esc(u)}</code></div>`).join("")
        : '<span class="text-muted">لسه مفيش بيانات مكتوبة</span>'}`;
  };
  [wa, ig, tg, fb].forEach((f) => f.input.addEventListener("input", update));
  update();

  if (atLeast("owner")) {
    box.append(saveBtn(async () => {
      const constants = {
        ...k,
        whatsappNumber: wa.input.value.trim(),
        instagramUser: ig.input.value.trim(),
        telegramChannel: tg.input.value.trim(),
        facebookPage: fb.input.value.trim(),
      };
      await updateDoc(doc(db, "companies", session.companyId), { constants });
      await refreshCompany();
      toast("تم حفظ الروابط", "success");
    }));
  }
  return box;
}

/** توليد الروابط العميقة من الثوابت */
export function buildLinks(k = session.company?.constants || {}) {
  const links = {};
  if (k.whatsappNumber) links.whatsapp = `https://wa.me/${k.whatsappNumber.replace(/\D/g, "")}`;
  if (k.telegramChannel) links.telegram = `https://t.me/${k.telegramChannel.replace(/^@/, "")}`;
  if (k.telegramBot) links.telegramBot = `https://t.me/${String(k.telegramBot).replace(/^@/, "")}`;
  if (k.instagramUser) links.instagram = `https://instagram.com/${k.instagramUser.replace(/^@/, "")}`;
  if (k.facebookPage) links.facebook = k.facebookPage;
  return links;
}

// ---------- ربط المنصات ----------
function integrationsCard() {
  const wrap = el("div");
  const c = session.company;

  wrap.append(el("div", { class: "ai-insight warn" , html:
    `<strong>مهم تعرف</strong>
     تليجرام بيشتغل فوراً بمجرد ما تحط توكن البوت.
     فيسبوك وانستجرام محتاجين <b>App Review + Business Verification</b> من ميتا قبل ما تشتغل على صفحات العملاء.
     واتساب محتاج WhatsApp Cloud API وقوالب رسائل معتمدة ومدفوعة.` }));

  const grid = el("div", { class: "grid grid-2", style: "margin-top:16px" });
  wrap.append(grid);

  const status = c.integrations || {};

  Object.entries(PLATFORMS).forEach(([key, p]) => {
    const enabled = hasFeature(p.feature);
    const connected = status[key]?.connected === true;
    const box = el("div", { class: "card" });
    box.append(
      el("div", { style: "display:flex;align-items:center;gap:12px;margin-bottom:12px" }, [
        el("div", { style: `width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:${p.color}1a;color:${p.color};font-size:19px`,
          html: `<i class="${p.icon}"></i>` }),
        el("div", {}, [
          el("strong", { text: p.label, style: "font-size:15px;display:block" }),
          el("span", { class: `badge ${connected ? "badge-green" : "badge-gray"}`, text: connected ? "مربوط" : "غير مربوط" }),
        ]),
      ]),
    );

    if (!enabled) {
      box.append(el("p", { class: "hint", text: "المنصة دي مقفولة لباقة الشركة. كلّم إدارة النظام لتفعيلها." }));
      box.append(el("button", { class: "btn btn-light", disabled: "true", html: '<i class="fas fa-lock"></i> غير متاح' }));
    } else if (key === "telegram") {
      box.append(el("p", { class: "hint", text: "اعمل بوت من @BotFather على تليجرام وهات التوكن." }));
      const b = el("button", { class: "btn btn-primary", html: `<i class="fas fa-plug"></i> ${connected ? "تغيير التوكن" : "ربط البوت"}` });
      b.addEventListener("click", () => telegramForm());
      box.append(b);
    } else {
      box.append(el("p", { class: "hint", text: key === "whatsapp"
        ? "هيتفعّل بعد اعتماد WhatsApp Cloud API."
        : "هيتفعّل بزرار ربط رسمي من ميتا بعد اعتماد التطبيق (OAuth)." }));
      box.append(el("button", { class: "btn btn-light", disabled: "true", html: '<i class="fas fa-clock"></i> قيد التجهيز' }));
    }
    grid.append(box);
  });

  return wrap;
}

function telegramForm() {
  const token = field({ label: "Bot Token", name: "token", placeholder: "123456789:AAF...", hint: "التوكن بيتخزن مشفّر على السيرفر، ومش بيظهر تاني في اللوحة." });
  const channel = field({ label: "معرّف القناة/الجروب", name: "chatId", value: session.company?.constants?.telegramChannel || "", placeholder: "@NexoApp أو -1001234567890" });
  const body = el("div", {}, [token.wrap, channel.wrap]);

  modal({
    title: "ربط بوت تليجرام", body,
    actions: [
      { label: "إلغاء", class: "btn-light", onClick: ({ close }) => close() },
      {
        label: "ربط", class: "btn-primary",
        onClick: async ({ close, button }) => {
          if (!token.input.value.trim()) return toast("اكتب التوكن", "error");
          button.disabled = true;
          try {
            const save = httpsCallable(fns, "saveIntegration");
            await save({
              companyId: session.companyId,
              platform: "telegram",
              token: token.input.value.trim(),
              chatId: channel.input.value.trim(),
            });
            await refreshCompany();
            toast("تم ربط بوت تليجرام", "success");
            close();
            import("../router.js").then((r) => r.reloadCurrent());
          } catch (e) {
            button.disabled = false;
            toast("فشل الربط: " + (e.message || ""), "error");
          }
        },
      },
    ],
  });
}

function saveBtn(handler) {
  const b = el("button", { class: "btn btn-primary", style: "margin-top:8px", html: '<i class="fas fa-floppy-disk"></i> حفظ' });
  b.addEventListener("click", async () => {
    b.disabled = true;
    try { await handler(b); } catch (e) { toast("فشل الحفظ: " + e.message, "error"); }
    b.disabled = false;
  });
  return b;
}
