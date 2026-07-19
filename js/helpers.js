// Shared helpers used by dashboard.js, leaderboard.js, profile.js
// so rank/XP/date logic isn't duplicated three times.

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

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
