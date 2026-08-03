# Changelog — Classwork Hub

All notable changes, newest first. This is the historical record; for
**current architecture, setup, and what's still pending**, see
`PROJECT_PROGRESS.md`.

## Round 17 — Chat routing, mandatory work-type tag, safer account reset, Premium Showcase theme
- **PDF viewer bug diagnosed (no code fix needed)** — upload code already used Cloudinary's `/auto/upload` endpoint correctly. The "Failed to load PDF document" / HTTP 401 in the reported screenshot matches Cloudinary's account-level security default that blocks PDF/ZIP delivery unless explicitly allowed in the Cloudinary Console (Settings → Security). This is a one-time manual Cloudinary setting, not an app bug.
- Topbar notification bell now links straight to `activity.html?tab=chat` on every page, instead of landing on the Activity Log tab. `activity.js` reads the `?tab=` query param on load and auto-selects the requested tab. Sidebar "Activity" link is unchanged (still opens the Log tab).
- Confirmed 48-hour chat auto-expiry (`expireAt`, client-side filtered) was already correctly implemented in Round 16 — no change needed.
- Classwork/Homework tagging on upload is now **mandatory**, not optional: the type pill selection no longer clears back to "none" on re-click, and the upload button blocks (with an inline message + shake animation) until one is picked.
- Danger Zone account reset: replaced the two back-to-back native `confirm()` popups (which looked identical enough to click through blindly) with a single custom modal — a large glowing red headline for the irreversible reset, separated visually from a smaller boxed checkbox for "also delete my uploaded work" (unchecked by default, same behavior as before).
- New **Premium Showcase** appearance theme (4th option alongside Dark Cyan/Light/Monochrome) — warm dark/amber token set in `css/theme.css` (and mirrored in the admin panel's self-contained inline styles for parity). Dashboard subject cards get a dedicated rounded/glowing/hover-zoom treatment under this theme, with a deterministic emoji "popped" above each card, modeled on the furniture-showcase reference image provided.

## Round 16 — Milestone 3: PDF uploads, navbar redesign, unread badges, per-image management, admin cross-class browsing
- PDF upload support alongside photos (drag-and-drop included). PDFs open in the browser's native viewer — no bundler in this stack, so a React PDF library wasn't applicable; the native viewer gives zoom/page-nav/download/fullscreen for free.
- New `uploads[].files[]` metadata array (`{url, isPdf, name}`) for correct mixed-file rendering; legacy flat `photoURLs` kept in sync alongside it.
- Per-file management in My Uploads: move/replace/remove one photo or PDF inside an upload, not just delete-the-whole-thing. New-format uploads only.
- Horizontal top navbar cluster (search shortcut, theme toggle, notification bell, profile dropdown) added to all 9 app pages — sidebar kept for full navigation.
- Unread badge dots (chat + activity + dashboard) — existence checks, not counts, so no composite indexes needed. Clears per-page via `lastSeenChat`/`lastSeenActivity`/`lastSeenUploads` on the user's own profile doc.
- Admin panel: new "Browse Classes" tab — any school → any class → its subjects, students, and last 10 uploads per subject, without joining. No rules change needed (admin already had universal read access).

## Round 15 — Admin superpowers, account reset, avatar picker, Contact Admin, chat auto-expiry
- Admin theme bug fixed (admin panel's own `.sidebar`/`.topbar` had hardcoded colors instead of theme variables).
- Admin superpowers on the main site (for `role: "admin"` accounts): excluded from leaderboard, can delete any student's upload, can moderate any chat message — all within a class the admin has actually joined.
- Contact Admin (Settings → About): WhatsApp deep link, email link, in-app message box → new `adminMessages` collection with an admin panel "Messages" tab.
- "Start Fresh" account reset (Settings → Danger Zone): wipes the user's own profile back to onboarding, with a choice to also strip their uploads from the class or leave them visible.
- Avatar picker (Google photo / custom upload / colored initials), available in onboarding and Settings.
- Class Chat messages auto-expire after 48 hours at the application level (`expireAt` field, hidden client-side past that mark) — not dependent on Firestore TTL, though an optional TTL policy can be added in Google Cloud Console for actual background deletion.

## Round 14 — Real-time Class Chat, delete-my-upload, first-run wizard
- Real-time Class Chat: send/edit/delete own messages, typing indicator.
- Students can delete their own uploads from My Uploads.
- First-run welcome wizard: name, theme, avatar, school — replaces the old bare school-select-only onboarding.
- Fixed a bug where picking a second batch of upload photos silently wiped out the first batch instead of appending to it.

## Round 13 — Subject delete, Activity Log, theme/underline fixes
- Any classmate (not just admin) can delete a subject from the edit-subject modal, with a confirm step.
- New Activity Log page: who added/edited/deleted a subject or made an upload, with real profile names, append-only.
- Fixed the theme switcher not actually restyling the sidebar/topbar (hardcoded colors instead of theme variables) and removed stray link underlines site-wide.

## Hotfix #2 — Duplicate school data isolation + cache-busting
- Fixed cross-school data bleed when two schools shared a similar name; added cache-busting query params to force browsers to fetch updated JS/CSS after each deploy.

## Hotfix — Signup/class-switch permission-denied bug
- Fixed a `js/school-select.js` bug causing "Missing or insufficient permissions" when signing up or switching classes.

## Round 12 — Theming system, redesigned Settings, Universal Search
- Three-theme system (Dark Cyan / Light / Monochrome), synced to Firestore so it follows the user across devices.
- Settings page redesigned into tabs: Account / Appearance / Notifications / Privacy / About.
- Universal Search page across subjects, uploads, and dates.

## Round 11 — Multi-upload fixes, Work section, leaderboard fix, off-canvas nav
- Multiple photos per submission, collaborative entries (several classmates can add to the same subject/day).
- "Today's Work" dashboard redesign; Homework tracker added as its own section.
- Off-canvas sidebar navigation (shared `js/nav.js`) replacing the earlier per-page nav markup.
- Leaderboard XP calculation bug fixed.

## FINAL (initial consolidated baseline)
- Core app: Google Sign-In, school/class selection with admin approval workflow, Dashboard upload flow (photo compression → Cloudinary → Firestore), Subjects browsing, My Uploads, Homework, Leaderboard, Profile, XP/streak/rank system, admin panel (schools/classes/subjects/users), Firestore rules enforcing class-scoped access with admin override.
- Switched image storage from Firebase Storage to Cloudinary (unsigned upload preset) to stay on free tiers — Storage rules locked to `allow read, write: if false` since Storage is unused.
- Popup-based Google Sign-In finalized over redirect-based auth, which broke sign-in-after-sign-out on mobile Brave due to third-party-cookie handling.
