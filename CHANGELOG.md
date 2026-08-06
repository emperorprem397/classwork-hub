# Changelog — Classwork Hub

All notable changes, newest first. This is the historical record; for
**current architecture, setup, and what's still pending**, see
`PROJECT_PROGRESS.md`.

## Round 26 — Hero permissions bug, full-bleed hero, coverflow hover fix + bigger cards, subject line-icons
- **Hero banner wasn't loading/saving — root cause found, needs one manual step.** The console showed `FirebaseError: Missing or insufficient permissions` on both load and save. This is a Firestore Security Rules issue, not a code bug: Round 25 introduced a new document path (`schools/{schoolId}/classes/{classId}/meta/hero`) that your current rules don't have a matching `allow` block for, so every read/write to it is denied by default. See the message accompanying this round for the exact manual fix — it needs your actual current rules pasted back to write the precise addition safely, rather than guessing at your rule structure and risking breaking something else.
- **Hero is now full-bleed and much taller** — previously a ~230px rounded card with margins; now runs edge-to-edge (negative margins cancel `.content`'s own padding) directly under the glass topbar with no gap, and scales with viewport height (`clamp(360px, 60vh, 600px)`, smaller clamp on mobile) instead of a fixed pixel height. Matches the "hero fills the whole canvas, translucent navbar floats on top of it" reference.
- **Coverflow hover fixed** — hovering across several cards on the way to the one you actually wanted was re-centering the layout under the cursor on every card passed over, making it feel like the cards were sprinting away and impossible to land on. Fixed with a ~160ms hover-intent delay: a fast pass-through no longer triggers anything, only a deliberate hover does. Desktop-only bug — mobile's tap/swipe interaction wasn't affected. Also enlarged the cards themselves (min 260px → up to 340px) and the coverflow's height to match.
- **Subject cards get real line-icons, not just covers** — this was supposed to ship in Round 24's icon pass and got missed. Each subject now gets a keyword-matched minimalist SVG icon (flask for Chemistry, atom for Physics, calculator for Maths, book for English, etc. — same keyword list as the cover-photo matching in `helpers.js`, so a subject's photo and icon always agree), replacing the old emoji-via-CSS-`content` trick, which couldn't render an SVG at all (`::before { content: attr(data-icon) }` only ever worked for emoji text). Now a real `.subject-icon-badge` element.
- All touched JS syntax-checked, CSS braces balanced, every `getElementById` call cross-checked against `dashboard.html` with zero mismatches.

## Round 25 — Editable hero banner, subject coverflow carousel, scroll-reveal
- **Editable hero banner** — new section at the top of the dashboard, shared class-wide (stored at `schools/{schoolId}/classes/{classId}/meta/hero`, same pattern as subjects — any classmate can edit it, changes are visible to everyone right away). Default minimalist photo with graceful `onerror` fallback, an editable tagline, a 5-option typography picker (Zilla Slab, Playfair Display, DM Serif Display, Space Grotesk, Caveat — all loaded via Google Fonts in `dashboard.html`), left/center/right placement, and a custom banner-photo upload with its own crop-and-preview step.
- **`js/cropper.js` extended for wide aspect ratios** — previously only square/circle; added a `shape: "banner"` mode with independent output width/height, reused by the hero photo upload. Circle/square behavior is unchanged (same 260×260 viewport, same math), so this was additive, not a rewrite.
- **Subject cards are now a 3D coverflow** instead of a flat grid — the focused subject sits centered and full-size, neighbors shrink/rotate/fade on either side (classic coverflow look). Hover-to-focus on desktop, tap-to-focus on mobile (first tap on a side card focuses it; a second tap reaches its Upload/edit buttons), swipe support, and prev/next arrow buttons for keyboard-free navigation past what's on-screen. Defaults to focusing whichever subject has unseen activity, if any.
- **Subtle scroll-reveal** on the hero, profile card, and Today's Work section — built fail-open: the `opacity: 0` starting state only applies once JS successfully arms it (`.reveal-armed`), so if the JS ever errors out before reaching that point, the sections stay visible by default instead of getting stuck invisible. This pass is dashboard-only; other pages don't have it yet.
- Full verification pass: all touched JS syntax-checked, every `getElementById` call cross-checked against `dashboard.html` with zero mismatches, HTML `<section>`/`<div>` tags balanced, CSS braces balanced.

**Known trade-off, called out honestly:** the coverflow clips at the edges of its container on purpose (`overflow-x: hidden` on the wrapper) — without it, the peeking side-cards would cause an actual horizontal scrollbar on mobile. That's standard coverflow behavior, but it does mean a subject sitting 3+ positions away from the focused one is only reachable via the arrow buttons or swiping, not by seeing it peek into view.

## Round 24 — Minimalist line icons (sidebar + navbar), live photo preview on the "Upload one" avatar tile
- **Emoji → line icons, sidebar and navbar only** — replaced the emoji icons in the sidebar (Dashboard/Search/Subjects/My Uploads/Work/Leaderboard/Activity/Profile/Settings) and the topbar (search pill, Work shortcut, theme toggle, class chat) with a small hand-built set of minimalist stroke-based SVG icons (`currentColor`, so they inherit the existing hover/active color states with zero extra CSS). Also swapped the subject-card edit button's pencil character for a matching SVG. New `.nav-icon` / `.topbar-icon` sizing classes in `dashboard.css`. Left the subject-card floating category icon (flask/book/etc.) and other in-page emoji (logo, modal icons, empty states) untouched — this pass was scoped to just the two things called out (sidebar + navbar), not a full emoji sweep.
- **"Upload one" avatar tile now shows the actual photo** — in both the Welcome wizard and Settings, once a photo is cropped it now shows on that tile immediately (from the local cropped image, no need to wait on the network), the same way "Google photo" and "Just initials" already show a live preview. Previously it stayed on the generic camera icon even after a successful upload, with only a small "Photo ready ✓" text as feedback.
- **Settings avatar picker now reflects reality on load** — if the account's current photo is a previously-uploaded custom one (not the Google photo, not a generated letter-avatar), the "Upload one" tile now shows it and is marked active when the Settings page loads, instead of always defaulting to the plain camera icon regardless of what's actually set.
- All touched JS passes a Node syntax check; every `getElementById` call in every touched file cross-checked against its HTML with zero mismatches.

## Round 23 — Glassmorphic navbar, standardized confirm dialogs, per-subject "new" glow, onboarding race-condition bug fixed, gray-toned dark theme
- **Onboarding-skip bug found and fixed** — `js/auth.js` had a race condition: `signInWithPopup` resolving fires the page's own `onAuthStateChanged` listener immediately, and that listener's `getDoc()` could catch a brand-new/just-reset account *before* the click handler's `ensureUserProfile()` had actually created the Firestore doc. Seeing "no profile", the listener redirected straight to `school-select.html`, usually winning the race against the click handler's correct redirect to `welcome.html` — silently skipping the profile-setup wizard after a reset. Fixed with a `signingInViaButton` guard so only one of the two code paths ever redirects.
- **Standardized confirm dialogs** (`js/confirm-dialog.js` + `css/confirm-dialog.css`, new) — a shared `confirmDialog()` matching the Settings "reset account" modal's look (icon, glowing red title, boxed detail copy). Replaced the plain browser `confirm()` popups in: delete subject, admin delete-upload, delete chat message, and remove-file in My Uploads — all four destructive confirmations now look and read identically instead of some being polished and others a bare browser popup.
- **Per-subject "new activity" indicator** — dashboard subject cards for a subject with an upload (or other activity) since this person last opened the dashboard now get a quiet pulsing ring + a small "New" badge next to the subject name, instead of only a generic sidebar dot. Reuses the existing class activity log (`subjectName` field) and the existing `lastSeenUploads` timestamp — no new Firestore fields. Clears automatically the next time the dashboard loads, same as the sidebar dot already did.
- **Glassmorphic sticky navbar** — every app page's topbar is now a translucent, blurred (`backdrop-filter`) bar pinned to the top of the viewport (iOS-style), fixing the old "scrolling text overlapping other options" issue (the bar was `position: sticky` already but fully transparent, so page content visually clashed with it while scrolling). New tokens `--glass-bg` / `--glass-border` / `--glass-blur` in `theme.css`, re-skinning automatically between Matte Dark and Soft Light.
- **Navbar icon refresh** — search is now a rounded pill with a dimmed "Search" label instead of a bare magnifying-glass icon (collapses back to icon-only under 640px); the notification bell is now a message icon (💬) instead of 🔔; added a new "Work" shortcut button; the profile avatar is enlarged (34px → 40px). Same `notifBell`/`notifDot` IDs, so all the existing badge-clearing logic in `topbar.js` needed zero changes.
- **Gray-toned Matte Dark theme** — background, sidebar, cards, and hover states are now visibly distinct layered charcoal tones (`#0d0d0d` → `#131313` → `#161616` → `#202020`) instead of everything crowding close to flat `#0a0a0a`. Body background is now a subtle two-point radial gradient wash (anchored on the theme's own tokens, so it re-skins with Soft Light too) rather than a flat fill.
- Every touched JS file passes a Node syntax check; every `getElementById` call in every touched file cross-checked against its HTML with zero mismatches.

**Known limitation, called out honestly:** the notification-badge clearing described above ("click the tab, the dot disappears") was already working before this round via the existing `lastSeenChat` / `lastSeenActivity` / `lastSeenUploads` timestamps written by `dashboard.js` and `activity.js` — this round adds the *new per-subject glow* on top of that, it doesn't change the underlying clearing mechanism.

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
