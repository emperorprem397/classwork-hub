// Shared helpers used by dashboard.js, subjects.js, myuploads.js, leaderboard.js, profile.js
// so rank/XP/date/type-badge logic isn't duplicated across pages.

export const XP_UPLOAD          = 10; // any photo added to an existing day's entry
export const XP_FIRST_OF_DAY    = 5;  // bonus for being the one who starts today's entry for a subject
export const XP_STREAK_TICK     = 2;  // once per day, on a user's first upload of that day (any subject)

export const RANKS = [
  { name: "Bronze",   min: 0 },
  { name: "Silver",   min: 100 },
  { name: "Gold",     min: 300 },
  { name: "Platinum", min: 700 },
];

export function calcRank(xp) {
  let rank = RANKS[0].name;
  for (const r of RANKS) {
    if (xp >= r.min) rank = r.name;
  }
  return rank;
}

export function nextRankInfo(xp) {
  const idx = RANKS.findIndex((r, i) => xp >= r.min && (i === RANKS.length - 1 || xp < RANKS[i + 1].min));
  if (idx === RANKS.length - 1) {
    return { current: RANKS[idx].name, next: null, xpToNext: 0, progress: 1 };
  }
  const cur = RANKS[idx];
  const nxt = RANKS[idx + 1];
  const span = nxt.min - cur.min;
  const progress = Math.min(1, (xp - cur.min) / span);
  return { current: cur.name, next: nxt.name, xpToNext: nxt.min - xp, progress };
}

// Local (not UTC) date id, e.g. "2026-07-19" — matches what a student
// physically experiences as "today," which matters since this is an
// India-based classroom tool and UTC dates would flip at 5:30am IST.
export function todayId() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Given a "YYYY-MM-DD" id from yesterday, used for streak continuity checks.
export function yesterdayId() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatDateLabel(dateId) {
  const [y, m, d] = dateId.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

// Given a signed day offset from today (0 = today, -1 = yesterday, etc.),
// returns "YYYY-MM-DD" in local time. Generic version of yesterdayId(),
// used by the Subjects history page to build a rolling week view.
export function dateIdOffset(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function shortDayLabel(dateId) {
  const [y, m, d] = dateId.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { weekday: "short" });
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// ---------- Upload type metadata (NEW) ----------
// A single upload can optionally be tagged as Classwork or Homework, and
// given a short optional title (e.g. "Chapter 5 — Photosynthesis notes").
// Both are fully optional — students can leave them blank.
export const TYPE_META = {
  classwork: { icon: "📓", label: "Classwork" },
  homework:  { icon: "📝", label: "Homework" },
};

export function typeBadgeHtml(type) {
  if (!type || !TYPE_META[type]) return "";
  const t = TYPE_META[type];
  return `<span class="badge badge-cyan type-badge">${t.icon} ${t.label}</span>`;
}

// ---------- Activity log (NEW) ----------
// A lightweight, append-only feed shared by the whole class — every subject
// create/edit/delete and every upload writes one small doc here so everyone
// (admin included) can see who did what, using the same name shown on their
// profile. This is intentionally simple (no chat, no reactions, no editing
// of entries) — a fuller Class Chat is a separate, much bigger feature to
// scope later if wanted.
export const ACTIVITY_META = {
  subject_created: { icon: "➕", verb: "added the subject" },
  subject_edited:  { icon: "✎",  verb: "edited the subject" },
  subject_deleted: { icon: "🗑️", verb: "deleted the subject" },
  upload:          { icon: "📤", verb: "uploaded work for" },
};

export async function logActivity(db, { schoolId, classId, uid, name, type, subjectName, detail }) {
  try {
    const { collection, addDoc, serverTimestamp } = await import(
      "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js"
    );
    const activityCol = collection(db, "schools", schoolId, "classes", classId, "activity");
    await addDoc(activityCol, {
      type,
      actorUid: uid,
      actorName: name || "Classmate",
      subjectName: subjectName || "",
      detail: detail || "",
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    // Never let a logging failure block the real action (subject edit,
    // upload, etc.) that triggered it — this is best-effort telemetry.
    console.error("Activity log write failed:", err);
  }
}

export function timeAgo(date) {
  if (!date) return "";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
