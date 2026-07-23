// ============================================================
//  الدعم والاقتراحات (منشئ النظام)
//  ▸ اقتراحات كل الشركات  ▸ محادثات الدعم
// ============================================================
import {
  db, collection, doc, onSnapshot, getDocs, query, where,
  orderBy, limit, fns, httpsCallable, trackSnapshot,
} from "../firebase.js";
import { session, isSuper } from "../auth.js";
import { el, card, esc, toast, field, modal, spinner, emptyState, fmtTimeAgo, fmtDateTime } from "../ui.js";

let unsubThreads = null, unsubMsgs = null;
let activeTab = "suggestions";
let statusFilter = "all";
let activeThread = null;

const SUGG_STATUS = {
  new:       { label: "جديد", cls: "badge-red" },
  reviewing: { label: "قيد الدراسة", cls: "badge-yellow" },
  done:      { label: "تم التنفيذ", cls: "badge-green" },
  rejected:  { label: "مرفوض", cls: "badge-gray" },
};

export async function render(root) {
  if (!isSuper()) {
    root.append(el("p", { class: "text-muted", text: "الصفحة دي لمنشئ النظام فقط." }));
    return;
  }

  root.append(el("div", { class: "page-head" }, [
    el("div", {}, [
      el("h2", { text: "الدعم والاقتراحات" }),
      el("div", { class: "sub", text: "كل طلبات ورسائل الشركات في مكان واحد" }),
    ]),
  ]));

  const tabs = el("div", { class: "tabs" });
  const pane = el("div");
  root.append(tabs, pane);

  [
    { id: "suggestions", label: "الاقتراحات", icon: "fa-lightbulb" },
    { id: "threads", label: "محادثات الدعم", icon: "fa-headset" },
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
    unsubThreads?.(); unsubMsgs?.();
    unsubThreads = unsubMsgs = null;
    pane.innerHTML = "";
    if (activeTab === "suggestions") suggestionsTab(pane);
    else threadsTab(pane);
  }
}

// ============================================================
//  الاقتراحات
// ============================================================
async function suggestionsTab(pane) {
  const chips = el("div", { class: "card", style: "display:flex;gap:6px;flex-wrap:wrap;padding:12px;margin-bottom:16px" });
  const body = el("div");

  [{ key: "all", label: "الكل" }, ...Object.entries(SUGG_STATUS).map(([k, v]) => ({ key: k, label: v.label }))]
    .forEach((f) => {
      const b = el("button", { class: `chip${f.key === statusFilter ? " active" : ""}`, text: f.label });
      b.addEventListener("click", () => {
        statusFilter = f.key;
        chips.querySelectorAll(".chip").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        load();
      });
      chips.append(b);
    });

  pane.append(chips, body);
  load();

  async function load() {
    body.innerHTML = "";
    body.append(spinner());
    try {
      const snap = await getDocs(query(collection(db, "suggestions"), orderBy("createdAt", "desc"), limit(200)));
      let all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const list = statusFilter === "all" ? all : all.filter((s) => s.status === statusFilter);

      body.innerHTML = "";

      // ملخص سريع
      body.append(el("div", { class: "grid grid-4", style: "margin-bottom:18px" },
        Object.entries(SUGG_STATUS).map(([k, v]) => {
          const n = all.filter((s) => s.status === k).length;
          return el("div", { class: "card stat-card" }, [
            el("div", { class: "stat-label", text: v.label }),
            el("div", { class: "stat-number", style: "font-size:26px", text: String(n) }),
          ]);
        })));

      if (!list.length) {
        body.append(emptyState("fa-lightbulb",
          all.length ? "مفيش اقتراحات في الفلتر ده" : "مفيش اقتراحات لسه",
          "لما شركة تبعت اقتراح، هيظهر هنا وهيوصلك إشعار."));
        return;
      }

      list.forEach((s) => {
        const st = SUGG_STATUS[s.status] || SUGG_STATUS.new;
        const item = el("div", { class: "card", style: "margin-bottom:12px" });

        item.append(el("div", { style: "display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap" }, [
          el("div", { style: "flex:1;min-width:220px" }, [
            el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap" }, [
              el("strong", { style: "font-size:14px", text: s.companyName || s.companyId }),
              s.source === "assistant"
                ? el("span", { class: "badge badge-blue", text: "من المساعد الذكي" }) : null,
            ]),
            el("p", { style: "line-height:1.9;font-size:14px", text: s.text }),
            el("small", { class: "text-muted", style: "display:block;margin-top:8px",
              text: `${s.userName || ""} · ${fmtTimeAgo(s.createdAt)}` }),
          ]),
          el("span", { class: `badge ${st.cls}`, text: st.label }),
        ]));

        if (s.adminNote) {
          item.append(el("div", { class: "ai-insight", style: "margin-top:12px",
            html: `<strong>ردك</strong>${esc(s.adminNote)}` }));
        }

        const actions = el("div", { style: "display:flex;gap:8px;margin-top:14px;flex-wrap:wrap" });
        [
          ["reviewing", "قيد الدراسة", "btn-light"],
          ["done", "تم التنفيذ", "btn-success"],
          ["rejected", "رفض", "btn-light"],
        ].forEach(([status, label, cls]) => {
          if (s.status === status) return;
          const b = el("button", { class: `btn ${cls} btn-sm`, text: label });
          b.addEventListener("click", () => changeStatus(s, status, load));
          actions.append(b);
        });
        item.append(actions);
        body.append(item);
      });
    } catch (e) {
      body.innerHTML = "";
      body.append(el("p", { class: "text-muted", text: "تعذّر التحميل: " + e.message }));
    }
  }
}

function changeStatus(sugg, status, onDone) {
  const note = field({
    label: "رسالة للشركة (اختياري)", name: "note", type: "textarea", rows: 3,
    value: sugg.adminNote || "",
    placeholder: status === "done" ? "الميزة اتضافت في الإصدار الجديد ✅"
      : status === "rejected" ? "شكراً لاقتراحك، بس مش هينفع دلوقتي لأن..."
      : "بنراجع الطلب وهنرد عليك قريب",
  });

  modal({
    title: `تغيير الحالة إلى: ${SUGG_STATUS[status].label}`,
    body: note.wrap,
    actions: [
      { label: "إلغاء", class: "btn-light", onClick: ({ close }) => close() },
      {
        label: "حفظ", class: "btn-primary",
        onClick: async ({ close, button }) => {
          button.disabled = true;
          try {
            await httpsCallable(fns, "updateSuggestion")({
              id: sugg.id, status, adminNote: note.input.value.trim(),
            });
            toast("تم التحديث — الشركة هيوصلها إشعار", "success");
            close();
            onDone?.();
          } catch (e) {
            button.disabled = false;
            toast("فشل التحديث: " + (e.message || ""), "error");
          }
        },
      },
    ],
  });
}

// ============================================================
//  محادثات الدعم
// ============================================================
function threadsTab(pane) {
  const container = el("div", { class: "inbox-container" });
  const listCol = el("div", { class: "inbox-list" });
  const listNode = el("div", { class: "chat-items" });
  listCol.append(listNode);

  const mainCol = el("div", { class: "inbox-main" });
  const headNode = el("div", { class: "chat-head" });
  const historyNode = el("div", { class: "chat-history" });
  const input = el("textarea", { rows: 1, placeholder: "اكتب ردك للشركة..." });
  const sendBtn = el("button", { class: "send-btn", html: '<i class="fas fa-paper-plane"></i>' });

  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 110) + "px";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  sendBtn.addEventListener("click", send);

  mainCol.append(headNode, historyNode,
    el("div", { class: "chat-input-area" }, [el("div", { class: "chat-input-row" }, [input, sendBtn])]));
  container.append(listCol, mainCol);
  pane.append(container);

  showEmpty();

  const q = query(collection(db, "supportThreads"), orderBy("lastMessageAt", "desc"), limit(100));
  unsubThreads = onSnapshot(q, (snap) => {
    trackSnapshot("supportThreads", snap);
    listNode.innerHTML = "";
    if (snap.empty) {
      listNode.append(el("p", { class: "text-muted", style: "padding:20px;text-align:center;font-size:13px",
        text: "مفيش محادثات دعم لسه." }));
      return;
    }
    snap.forEach((d) => {
      const t = { id: d.id, ...d.data() };
      const unread = t.unreadForAdmin || 0;
      const item = el("div", { class: `chat-item${activeThread === t.id ? " active" : ""}` }, [
        el("div", { class: "chat-item-top" }, [
          el("h4", {}, [
            el("span", { class: "name", text: t.companyName || t.companyId }),
            unread ? el("span", { class: "badge badge-red", text: String(unread) }) : null,
          ]),
          el("time", { text: fmtTimeAgo(t.lastMessageAt) }),
        ]),
        el("p", { text: t.lastMessage || "" }),
      ]);
      item.addEventListener("click", () => openThread(t));
      listNode.append(item);
    });
  }, (err) => {
    listNode.innerHTML = "";
    listNode.append(el("p", { class: "text-muted", style: "padding:16px", text: "تعذّر التحميل: " + err.message }));
  });

  function openThread(t) {
    activeThread = t.id;
    unsubMsgs?.();
    listNode.querySelectorAll(".chat-item").forEach((x) => x.classList.remove("active"));

    headNode.innerHTML = "";
    headNode.append(el("div", {}, [
      el("h3", { text: t.companyName || t.companyId }),
      el("div", { class: "meta", text: `آخر نشاط ${fmtTimeAgo(t.lastMessageAt)}` }),
    ]));
    const goBtn = el("button", { class: "btn btn-ghost btn-sm", html: '<i class="fas fa-right-to-bracket"></i> دخول على الشركة' });
    goBtn.addEventListener("click", async () => {
      await window.nexoSwitchTenant(t.companyId);
      toast(`دلوقتي شغال على: ${t.companyName}`, "success");
    });
    headNode.append(goBtn);

    httpsCallable(fns, "markSupportRead")({ companyId: t.companyId }).catch(() => {});

    historyNode.innerHTML = "";
    historyNode.append(spinner());

    const mq = query(collection(db, "supportThreads", t.id, "messages"), orderBy("createdAt"), limit(200));
    unsubMsgs = onSnapshot(mq, (snap) => {
      historyNode.innerHTML = "";
      snap.forEach((d) => {
        const m = d.data();
        const mine = m.from === "admin";
        historyNode.append(el("div", { class: `message ${mine ? "msg-agent" : "msg-customer"}` }, [
          el("div", { style: "white-space:pre-wrap", text: m.text || "" }),
          el("time", { text: `${mine ? "أنت" : m.userName || "الشركة"} · ${fmtDateTime(m.createdAt)}` }),
        ]));
      });
      historyNode.scrollTop = historyNode.scrollHeight;
    });
  }

  async function send() {
    const text = input.value.trim();
    if (!text || !activeThread) return toast("اختار محادثة الأول", "warn");
    sendBtn.disabled = true;
    try {
      await httpsCallable(fns, "sendSupportMessage")({ text, companyId: activeThread });
      input.value = "";
      input.style.height = "auto";
    } catch (e) {
      toast("فشل الإرسال: " + (e.message || ""), "error");
    }
    sendBtn.disabled = false;
  }

  function showEmpty() {
    historyNode.innerHTML = "";
    historyNode.append(el("div", { style: "margin:auto;text-align:center;color:var(--muted)" }, [
      el("i", { class: "fas fa-headset", style: "font-size:40px;color:#d7dbe8;display:block;margin-bottom:12px" }),
      el("p", { text: "اختار محادثة من القائمة" }),
    ]));
  }
}

export function destroy() {
  unsubThreads?.(); unsubMsgs?.();
  unsubThreads = unsubMsgs = null;
  activeTab = "suggestions";
  statusFilter = "all";
  activeThread = null;
}
