// ============================================================
//  جرس الإشعارات — عرض لحظي وتعليم كمقروء
// ============================================================
import {
  db, collection, doc, updateDoc, deleteDoc, onSnapshot,
  query, orderBy, limit, writeBatch, trackSnapshot,
} from "./firebase.js";
import { session } from "./auth.js";
import { el, esc, fmtTimeAgo, toast } from "./ui.js";

let unsub = null;
let items = [];

const COLORS = {
  primary: "var(--primary)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger:  "var(--danger)",
};

export function initNotifications({ button, badge, panel }) {
  const listNode = el("div", { class: "notif-list" });
  const head = el("div", { class: "notif-head" }, [
    el("strong", { text: "الإشعارات" }),
    el("button", { class: "chip", text: "تعليم الكل كمقروء", onClick: markAllRead }),
  ]);
  panel.append(head, listNode);

  button.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("show");
  });
  document.addEventListener("click", (e) => {
    if (!panel.contains(e.target)) panel.classList.remove("show");
  });

  const q = query(
    collection(db, "users", session.user.uid, "notifications"),
    orderBy("createdAt", "desc"), limit(40));

  unsub = onSnapshot(q, (snap) => {
    trackSnapshot("notifications", snap);
    items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    draw(listNode);

    const unread = items.filter((n) => !n.read).length;
    badge.textContent = unread > 99 ? "99+" : unread;
    badge.style.display = unread ? "flex" : "none";
    button.classList.toggle("has-unread", unread > 0);
  }, (err) => {
    console.warn("notifications:", err.message);
    listNode.innerHTML = "";
    listNode.append(el("p", { class: "notif-empty", text: "تعذّر تحميل الإشعارات." }));
  });

  function draw(node) {
    node.innerHTML = "";
    if (!items.length) {
      node.append(el("div", { class: "notif-empty" }, [
        el("i", { class: "fas fa-bell-slash" }),
        el("p", { text: "مفيش إشعارات لسه" }),
      ]));
      return;
    }

    items.forEach((n) => {
      const row = el("div", { class: `notif-item${n.read ? "" : " unread"}` }, [
        el("div", { class: "notif-icon", style: `background:${COLORS[n.color] || COLORS.primary}1a;color:${COLORS[n.color] || COLORS.primary}` },
          [el("i", { class: `fas ${n.icon || "fa-bell"}` })]),
        el("div", { class: "notif-text" }, [
          el("strong", { text: n.title || "" }),
          n.body ? el("p", { text: n.body }) : null,
          el("time", { text: fmtTimeAgo(n.createdAt) }),
        ]),
      ]);

      row.addEventListener("click", async () => {
        if (!n.read) await markRead(n.id);
        panel.classList.remove("show");
        if (n.link) location.hash = n.link.replace(/^#/, "");
      });

      const del = el("button", { class: "notif-del", html: '<i class="fas fa-xmark"></i>', title: "حذف" });
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        try { await deleteDoc(doc(db, "users", session.user.uid, "notifications", n.id)); }
        catch { /* تجاهل */ }
      });
      row.append(del);

      node.append(row);
    });
  }
}

async function markRead(id) {
  try {
    await updateDoc(doc(db, "users", session.user.uid, "notifications", id), { read: true });
  } catch (e) { console.warn(e); }
}

async function markAllRead(e) {
  e?.stopPropagation();
  const unread = items.filter((n) => !n.read);
  if (!unread.length) return;
  try {
    const batch = writeBatch(db);
    unread.slice(0, 300).forEach((n) =>
      batch.update(doc(db, "users", session.user.uid, "notifications", n.id), { read: true }));
    await batch.commit();
  } catch (err) { toast("تعذّر التحديث: " + err.message, "error"); }
}

export function destroyNotifications() {
  unsub?.();
  unsub = null;
  items = [];
}
