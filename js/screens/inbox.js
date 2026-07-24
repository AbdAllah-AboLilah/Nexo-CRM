// ============================================================
//  صندوق الرسائل الموحد — شات لحظي + تحويل السيطرة + تذاكر الشكاوى
// ============================================================
import {
  db, collection, doc, addDoc, updateDoc, onSnapshot, query,
  orderBy, limit, serverTimestamp, trackSnapshot,
} from "../firebase.js";
import { session, tenantPath } from "../auth.js";
import { PLATFORMS } from "../config.js";
import { el, esc, toast, fmtTimeAgo, fmtDateTime, emptyState, modal, field } from "../ui.js";
import { buildLinks } from "./settings.js";
import { attachTextDraft } from "../drafts.js";

let unsubList = null, unsubMsgs = null;
let conversations = [], activeId = null, filterKey = "all";
let listNode, historyNode, headNode, inputNode, sendBtn, quickNode;
let replyDraft = null;

const STATUS = {
  new:         { label: "جديدة",      cls: "badge-red" },
  ai_handled:  { label: "رد آلي",     cls: "badge-green" },
  needs_human: { label: "محتاجة رد",  cls: "badge-yellow" },
  in_progress: { label: "جاري الحل",  cls: "badge-yellow" },
  resolved:    { label: "تم الحل",    cls: "badge-green" },
};

const FILTERS = [
  { key: "all", label: "الكل" },
  { key: "needs_human", label: "محتاجة رد" },
  { key: "complaint", label: "شكاوى" },
  { key: "ai_handled", label: "رد آلي" },
];

export async function render(root) {
  root.append(el("div", { class: "page-head" }, [
    el("div", {}, [
      el("h2", { text: "صندوق الرسائل الموحد" }),
      el("div", { class: "sub", text: "كل المحادثات من كل المنصات في مكان واحد — بترد من هنا من غير ما تخرج" }),
    ]),
  ]));

  const container = el("div", { class: "inbox-container" });
  root.append(container);

  // ---------- العمود الأيمن: قائمة المحادثات ----------
  const listCol = el("div", { class: "inbox-list" });
  const filters = el("div", { class: "inbox-filters" });
  FILTERS.forEach((f) => {
    const b = el("button", { class: `chip${f.key === filterKey ? " active" : ""}`, text: f.label });
    b.addEventListener("click", () => {
      filterKey = f.key;
      filters.querySelectorAll(".chip").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      drawList();
    });
    filters.append(b);
  });
  listNode = el("div", { class: "chat-items" });
  listCol.append(filters, listNode);

  // ---------- العمود الأيسر: الشات ----------
  const mainCol = el("div", { class: "inbox-main" });
  headNode = el("div", { class: "chat-head" });
  historyNode = el("div", { class: "chat-history" });

  quickNode = el("div", { class: "quick-actions" });
  inputNode = el("textarea", { rows: 1, placeholder: "اكتب ردك هنا... (الرد اليدوي بيوقف البوت تلقائياً)" });
  sendBtn = el("button", { class: "send-btn", html: '<i class="fas fa-paper-plane"></i>' });
  inputNode.addEventListener("input", () => {
    inputNode.style.height = "auto";
    inputNode.style.height = Math.min(inputNode.scrollHeight, 110) + "px";
  });
  inputNode.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); }
  });
  sendBtn.addEventListener("click", sendReply);

  const inputArea = el("div", { class: "chat-input-area" }, [
    quickNode,
    el("div", { class: "chat-input-row" }, [inputNode, sendBtn]),
  ]);
  mainCol.append(headNode, historyNode, inputArea);

  container.append(listCol, mainCol);

  showEmptyChat();
  subscribe();
}

function subscribe() {
  const q = query(collection(db, ...tenantPath("conversations")), orderBy("lastMessageAt", "desc"), limit(100));
  unsubList = onSnapshot(q, (snap) => {
    trackSnapshot("conversations", snap);
    conversations = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    drawList();
    if (activeId && !conversations.find((c) => c.id === activeId)) { activeId = null; showEmptyChat(); }
  }, (err) => {
    listNode.innerHTML = "";
    listNode.append(el("p", { class: "text-muted", style: "padding:16px", text: "تعذّر التحميل: " + err.message }));
  });
}

function applyFilter(list) {
  if (filterKey === "all") return list;
  if (filterKey === "complaint") return list.filter((c) => c.isComplaint === true);
  return list.filter((c) => c.status === filterKey);
}

function drawList() {
  const list = applyFilter(conversations);
  listNode.innerHTML = "";

  if (!list.length) {
    listNode.append(el("div", { style: "padding:26px 16px;text-align:center" }, [
      el("i", { class: "fas fa-inbox", style: "font-size:30px;color:#d7dbe8;display:block;margin-bottom:10px" }),
      el("p", { class: "text-muted", style: "font-size:13px",
        text: conversations.length ? "مفيش محادثات في الفلتر ده." : "مفيش محادثات لسه. أول ما تربط منصة، الرسائل هتظهر هنا لحظياً." }),
    ]));
    return;
  }

  list.forEach((c) => {
    const p = PLATFORMS[c.platform];
    const st = STATUS[c.status] || STATUS.new;
    const item = el("div", { class: `chat-item${c.id === activeId ? " active" : ""}` }, [
      el("div", { class: "chat-item-top" }, [
        el("h4", {}, [
          p ? el("i", { class: p.icon, style: `color:${p.color};font-size:12px` }) : null,
          el("span", { class: "name", text: c.customerName || "عميل" }),
          c.isComplaint ? el("span", { class: "badge badge-red", text: "شكوى" }) : null,
        ]),
        el("time", { text: fmtTimeAgo(c.lastMessageAt) }),
      ]),
      el("p", { text: c.lastMessage || "" }),
      el("span", { class: `badge ${st.cls}`, style: "margin-top:6px", text: st.label }),
    ]);
    item.addEventListener("click", () => openChat(c.id));
    listNode.append(item);
  });
}

function openChat(id) {
  activeId = id;
  drawList();
  unsubMsgs?.();

  const conv = conversations.find((c) => c.id === id);
  if (!conv) return;
  drawHead(conv);
  drawQuickActions();

  replyDraft?.destroy();
  inputNode.value = "";
  replyDraft = attachTextDraft(`inbox.${session.companyId}.${id}`, inputNode);
  inputNode.dispatchEvent(new Event("input"));

  historyNode.innerHTML = "";
  const q = query(collection(db, ...tenantPath("conversations", id, "messages")), orderBy("createdAt"), limit(200));
  unsubMsgs = onSnapshot(q, (snap) => {
    trackSnapshot("messages", snap);
    historyNode.innerHTML = "";
    if (snap.empty) {
      historyNode.append(el("p", { class: "text-muted", style: "text-align:center;margin:auto", text: "مفيش رسائل في المحادثة دي." }));
      return;
    }
    snap.forEach((d) => {
      const m = d.data();
      const cls = { customer: "msg-customer", ai: "msg-ai", agent: "msg-agent", note: "msg-note" }[m.from] || "msg-customer";
      const who = { ai: "🤖 رد آلي", agent: `👤 ${m.agentName || "موظف"}`, note: "📝 ملاحظة داخلية" }[m.from] || "";
      historyNode.append(el("div", { class: `message ${cls}` }, [
        el("div", { text: m.text || "" }),
        el("time", { text: `${who ? who + " · " : ""}${fmtDateTime(m.createdAt)}` }),
      ]));
    });
    historyNode.scrollTop = historyNode.scrollHeight;
  });
}

function drawHead(conv) {
  headNode.innerHTML = "";
  const p = PLATFORMS[conv.platform];
  const st = STATUS[conv.status] || STATUS.new;

  headNode.append(el("div", {}, [
    el("h3", {}, [
      p ? el("i", { class: p.icon, style: `color:${p.color};margin-inline-end:7px` }) : null,
      conv.customerName || "عميل",
    ]),
    el("div", { class: "meta", text: `${p?.label || conv.platform || ""} · ${conv.messageCount || 0} رسالة · آخر نشاط ${fmtTimeAgo(conv.lastMessageAt)}` }),
  ]));

  const tools = el("div", { style: "display:flex;gap:7px;align-items:center;flex-wrap:wrap" });
  tools.append(el("span", { class: `badge ${st.cls}`, text: st.label }));

  // تبديل الرد الآلي
  const aiOn = conv.aiEnabled !== false;
  const aiBtn = el("button", { class: `btn btn-sm ${aiOn ? "btn-light" : "btn-success"}`,
    html: `<i class="fas fa-robot"></i> ${aiOn ? "إيقاف البوت" : "تفعيل البوت"}` });
  aiBtn.addEventListener("click", async () => {
    await updateDoc(doc(db, ...tenantPath("conversations"), conv.id), { aiEnabled: !aiOn });
    toast(aiOn ? "تم إيقاف الرد الآلي للمحادثة دي" : "رجع الرد الآلي", "success");
  });
  tools.append(aiBtn);

  // حالة التذكرة
  const stSel = el("select", { class: "form-control", style: "width:auto;padding:6px 10px;font-size:12.5px" });
  Object.entries(STATUS).forEach(([k, v]) => {
    const o = el("option", { value: k, text: v.label });
    if (k === conv.status) o.selected = true;
    stSel.append(o);
  });
  stSel.addEventListener("change", async () => {
    await updateDoc(doc(db, ...tenantPath("conversations"), conv.id), { status: stSel.value });
    toast("تم تحديث حالة المحادثة", "success");
  });
  tools.append(stSel);

  const noteBtn = el("button", { class: "btn btn-ghost btn-sm", html: '<i class="fas fa-note-sticky"></i> ملاحظة' });
  noteBtn.addEventListener("click", addNote);
  tools.append(noteBtn);

  headNode.append(tools);
}

function drawQuickActions() {
  quickNode.innerHTML = "";
  const k = session.company?.constants || {};
  const quick = [
    { label: "العنوان", text: k.address && `📍 عنواننا: ${k.address}` },
    { label: "المواعيد", text: k.workingHours && `🕐 مواعيد العمل: ${k.workingHours}` },
    { label: "أرقام التواصل", text: k.phones && `📞 للتواصل: ${k.phones}` },
    { label: "الاستبدال", text: k.exchangePolicy && `🔄 ${k.exchangePolicy}` },
    { label: "روابطنا", text: Object.entries(buildLinks(k)).map(([p, u]) => `${PLATFORMS[p]?.label}: ${u}`).join("\n") },
  ].filter((q) => q.text);

  if (!quick.length) {
    quickNode.append(el("small", { class: "hint", text: "اكتب الثوابت في شاشة الإعدادات عشان تظهر هنا كأزرار سريعة." }));
    return;
  }
  quick.forEach((q) => {
    const b = el("button", { class: "chip", text: q.label });
    b.addEventListener("click", () => {
      inputNode.value = inputNode.value ? inputNode.value + "\n" + q.text : q.text;
      inputNode.focus();
      inputNode.dispatchEvent(new Event("input"));
    });
    quickNode.append(b);
  });
}

async function sendReply() {
  const text = inputNode.value.trim();
  if (!text || !activeId) return;
  sendBtn.disabled = true;
  try {
    const convRef = doc(db, ...tenantPath("conversations"), activeId);
    await addDoc(collection(db, ...tenantPath("conversations", activeId, "messages")), {
      from: "agent",
      text,
      agentId: session.user.uid,
      agentName: session.profile.name || "",
      createdAt: serverTimestamp(),
      deliveryStatus: "pending",   // السيرفر هو اللي هيبعتها للمنصة ويحدّثها
    });
    // الرد اليدوي بيوقف البوت أوتوماتيك (Handover)
    await updateDoc(convRef, {
      aiEnabled: false,
      status: "in_progress",
      lastMessage: text,
      lastMessageAt: serverTimestamp(),
    });
    inputNode.value = "";
    inputNode.style.height = "auto";
    replyDraft?.clear();
  } catch (e) {
    toast("فشل الإرسال: " + e.message, "error");
  }
  sendBtn.disabled = false;
}

function addNote() {
  const f = field({ label: "ملاحظة داخلية (العميل مش بيشوفها)", name: "note", type: "textarea", rows: 3 });
  modal({
    title: "إضافة ملاحظة داخلية",
    body: f.wrap,
    actions: [
      { label: "إلغاء", class: "btn-light", onClick: ({ close }) => close() },
      {
        label: "إضافة", class: "btn-primary",
        onClick: async ({ close }) => {
          const t = f.input.value.trim();
          if (!t) return;
          await addDoc(collection(db, ...tenantPath("conversations", activeId, "messages")), {
            from: "note", text: t, agentName: session.profile.name || "", createdAt: serverTimestamp(),
          });
          close();
          toast("تمت إضافة الملاحظة", "success");
        },
      },
    ],
  });
}

function showEmptyChat() {
  headNode.innerHTML = "";
  historyNode.innerHTML = "";
  historyNode.append(el("div", { style: "margin:auto;text-align:center;color:var(--muted)" }, [
    el("i", { class: "fas fa-comments", style: "font-size:40px;color:#d7dbe8;display:block;margin-bottom:12px" }),
    el("p", { text: "اختر محادثة من القائمة عشان تشوفها وترد عليها" }),
  ]));
  quickNode && (quickNode.innerHTML = "");
}

export function destroy() {
  replyDraft?.destroy(); replyDraft = null;
  unsubList?.(); unsubMsgs?.();
  unsubList = unsubMsgs = null;
  conversations = []; activeId = null; filterKey = "all";
}
