// ============================================================
//  مركز المساعدة (للشركات)
//  ▸ المساعد الذكي  ▸ محادثة الدعم  ▸ اقتراحاتي
// ============================================================
import {
  db, collection, doc, onSnapshot, getDocs, query, where, orderBy, limit,
  fns, httpsCallable, trackSnapshot,
} from "../firebase.js";
import { session } from "../auth.js";
import { el, card, esc, toast, field, modal, spinner, emptyState, fmtTimeAgo, fmtDateTime } from "../ui.js";
import { attachTextDraft } from "../drafts.js";

let unsubSupport = null;
let supportDraft = null;
let activeTab = "assistant";
let chatHistory = [];   // محادثة المساعد الذكي (في الذاكرة بس)

const SUGG_STATUS = {
  new:       { label: "جديد", cls: "badge-red" },
  reviewing: { label: "قيد الدراسة", cls: "badge-yellow" },
  done:      { label: "تم التنفيذ", cls: "badge-green" },
  rejected:  { label: "مش هيتنفذ حالياً", cls: "badge-gray" },
};

export async function render(root) {
  root.append(el("div", { class: "page-head" }, [
    el("div", {}, [
      el("h2", { text: "مركز المساعدة" }),
      el("div", { class: "sub", text: "اسأل المساعد الذكي، أو كلّم الدعم مباشرة، أو اقترح ميزة جديدة" }),
    ]),
  ]));

  const tabs = el("div", { class: "tabs" });
  const pane = el("div");
  root.append(tabs, pane);

  [
    { id: "assistant", label: "المساعد الذكي", icon: "fa-robot" },
    { id: "support", label: "محادثة الدعم", icon: "fa-headset" },
    { id: "suggestions", label: "اقتراحاتي", icon: "fa-lightbulb" },
  ].forEach((t) => {
    const b = el("button", { class: t.id === activeTab ? "active" : "",
      html: `<i class="fas ${t.icon}"></i> ${t.label}` });
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
    unsubSupport?.(); unsubSupport = null;
    pane.innerHTML = "";
    if (activeTab === "assistant") assistantTab(pane);
    else if (activeTab === "support") supportTab(pane);
    else suggestionsTab(pane);
  }
}

// ============================================================
//  ١) المساعد الذكي
// ============================================================
function assistantTab(pane) {
  const box = el("div", { class: "card", style: "padding:0;overflow:hidden" });
  const historyNode = el("div", { class: "chat-history", style: "min-height:340px;max-height:52vh" });

  const input = el("textarea", { rows: 1, placeholder: "اسأل عن أي حاجة في النظام... مثلاً: أربط تليجرام إزاي؟" });
  const sendBtn = el("button", { class: "send-btn", html: '<i class="fas fa-paper-plane"></i>' });

  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 110) + "px";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); }
  });
  sendBtn.addEventListener("click", ask);

  const quick = el("div", { class: "quick-actions" });
  [
    "أربط تليجرام إزاي؟",
    "أرفع الأصناف والأسعار إزاي؟",
    "أضيف موظف جديد إزاي؟",
    "هل الواتساب متاح عندي؟",
  ].forEach((q) => {
    const b = el("button", { class: "chip", text: q });
    b.addEventListener("click", () => { input.value = q; ask(); });
    quick.append(b);
  });

  box.append(historyNode, el("div", { class: "chat-input-area" }, [
    quick, el("div", { class: "chat-input-row" }, [input, sendBtn]),
  ]));
  pane.append(box);

  drawHistory();

  function drawHistory() {
    historyNode.innerHTML = "";
    if (!chatHistory.length) {
      historyNode.append(el("div", { style: "margin:auto;text-align:center;color:var(--muted);padding:20px" }, [
        el("i", { class: "fas fa-robot", style: "font-size:40px;color:#d7dbe8;display:block;margin-bottom:14px" }),
        el("h3", { style: "font-size:16px;color:var(--text);margin-bottom:8px", text: "اسألني أي حاجة عن النظام" }),
        el("p", { style: "font-size:13.5px;line-height:1.8;max-width:380px;margin:0 auto",
          text: "هرد عليك من دليل النظام الرسمي، وهقولك لو الميزة متاحة في باقتك ولا لأ. ولو مش متأكد، هحوّلك للدعم على طول." }),
      ]));
      return;
    }

    chatHistory.forEach((m) => {
      if (m.from === "user") {
        historyNode.append(el("div", { class: "message msg-agent", style: "align-self:flex-end" }, [
          el("div", { text: m.text }),
        ]));
        return;
      }

      const bubble = el("div", { class: "message msg-customer", style: "max-width:88%" }, [
        el("div", { style: "white-space:pre-wrap", text: m.text }),
      ]);

      // زرار تحويل للدعم
      if (m.offerSupport) {
        const b = el("button", { class: "chip", style: "margin-top:10px",
          html: '<i class="fas fa-headset"></i> حوّلني للدعم' });
        b.addEventListener("click", () => {
          activeTab = "support";
          document.querySelectorAll(".tabs button").forEach((x, i) => x.classList.toggle("active", i === 1));
          const p = b.closest(".content-area").querySelector(".tabs").nextElementSibling;
          p.innerHTML = "";
          supportTab(p, m.question);
        });
        bubble.append(b);
      }

      // زرار إرسال كاقتراح
      if (m.suggestedFeature) {
        const b = el("button", { class: "chip", style: "margin-top:10px;margin-inline-start:6px;background:#fff3d6;color:#8a6100",
          html: '<i class="fas fa-lightbulb"></i> ابعت ده كاقتراح' });
        b.addEventListener("click", () => sendSuggestion(m.suggestedFeature, "assistant", b));
        bubble.append(b);
      }

      historyNode.append(bubble);
    });
    historyNode.scrollTop = historyNode.scrollHeight;
  }

  async function ask() {
    const q = input.value.trim();
    if (!q) return;
    input.value = "";
    input.style.height = "auto";

    chatHistory.push({ from: "user", text: q });
    drawHistory();

    const thinking = el("div", { class: "message msg-customer" }, [
      el("span", { html: '<i class="fas fa-spinner fa-spin"></i> بفكر...' }),
    ]);
    historyNode.append(thinking);
    historyNode.scrollTop = historyNode.scrollHeight;
    sendBtn.disabled = true;

    try {
      const res = await httpsCallable(fns, "helpAssistant")({ question: q, companyId: session.companyId });
      const d = res.data || {};
      chatHistory.push({
        from: "bot",
        text: d.answer || "مش عارف أرد على ده دلوقتي.",
        offerSupport: d.offerSupport === true,
        suggestedFeature: d.suggestedFeature || "",
        question: q,
      });
    } catch (e) {
      chatHistory.push({
        from: "bot",
        text: "معلش، حصلت مشكلة في الرد. تحب أحوّلك للدعم؟",
        offerSupport: true, question: q,
      });
    }

    thinking.remove();
    sendBtn.disabled = false;
    drawHistory();
  }
}

// ============================================================
//  ٢) محادثة الدعم
// ============================================================
function supportTab(pane, prefill = "") {
  const box = el("div", { class: "card", style: "padding:0;overflow:hidden" });
  const historyNode = el("div", { class: "chat-history", style: "min-height:340px;max-height:52vh" });

  const input = el("textarea", { rows: 1, placeholder: "اكتب رسالتك لإدارة النظام..." });
  if (prefill) input.value = prefill;
  const sendBtn = el("button", { class: "send-btn", html: '<i class="fas fa-paper-plane"></i>' });

  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 110) + "px";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  sendBtn.addEventListener("click", send);

  supportDraft?.destroy();
  supportDraft = attachTextDraft(`support.${session.companyId}`, input);

  box.append(historyNode, el("div", { class: "chat-input-area" }, [
    el("div", { class: "chat-input-row" }, [input, sendBtn]),
  ]));
  pane.append(box);
  pane.append(el("p", { class: "hint", style: "margin-top:10px",
    text: "الرسائل دي بتروح لإدارة النظام مباشرة. الرد بيوصلك في الإشعارات." }));

  historyNode.append(spinner("جاري تحميل المحادثة..."));
  httpsCallable(fns, "markSupportRead")({ companyId: session.companyId }).catch(() => {});

  const q = query(
    collection(db, "supportThreads", session.companyId, "messages"),
    orderBy("createdAt"), limit(200));

  unsubSupport = onSnapshot(q, (snap) => {
    trackSnapshot("support", snap);
    historyNode.innerHTML = "";
    if (snap.empty) {
      historyNode.append(el("div", { style: "margin:auto;text-align:center;color:var(--muted);padding:20px" }, [
        el("i", { class: "fas fa-headset", style: "font-size:40px;color:#d7dbe8;display:block;margin-bottom:14px" }),
        el("p", { style: "font-size:13.5px", text: "ابدأ المحادثة — اكتب مشكلتك أو استفسارك وإدارة النظام هترد عليك." }),
      ]));
      return;
    }
    snap.forEach((d) => {
      const m = d.data();
      const mine = m.from === "company";
      historyNode.append(el("div", { class: `message ${mine ? "msg-agent" : "msg-customer"}` }, [
        el("div", { style: "white-space:pre-wrap", text: m.text || "" }),
        el("time", { text: `${mine ? m.userName || "أنت" : "🛠️ دعم النظام"} · ${fmtDateTime(m.createdAt)}` }),
      ]));
    });
    historyNode.scrollTop = historyNode.scrollHeight;
  }, (err) => {
    historyNode.innerHTML = "";
    historyNode.append(el("p", { class: "text-muted", style: "margin:auto", text: "تعذّر التحميل: " + err.message }));
  });

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    sendBtn.disabled = true;
    try {
      await httpsCallable(fns, "sendSupportMessage")({ text, companyId: session.companyId });
      input.value = "";
      input.style.height = "auto";
      supportDraft?.clear();
    } catch (e) {
      toast("فشل الإرسال: " + (e.message || ""), "error");
    }
    sendBtn.disabled = false;
  }
}

// ============================================================
//  ٣) الاقتراحات
// ============================================================
async function suggestionsTab(pane) {
  const head = el("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap" }, [
    el("p", { class: "text-muted", style: "margin:0;flex:1;min-width:220px",
      text: "عايز ميزة مش موجودة؟ اكتبها هنا وهتوصل لإدارة النظام مباشرة." }),
  ]);
  const addBtn = el("button", { class: "btn btn-primary", html: '<i class="fas fa-plus"></i> اقتراح جديد' });
  addBtn.addEventListener("click", () => suggestionForm());
  head.append(addBtn);
  pane.append(head);

  const body = el("div");
  pane.append(body);
  body.append(spinner());

  try {
    const snap = await getDocs(query(
      collection(db, "suggestions"),
      where("companyId", "==", session.companyId),
      orderBy("createdAt", "desc"), limit(50)));

    body.innerHTML = "";
    if (snap.empty) {
      body.append(emptyState("fa-lightbulb", "مفيش اقتراحات لسه",
        "أي فكرة تحب تشوفها في النظام، اكتبها وهنشوفها."));
      return;
    }

    snap.forEach((d) => {
      const s = { id: d.id, ...d.data() };
      const st = SUGG_STATUS[s.status] || SUGG_STATUS.new;
      const item = el("div", { class: "card", style: "margin-bottom:12px" }, [
        el("div", { style: "display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap" }, [
          el("p", { style: "flex:1;min-width:200px;line-height:1.8;font-size:14px", text: s.text }),
          el("span", { class: `badge ${st.cls}`, text: st.label }),
        ]),
        el("small", { class: "text-muted", style: "display:block;margin-top:8px",
          text: `${s.userName || ""} · ${fmtTimeAgo(s.createdAt)}${s.source === "assistant" ? " · من المساعد الذكي" : ""}` }),
      ]);
      if (s.adminNote) {
        item.append(el("div", { class: "ai-insight", style: "margin-top:12px",
          html: `<strong>رد إدارة النظام</strong>${esc(s.adminNote)}` }));
      }
      body.append(item);
    });
  } catch (e) {
    body.innerHTML = "";
    body.append(el("p", { class: "text-muted", text: "تعذّر التحميل: " + e.message }));
  }
}

function suggestionForm() {
  const f = field({
    label: "اكتب اقتراحك بالتفصيل", name: "sugg", type: "textarea", rows: 5,
    placeholder: "مثال: عايز النظام يبعتلي إشعار على الواتساب لما يجيلي أوردر جديد",
  });
  modal({
    title: "اقتراح ميزة جديدة",
    body: f.wrap,
    actions: [
      { label: "إلغاء", class: "btn-light", onClick: ({ close }) => close() },
      {
        label: "إرسال", class: "btn-primary",
        onClick: async ({ close, button }) => {
          const t = f.input.value.trim();
          if (t.length < 5) return toast("اكتب تفاصيل أكتر", "error");
          button.disabled = true;
          const ok = await sendSuggestion(t, "manual");
          if (ok) { close(); import("../router.js").then((r) => r.reloadCurrent()); }
          else button.disabled = false;
        },
      },
    ],
  });
}

async function sendSuggestion(text, source, btn) {
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإرسال...'; }
  try {
    await httpsCallable(fns, "submitSuggestion")({ text, companyId: session.companyId, source });
    toast("تم إرسال اقتراحك لإدارة النظام ✅", "success");
    if (btn) btn.innerHTML = '<i class="fas fa-check"></i> اتبعت';
    return true;
  } catch (e) {
    toast("فشل الإرسال: " + (e.message || ""), "error");
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-lightbulb"></i> ابعت ده كاقتراح'; }
    return false;
  }
}

export function destroy() {
  supportDraft?.destroy(); supportDraft = null;
  unsubSupport?.();
  unsubSupport = null;
  activeTab = "assistant";
  chatHistory = [];
}
