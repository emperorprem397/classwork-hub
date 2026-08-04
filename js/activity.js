import { auth, db } from "./firebase-config.js";
import { syncThemeFromCloud } from "./theme.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, query, orderBy, limit, limitToLast, getDocs, addDoc,
  onSnapshot, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { escapeHtml, ACTIVITY_META, timeAgo } from "./helpers.js";
import { confirmDialog } from "./confirm-dialog.js";

const userPhoto    = document.getElementById("userPhoto");
const userNameEl   = document.getElementById("userName");
const classLabel   = document.getElementById("classLabel");
const loadingMsg   = document.getElementById("loadingMsg");
const activityList = document.getElementById("activityList");
const emptyState   = document.getElementById("emptyState");
const signOutBtn   = document.getElementById("signOutBtn");
const refreshBtn   = document.getElementById("refreshBtn");

const tabButtons     = document.querySelectorAll(".activity-tab");
const panels         = { log: document.getElementById("panel-log"), chat: document.getElementById("panel-chat") };
const chatMessagesEl = document.getElementById("chatMessages");
const chatLoadingMsg = document.getElementById("chatLoadingMsg");
const typingIndicator = document.getElementById("typingIndicator");
const chatInput      = document.getElementById("chatInput");
const chatSendBtn    = document.getElementById("chatSendBtn");

signOutBtn.addEventListener("click", () => signOut(auth));

let currentUser = null;
let currentProfile = null;
let isAdminUser = false;
let chatUnsub = null;
let typingUnsub = null;
let typingUsers = {}; // uid -> { name, tsMillis }
let lastTypingWriteAt = 0;

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }

  currentUser = user;
  userPhoto.src = user.photoURL || "";
  userNameEl.textContent = user.displayName || user.email;
  syncThemeFromCloud(db, user.uid);

  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) { window.location.href = "school-select.html"; return; }
  currentProfile = snap.data();
  isAdminUser = currentProfile.role === "admin";

  if (!currentProfile.schoolId || !currentProfile.classId) {
    window.location.href = "school-select.html";
    return;
  }

  classLabel.textContent = `Class ${currentProfile.classId}`;
  await loadActivity();
  startChatListener();
  startTypingListener();

  // Clears the notif bell + sidebar Activity dot — best-effort, never
  // blocks the page if it fails.
  updateDoc(doc(db, "users", user.uid), {
    lastSeenActivity: serverTimestamp(),
    lastSeenChat: serverTimestamp(),
  }).catch((err) => console.error("lastSeen sync failed:", err));
});

// ---------- Tab switching ----------
function switchToTab(tab) {
  const btn = document.querySelector(`.activity-tab[data-tab="${tab}"]`);
  if (!btn) return;
  tabButtons.forEach((b) => b.classList.toggle("active", b === btn));
  Object.entries(panels).forEach(([key, el]) => el.classList.toggle("active", key === tab));
  if (tab === "chat") {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    chatInput.focus();
  }
}
tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => switchToTab(btn.dataset.tab));
});

// Deep-link support: the topbar "Class Chat" bell (and anything else) can
// link straight to activity.html?tab=chat to land on the Chat tab instead
// of defaulting to the Activity Log.
const requestedTab = new URLSearchParams(window.location.search).get("tab");
if (requestedTab === "chat") switchToTab("chat");

// ==========================================================
// Activity Log (unchanged from the previous round)
// ==========================================================
refreshBtn.addEventListener("click", loadActivity);

async function loadActivity() {
  loadingMsg.hidden = false;
  loadingMsg.textContent = "Loading activity…";
  emptyState.hidden = true;
  activityList.innerHTML = "";

  try {
    const { schoolId, classId } = currentProfile;
    const activityCol = collection(db, "schools", schoolId, "classes", classId, "activity");
    const snap = await getDocs(query(activityCol, orderBy("createdAt", "desc"), limit(100)));

    loadingMsg.hidden = true;

    if (snap.empty) {
      emptyState.hidden = false;
      return;
    }

    snap.docs.forEach((d) => {
      activityList.appendChild(renderActivityItem(d.data()));
    });
  } catch (err) {
    console.error(err);
    loadingMsg.hidden = false;
    loadingMsg.textContent = "Couldn't load activity — check your connection and refresh.";
  }
}

function renderActivityItem(item) {
  const meta = ACTIVITY_META[item.type] || { icon: "•", verb: "did something with" };
  const row = document.createElement("div");
  row.className = "activity-item glass";

  const when = item.createdAt?.toDate ? timeAgo(item.createdAt.toDate()) : "";

  row.innerHTML = `
    <span class="activity-icon">${meta.icon}</span>
    <div class="activity-body">
      <div class="activity-line">
        <b>${escapeHtml(item.actorName || "Classmate")}</b>
        ${meta.verb}
        <b>${escapeHtml(item.subjectName || "")}</b>
        ${item.detail ? escapeHtml(item.detail) : ""}
      </div>
      <div class="activity-time">${escapeHtml(when)}</div>
    </div>
  `;
  return row;
}

// ==========================================================
// Class Chat — real-time. Uses onSnapshot (a live subscription), not a
// one-time read, so every classmate's browser gets pushed new messages
// the moment they're written — there's no polling and no manual refresh
// needed. In practice this lands well under a second on a normal
// connection, similar to WhatsApp Web — Firestore's realtime channel is
// the same mechanism behind both.
// ==========================================================
function chatCol() {
  const { schoolId, classId } = currentProfile;
  return collection(db, "schools", schoolId, "classes", classId, "messages");
}
function typingCol() {
  const { schoolId, classId } = currentProfile;
  return collection(db, "schools", schoolId, "classes", classId, "typing");
}

function startChatListener() {
  const q = query(chatCol(), orderBy("createdAt", "asc"), limitToLast(200));
  chatUnsub = onSnapshot(
    q,
    (snap) => {
      chatLoadingMsg.hidden = true;
      const wasNearBottom =
        chatMessagesEl.scrollHeight - chatMessagesEl.scrollTop - chatMessagesEl.clientHeight < 120;

      chatMessagesEl.querySelectorAll(".chat-msg, .chat-empty").forEach((el) => el.remove());

      if (snap.empty) {
        const empty = document.createElement("p");
        empty.className = "chat-empty loading-msg";
        empty.textContent = "No messages yet — say hi to your class.";
        chatMessagesEl.appendChild(empty);
        return;
      }

      // Belt-and-suspenders: even once Firestore's own TTL policy is enabled
      // (see PROJECT_PROGRESS.md — that's a one-time Console step, not
      // instant), TTL deletion can lag by a while, so also hide anything
      // past its 48-hour mark on the client immediately.
      const now = Date.now();
      const visibleDocs = snap.docs.filter((d) => {
        const expireAt = d.data().expireAt;
        return !(expireAt?.toMillis && expireAt.toMillis() < now);
      });

      if (!visibleDocs.length) {
        const empty = document.createElement("p");
        empty.className = "chat-empty loading-msg";
        empty.textContent = "No messages yet — say hi to your class.";
        chatMessagesEl.appendChild(empty);
        return;
      }

      visibleDocs.forEach((d) => chatMessagesEl.appendChild(renderChatMessage(d.id, d.data())));

      if (wasNearBottom) chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    },
    (err) => {
      console.error(err);
      chatLoadingMsg.hidden = false;
      chatLoadingMsg.textContent = "Couldn't load chat — check your connection.";
    }
  );
}

function renderChatMessage(id, m) {
  const mine = m.uid === currentUser.uid;
  const canModerate = mine || isAdminUser; // admin can edit/delete anyone's message
  const wrap = document.createElement("div");
  wrap.className = `chat-msg${mine ? " mine" : ""}`;

  const when = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "…";

  wrap.innerHTML = `
    <img class="chat-avatar" src="${m.photoURL || ""}" alt="" />
    <div class="chat-bubble-col">
      ${!mine ? `<div class="chat-name">${escapeHtml(m.name || "Classmate")}${isAdminUser && !mine ? ` <span class="admin-tag">admin view</span>` : ""}</div>` : ""}
      <div class="chat-bubble" data-text-el></div>
      <div class="chat-meta-row">
        <span>${when}${m.editedAt ? " · edited" : ""}</span>
        ${canModerate ? `
          <button class="chat-msg-action" data-action="edit">Edit</button>
          <button class="chat-msg-action" data-action="delete">Delete</button>
        ` : ""}
      </div>
    </div>
  `;

  const textEl = wrap.querySelector("[data-text-el]");
  textEl.textContent = m.text || ""; // textContent, not innerHTML — no HTML injection risk from message text

  if (canModerate) {
    wrap.querySelector('[data-action="delete"]').addEventListener("click", () => deleteMessage(id));
    wrap.querySelector('[data-action="edit"]').addEventListener("click", () => beginEditMessage(id, wrap, m.text || ""));
  }

  return wrap;
}

function beginEditMessage(id, wrap, currentText) {
  const bubbleCol = wrap.querySelector(".chat-bubble-col");
  const bubble = wrap.querySelector(".chat-bubble");
  const original = bubble.outerHTML;

  const input = document.createElement("input");
  input.className = "chat-edit-input";
  input.value = currentText;
  bubble.replaceWith(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  async function save() {
    const newText = input.value.trim();
    if (!newText) { cancel(); return; }
    try {
      await updateDoc(doc(chatCol(), id), { text: newText.slice(0, 2000), editedAt: serverTimestamp() });
    } catch (err) {
      console.error(err);
      alert("Couldn't save that edit — check your connection and try again.");
    }
  }
  function cancel() {
    input.replaceWith(document.createRange().createContextualFragment(original));
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); save(); }
    if (e.key === "Escape") cancel();
  });
  input.addEventListener("blur", save);
}

async function deleteMessage(id) {
  const confirmed = await confirmDialog({
    title: "Delete this message?",
    detail: "This removes it from the class chat for everyone. This can't be undone.",
    confirmLabel: "Yes, delete message",
  });
  if (!confirmed) return;
  try {
    await deleteDoc(doc(chatCol(), id));
  } catch (err) {
    console.error(err);
    alert("Couldn't delete — check your connection and try again.");
  }
}

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = "";
  chatSendBtn.disabled = true;
  try {
    await addDoc(chatCol(), {
      uid: currentUser.uid,
      name: currentUser.displayName || currentUser.email,
      photoURL: currentUser.photoURL || "",
      text: text.slice(0, 2000),
      createdAt: serverTimestamp(),
      editedAt: null,
      // Auto-expires 48 hours from now. Firestore's own TTL policy (a
      // one-time setup step in the Cloud Console, on this exact field name)
      // actually deletes the doc in the background; the client-side filter
      // above hides it immediately either way, so nobody waits on that.
      expireAt: Timestamp.fromMillis(Date.now() + 48 * 60 * 60 * 1000),
    });
    // Clear our own typing flag immediately after sending, rather than
    // waiting for it to age out — feels snappier to whoever's watching it.
    deleteDoc(doc(typingCol(), currentUser.uid)).catch(() => {});
  } catch (err) {
    console.error(err);
    chatInput.value = text; // give it back so nothing's lost
    alert("Couldn't send — check your connection and try again.");
  } finally {
    chatSendBtn.disabled = false;
  }
}
chatSendBtn.addEventListener("click", sendMessage);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); sendMessage(); }
});

// ---------- Typing indicator ----------
// Writes at most once every ~2s while the person is actively typing (not
// on every keystroke, to keep writes cheap) and lets the doc's timestamp
// simply go stale rather than deleting it on every pause — other clients
// treat anything older than 5s as "no longer typing."
chatInput.addEventListener("input", () => {
  const now = Date.now();
  if (now - lastTypingWriteAt < 2000) return;
  lastTypingWriteAt = now;
  setDoc(doc(typingCol(), currentUser.uid), {
    name: currentUser.displayName || currentUser.email,
    ts: serverTimestamp(),
  }).catch((err) => console.error("Typing indicator write failed:", err));
});

function startTypingListener() {
  typingUnsub = onSnapshot(typingCol(), (snap) => {
    typingUsers = {};
    snap.docs.forEach((d) => {
      if (d.id === currentUser.uid) return;
      const data = d.data();
      const tsMillis = data.ts?.toMillis ? data.ts.toMillis() : 0;
      typingUsers[d.id] = { name: data.name || "Someone", tsMillis };
    });
    renderTypingIndicator();
  });
}

function renderTypingIndicator() {
  const now = Date.now();
  const active = Object.values(typingUsers).filter((u) => now - u.tsMillis < 5000);
  if (!active.length) {
    typingIndicator.hidden = true;
    return;
  }
  const names = active.map((u) => u.name);
  const text = names.length === 1
    ? `${names[0]} is typing…`
    : `${names.slice(0, 2).join(", ")}${names.length > 2 ? ` +${names.length - 2} more` : ""} are typing…`;
  typingIndicator.textContent = text;
  typingIndicator.hidden = false;
}

// Re-check every 2s so the indicator disappears on its own once someone
// stops typing, even if no new Firestore snapshot arrives in the meantime.
setInterval(renderTypingIndicator, 2000);
