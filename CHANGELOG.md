# Changelog — Classwork Hub

All notable changes, newest first. This is the historical record; for
**current architecture, setup, and what's still pending**, see
`PROJECT_PROGRESS.md`.

## Round 22 — Real subject cover photos + custom cover upload, profile photo crop/preview
- **Shared image cropper** (`js/cropper.js` + `css/cropper.css`, new) — a self-contained "move & zoom" modal (drag to reposition, slider or scroll-wheel to zoom) that shows exactly what will be saved before it uploads anywhere. No HTML markup needed per-page; it builds and tears down its own DOM and injects its own stylesheet on first use.
- **Profile photo fixed** — `settings.js` (Settings → Appearance → avatar picker) and `welcome.js` (onboarding wizard's photo step) both now route an uploaded photo through the cropper (circle preview) before it goes to Cloudinary, instead of silently squashing whatever ratio was picked to fit a box. This was the "profile photo looks pinched" issue.
- **Dashboard subject cards now show real photography** — `helpers.js` gained `getSubjectCoverImage(name, customURL)`, a keyword-matched lookup (Chemistry/Physics/Maths/English/Biology/Computer Science/History/Geography/Art/Music/Economics/Hindi-Sanskrit/PE/Science) with a deterministic generic-study-photo fallback for anything unmatched. Renders as a real `<img>` over the existing gradient strip; if a photo URL ever fails to load it's removed on `onerror` and the gradient shows through underneath, so a bad link degrades gracefully instead of breaking the card.
- **Custom subject cover photo** — Add Subject and Edit Subject modals (`dashboard.html`/`dashboard.js`) both gained a square cover-photo picker (same cropper, square mode) with a live preview and a "Remove" option that reverts to the default keyword photo. Stored as `coverURL` on the subject doc (`null` = use the default).
- Cross-checked every `getElementById` call in the touched JS files against their HTML — zero mismatches. All touched JS files pass a Node syntax check.

**Known caveat:** the default keyword-matched photo URLs are Unsplash CDN links written from memory — they weren't fetched/verified in this session (no live internet access here). Worth eyeballing a handful of subjects after deploying; anything that 404s just falls back to the plain gradient automatically, so nothing user-facing breaks, but a subject or two might look plainer than intended until swapped for a verified URL or a class-picked custom cover.

## Round 21 — Profile & Search restyled
- **Profile** — hero card polished: photo now gets a soft ring instead of a hardcoded-cyan border, stat numbers switched to the neutral text token, and the rank progress bar's track color (previously a hardcoded `rgba(255,255,255,.06)` that would've nearly vanished against the Soft Light background) now uses theme tokens and sits in its own subtly-shaded block.
- **Search** — search bar restyled to a pill shape with card shadow instead of a sharp-cornered bordered box; each result category (Subjects/Teachers/Homework/Uploads/Classmates) now renders as a labeled rounded container with hairline-divided rows, matching Subjects/My Uploads/Homework/Leaderboard, instead of individually bordered floating result cards.

## Round 20 — Homework & Leaderboard restyled
- **Homework** — all three tabs (Classwork Uploads, Homework Uploads, Assignments) now use the same "large rounded parent container" layout as Subjects/My Uploads: one shell per tab holding hairline-divided rows instead of separate floating cards. Overdue-assignment red tint and checkbox colors switched from hardcoded values to shared theme tokens.
- **Leaderboard** — same container treatment; the "you" row now gets a subtle highlighted background instead of a colored border/glow, and 2nd/3rd-place medal colors switched to theme-neutral tones so they read correctly in both Matte Dark and Soft Light instead of being tuned only for the old dark-cyan theme.

## Round 19 — Subjects & My Uploads restyled, old-accent color cleanup
- **Subjects** and **My Uploads** now use the "large rounded parent container" layout from the design brief — one `.glass` shell holding all rows, hairline dividers between them, instead of separate floating bordered cards per row. Subjects rows also got the same small circular subject icon used on the Dashboard cards.
- Swept the whole codebase for the old hardcoded cyan accent (`rgba(34,211,238,…)` / `#22d3ee` / `#67e8f9`) that a few pages still had baked in directly instead of reading the shared tokens — found and retinted 9 spots: Chat's own-message bubble, Search's match highlight (now gold, reads better as a "highlighter" than monochrome would), the Settings toggle switch, three spots in School Selection, the type-pill selected state and drag-and-drop highlight in the upload modal, and two admin-panel button hover shadows. All now theme-correct in both Matte Dark and Soft Light.

## Round 18 — Official design system foundation: Matte Dark + Soft Light (in progress)
- **Theme system reduced to exactly two permanent themes** — "Matte Dark" (default) and "Soft Light" — replacing the previous four (Dark Cyan/Light/Monochrome/Premium). Same token names in `css/theme.css`, so nothing else needed to change to re-skin. Swatch rows updated everywhere they appear: Settings, Admin panel, and the Welcome wizard's Appearance step.
- **Sidebar** is now a persistent floating rounded panel on desktop (≥901px) instead of an off-canvas-only drawer — matches the reference images. Below that width it's still the original slide-in drawer (`nav.js` untouched, just gated by a media query). Nav items are now pill-shaped with a solid active state instead of the old left-border-accent style.
- **Topbar** flattened — no more frosted glass/border, sits directly on the page background per the reference.
- **Dashboard subject cards** rebuilt to match the reference structure exactly: image strip on top (per-subject deterministic gradient, real photography still pending), a circular icon floating over the image's bottom edge, centered name/teacher/status/actions below. This replaces the old theme-conditional "Premium" card style — it's now the one default card design in both themes.
- Because `css/theme.css` and `css/dashboard.css` are shared includes on every app page (`dashboard.html` through `search.html`), this sidebar/topbar/card treatment applies automatically across all 8 of those pages from these two file changes.

**Explicitly NOT done yet in this round** (see PROJECT_PROGRESS.md → Pending for the full checklist):
- Subjects, My Uploads, Homework, Leaderboard, Profile, Search, Activity/Chat pages still use their pre-existing page-specific layouts (they do inherit the new colors/sidebar/topbar automatically, but haven't had their own content restyled to the "large rounded parent container" treatment the brief describes)
- Login, Welcome wizard steps beyond Appearance, and School Selection pages not yet redesigned
- Admin panel's own dashboard/users/schools/uploads views not yet visually reworked (it does inherit the new 2-theme color tokens automatically)
- Real per-subject photography (chemistry beakers, physics Newton's cradle, etc.) — currently deterministic gradient placeholders
- Empty states, loading screens, and modals across the app not yet individually reviewed against the reference

## Round 17 — Chat routing, mandatory work-type tag, safer account reset, Premium Showcase theme
- **PDF viewer bug diagnosed (no code fix needed)** — upload code already used Cloudinary's `/auto/upload` endpoint correctly. The "Failed to load PDF document" / HTTP 401 in the reported screenshot matches Cloudinary's account-level security default that blocks PDF/ZIP delivery unless explicitly allowed in the Cloudinary Console (Settings → Security). This is a one-time manual Cloudinary setting, not an app bug.
- Topbar notification bell now links straight to `activity.html?tab=chat` on every page, instead of landing on the Activity Log tab. `activity.js` reads the `?tab=` query param on load and auto-selects the requested tab. Sidebar "Activity" link is unchanged (still opens the Log tab).
- Confirmed 48-hour chat auto-expiry (`expireAt`, client-side filtered) was already correctly implemented in Round 16 — no change needed.
- Classwork/Homework tagging on upload is now **mandatory**, not optional: the type pill selection no longer clears back to "none" on re-click, and the upload button blocks (with an inline message + shake animation) until one is picked.
- Danger Zone account reset: replaced the two back-to-back native `confirm()` popups (which looked identical enough to click through blindly) with a single custom modal — a large glowing red headline for the irreversible reset, separated visually from a smaller boxed checkbox for "also delete my uploaded work" (unchecked by default, same behavior as before).
- ~~New Premium Showcase appearance theme~~ — superseded by Round 18's two-theme design system.

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
