# Classwork Hub — Progress Tracker

Live site: https://classwork-hub.vercel.app/
Stack: Firebase Auth (Google, popup) + Firestore + Cloudinary (images) + GitHub → Vercel hosting.

Refer to this file before making changes — it's the single source of truth for what's done, what's pending, and what's next.

---

## ✅ Completed

**Auth & onboarding**
- Google Sign-In (popup-based — matches the admin panel's working pattern; redirect-based auth was tried and reverted, see "Decisions" below)
- School-select flow (search/select school, join a class)
- Admin panel: create schools, classes, subjects; ban/unban users

**Core class flow**
- Dashboard — "Today's Work": one card per subject, shows upload status, opens upload modal
- Upload flow: pick up to 6 photos → client-side compress (max 1600px, JPEG q0.82) → upload to Cloudinary (unsigned preset) → URLs saved to Firestore
- **NEW — optional metadata per upload:** student can tag a submission as Classwork / Homework and add a short title (e.g. "Chapter 5 — Photosynthesis notes"). Both fully optional, no validation blocks a bare photo-only upload.
- Collaborative entries: multiple classmates can add photos to the same subject/day; each submission (with its own type/title) is tracked individually, not just merged into one flat photo list
- Subjects page — browse the last 7 days per subject, view any day's uploads
- My Uploads — personal upload history, mirrored via a private per-user subcollection
- Homework tracker — separate from classwork uploads; post an item (subject + description + due date), classmates check it off individually
- Leaderboard — ranked by XP within the student's own class
- Profile — XP, streak, rank progress
- XP / rank / streak system: +10 XP per upload, +5 bonus for being first on a subject that day, +2 streak tick once per day; ranks Bronze → Silver → Gold → Platinum

**Access control (Firestore rules)**
- Students can only read/write within their own school + class
- Admin has read/write access everywhere
- Verified: this already satisfies "classwork should only be visible to the uploader's class + admin" — no rules change was needed for the metadata update

**Infra decisions**
- Switched from Firebase Storage to Cloudinary for images — keeps the project on free tiers; Firestore stores only the resulting URLs
- Firebase Storage rules are locked to `allow read, write: if false` since Storage isn't used at all

---

## 🔧 Decisions / issues resolved (so we don't redo them)

- **Auth method:** Popup-based Google Sign-In is final. Redirect-based auth was tried to fix an unrelated "Something went wrong signing in" error, but that error was actually a Firestore-rules mix-up (Storage rules pasted into the Firestore rules tab), not a popup problem. Redirect auth introduced a real regression — it needs a background iframe handshake with `classwork-hub.firebaseapp.com`, which triggered Brave's third-party-cookie consent dialog and broke sign-in-after-sign-out on mobile Brave. Reverted to popup, matching the admin panel's approach, which never had this issue.
- **Data model for entries:** `entries/{date}` is one shared doc per subject per day; `uploadedBy` / `uploaderNames` / flat `photoURLs` are kept for backward compatibility with older entries, and a new `uploads` array now holds one record per submission `{ uid, name, type, title, photoURLs, uploadedAt }` so per-student metadata doesn't get flattened away.
- **Chapters layer** was dropped from the hierarchy for MVP (School → Class → Subject → Date, not → Chapter → Date) — can be reintroduced later if needed.

---

## ⏳ Pending / not built yet

- Comments on uploads
- Notifications
- Search across uploads
- Composite Firestore index for the leaderboard query (`schoolId` + `classId` + `xp`) — auto-creates the first time the leaderboard errors; click the link Firestore prints in the console
- Any analytics in the admin panel beyond the basics

## ➡️ Next step

Not yet decided — ask Prem what to prioritize from the "Pending" list above, or whether something new has come up.
