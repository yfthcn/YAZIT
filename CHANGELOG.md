# Changelog

All notable changes to YAZIT will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.7.0] - 2026-09-19

Theme setting and a settings-page usability pass: collapsible templates, a
tidier toolbar and a point-and-click condition builder. No storage-schema
change (a new `uiTheme` key beside `uiLang`), no new permissions, no new
runtime dependencies.

### Added
- **Collapsible templates.** Every card now starts as one row — name,
  `/shortcut` and folder chips, slot hotkey (`Ctrl+Shift+1…3`), Export — and
  opens on a click on the row or its ▶. The page stays a scannable list at 5
  templates or 100. New templates open ready to edit; **Expand all / Collapse
  all** acts on what is on screen; open cards stay open across reorders and
  external changes.
- **Condition builder** (`{ if } Condition`, next to *Fields*). Select the
  text that should appear only sometimes, pick the field (existing ones are
  suggested, dropdown options offered as values), choose *is ticked / filled
  in* or *equals*, optionally add an "otherwise" part, and Insert. The markers
  are written around the selection — in the rich editor as two text nodes, so
  formatting inside the selection is kept. A live preview shows the syntax it
  will write.
- **Colour-coded placeholders** in both editors and the Fields panel. Every
  field gets its own colour — stable per name (a hash picks the slot, so
  `{{customer}}` tends to keep its colour across templates) and never shared
  with another field of the same template (8 colours). Condition markers are
  amber, dynamic variables (`{{date}}`, `{{cursor}}`…) grey. Light and dark
  palettes, every pair ≥ 5.4:1. Plain text uses a mirror layer behind a
  transparent textarea, so caret, selection, IME and undo stay native.
- **Folder colours.** Each folder gets its own colour from the same palette:
  the folder chip on every template row, a dot in the sidebar and in the
  popup's filter chips. Keyed by folder id — a rename keeps the colour, adding
  a folder never recolours the existing ones, and the first eight folders are
  all distinct (`TL.folderSlots`). No storage change.
- **Condition lint.** A warning under the body names the first `{{#if}}`
  problem — unclosed, nested, stray `{{else}}` / `{{/if}}`, a second `{{else}}`,
  a missing name — i.e. exactly the cases that would paste raw markers into a
  ticket (`TL.checkConditionals`, tested against `applyConditionals`).
- **Theme: System / Light / Dark** on the settings page, next to the language
  switcher. *System* is the default and matches the old behaviour (follow the
  OS, live). The choice applies to the settings page, the popup and the
  in-page UI (fill-in form, toast, `/` autocomplete); open pages repaint
  immediately.
- `theme.js`: loaded in `<head>` of both extension pages; applies the theme
  before first paint from a localStorage mirror (storage.local stays the
  source of truth), so an explicit choice never flashes the other palette.
- `TL.normalizeTheme`, `TL.getTheme`, `TL.setTheme`, `TL.buildCondition`,
  `TL.checkConditionals`; 31 new locale keys (EN/TR, kept in parity by a test).

### Changed
- **`build.py` emits only the two store zips.** The extracted
  `dist/firefox-unpacked/` is now opt-in (`python3 build.py --unpacked`);
  `npm run lint:ext` asks for it itself, so `npm run check` and CI lint the
  exact Firefox build as before (CI's separate build-before-lint step is gone).
- **Toolbar:** *Export All*, *Copy JSON*, *Import* and *Backups* moved into
  one **Import / Export ▾** menu; *Language* and *Theme* into **⚙ Settings ▾**
  at the top right. The primary action (*Add New Template*) now stands alone.
- The first-run tip about conditionals points at the new button instead of
  teaching the marker syntax.
- The pages switch palettes on `:root[data-theme="dark"]` (always the
  resolved theme) instead of `@media (prefers-color-scheme: dark)`; the
  in-page CSS on `:host([data-yazit-theme="dark"])` — namespaced so a site's
  own `[data-theme]` rules can't reach the host.

- **Dark palette moved from warm brown-black to slate navy** (settings page,
  popup, in-page UI). The amber accent and the light theme are unchanged;
  every text/background pair keeps its previous contrast level (body text
  14.7:1, muted 6.2:1).

### Fixed
- **Import dialog radios** (merge / replace, conflict handling) rendered as a
  lone centred circle above each label — the page-wide `input { width: 100% }`
  also hit radio buttons. They now sit inline, left of their label.
- **Rich-editor placeholder highlighting never showed until the first edit.**
  The highlight ranges were created while the editor was still inside a
  DocumentFragment; a live Range collapses when its nodes move into the page,
  so every freshly rendered card was unhighlighted. They are now created after
  the cards are attached.
- Native controls in the in-page form (select lists, date pickers) rendered
  light inside the dark form: `all: initial` on the host reset the inherited
  `color-scheme`. The host now declares it per theme.

### Security

- **Conditional resolution could hang the page.** `applyConditionals` matched
  with a regex carrying two lazy `[\s\S]*?` spans; on an unclosed
  `{{#if}}…{{else}}` chain its backtracking is cubic — measured 4ms at 1.7 KB,
  204ms at 6.8 KB and **4.8s at `MAX_BODY`**, on the page's main thread while
  someone was pasting. Replaced by a linear single-pass scanner that pairs the
  markers itself. A differential test holds the scanner byte-identical to the
  old regex across 12,000 generated bodies.
- **A third-party iframe could steal the paste target.** Any frame could focus
  a hidden `contentEditable`, register itself as the tab's target and receive
  the next popup/shortcut paste — password and all. Three gates now: a
  subframe must have seen real user interaction before it may claim the target
  (`navigator.userActivation`), a broadcast paste is ignored by subframes the
  user never touched, and a subframe target must pass a real visibility test.
- **`getClientRects().length > 0` was treated as a visibility check.** It only
  rules out `display:none` and detached nodes: `opacity:0`, `visibility:hidden`,
  a 1×1 box and anything at `left:-9999px` all pass it. Targets are now checked
  for size, computed visibility/opacity and — in a subframe — hit-tested.
- **Secret-name detection was blind in Turkish.** Matching was token equality,
  but Turkish suffixes attach to the root, so `sifre` never matched `sifreniz`,
  `sifresi` or `parolam` — the extension was weakest in the language its own
  first-run template ships in. Turkish roots are now matched as a prefix
  (English stems deliberately are not: that is what flagged "passenger" and
  "bypass"), a trailing counter is stripped (`password1`), and `pw`, `auth`,
  `jwt`, `ccv`, `credential(s)`, `master`, `ssh`, `vkn` and `tc_no` were added.
  Measured against 65 realistic field names: 23 missed before, 3 after (`login`,
  `kod`, `refresh` are deliberately too broad to claim).
- **Forget remembered values.** `TL.clearLastValues` existed but nothing called
  it except deleting the whole template, so a value remembered by mistake could
  only be removed by throwing the template away with it. Every card that has a
  remembered field now offers **Forget remembered values**, and Settings offers
  **Clear all remembered values**. The *Remember* checkbox carries a permanent
  warning that the value is stored unencrypted — a name-based rule can never
  see a password in a field called `deneme`.
- **`{{__proto__}}`, `{{constructor}}` and `{{prototype}}` are refused as field
  names.** Not a pollution vector (substitution gates on `hasOwnProperty`), but
  the assignment was silently swallowed, so the raw token was pasted into
  whatever the user sent a customer.
- **`build.py` packages from a whitelist.** It excluded a fixed list of names,
  so any directory nobody had thought of shipped to the stores — a scratch
  folder, a key file, an editor cache. It now names what ships and *stops* on
  an unknown entry in the project root instead of guessing.
- Clipboard HTML is capped before sanitising, not after: `tidyHtml` is
  quadratic in nesting depth (2.7s on a 140 KB ladder of nested `<b>`).
- `docs/privacy.html` listed an `activeTab` permission the manifest does not
  request, and did not say that `chrome.storage.local` is unencrypted. Both
  fixed; the permission list now matches the manifest exactly.
- External links carry `rel="noopener noreferrer"`.

### Performance

- **Switching browser tabs re-parsed every rich editor.** `flushPendingEdits`
  runs on `visibilitychange`, not just on unload, and walked *all* editors —
  a full `DOMParser` pass plus a highlight rebuild per template (~140ms per
  500 bodies) on every tab switch. It now flushes only editors with unsaved
  keystrokes.
- **Expand all / Collapse all was quadratic**: the toolbar label was recomputed
  per card, and computing it re-queries every card. Now computed once.
- Folder id-set and colour-slot maps are memoised on the `folders` array
  (~30ms of pure JS per `render()` at 500 templates / 50 folders).
- Drag-over no longer re-scans the whole card list on every pointer move.
- The in-page theme stylesheet is built on first use instead of at load: this
  file runs in every frame of every page and almost none of them ever shows
  a toast, a modal or the autocomplete.
- The popup and the settings page issue their independent storage reads in
  parallel; a popup's open latency was the sum of four sequential round trips.
- Two quadratic regexes in `htmlToPlainText`: the `<a>` pattern (242ms at
  `MAX_BODY`) and trailing-whitespace trimming (185ms on 20 KB of spaces).

### Accessibility

- `prefers-reduced-motion` is honoured on both extension pages and in the CSS
  injected into the host page; the three smooth scrolls read the preference in
  JavaScript, where a media query cannot reach them.
- The popup had no `<title>`, so a screen reader announced nothing when it
  opened (`action.default_title` is the toolbar tooltip, not the document).
- `--tl-subtle` fails WCAG AA (2.53:1 light / 3.62:1 dark). Informative text
  that used it — the card index, the footer version, the popup credits and
  shortcut hint — moved to `--tl-muted` (5.08:1 / 6.74:1). The token stays for
  decorative glyphs and hover borders.
- The settings page adapts below 560px. It declares `gecko_android` support,
  so it really does open at ~360px, where the template name was squeezed to a
  single character by the keyboard-shortcut badge; touch targets now meet the
  24×24 of WCAG 2.2 AA, and menus no longer overflow the viewport.

### Fixed

- **Real editors were rejected as paste targets.** The new visibility test
  probed the element's centre: a composer taller than the window has its centre
  off-screen, and a placeholder overlay or sticky toolbar owns that one pixel.
  Hit-testing is now a subframe-only rule — the top frame is the page the user
  chose, and a hostile top page can already read its own fields — and it samples
  the element's *visible* part at five points instead of the centre.
- **One stray `{{/if}}` disabled every condition in the template.** The first
  fix for the hang above refused to resolve any body the lint rejected; the
  scanner resolves each block independently, so a broken marker costs only
  itself.
- **Tabbing into an iframe editor then pasting did nothing.** User activation
  propagates to ancestor frames, never into a child, so a keyboard user who
  tabbed into an iframe editor never registered it. The frame now reports
  itself on the first event that activates it.
- **Forget remembered values** is shown only on templates that have a
  remembered field, and follows the Fields panel when *Remember* is toggled.
- `stripShortcut` trimmed trailing hyphens before applying the length cap, so a
  shortcut at exactly `MAX_SHORTCUT` could still end in `-`.
- Dead code removed: an unused `panel` parameter, an unreferenced `.tags-wrap`
  rule, and a stale header comment in `common.js`.
- The version-parity test now covers all four copies of the version string
  (`manifest.json`, `package.json`, the README badge, the docs landing page);
  it previously checked two, while the README claimed it checked every copy.

## [2.6.0] - 2026-09-19

Template grouping: folders and favorites. **Storage schema v4** (additive — a
v3 store needs no rewrite), no new permissions, no new runtime dependencies.

### Added
- **Folders.** One level, stored under a new `folders` key; a template points
  at one via an optional `folderId`. The settings page gets a sidebar (All,
  Favorites, folders with counts, Uncategorized, New folder) with rename and
  delete; each template gets a *Folder* dropdown (including "New folder…"), and
  a card can be dragged by its handle onto a sidebar folder. Deleting a folder
  moves its templates to Uncategorized — nothing is deleted. Names are unique
  case-insensitively; limits: 50 folders, 40 characters per name.
- **Favorites.** A ☆/★ toggle per template (optional `favorite` flag).
  Favorites are listed first in the popup and win score ties in the `/`
  autocomplete.
- **Popup filter chips** (All / ★ Favorites / folders), shown only once there
  is a folder or a favorite. The row scrolls sideways with the mouse wheel or
  click-and-drag, fades the edge that hides more chips, and keeps the selected
  chip in view.
- 18 new locale keys (EN/TR).

### Changed
- Search (settings page and popup) always covers every template; the sidebar
  and the chips only narrow browsing, and picking a folder clears the search.
- Up/Down on the settings page move a template among the templates currently
  on screen, so reordering inside a folder view works as expected.
- New templates created while a folder (or Favorites) is selected land there.
- The *Tags* field is now labelled **Search keywords** — same data, clearer
  role now that folders do the grouping.
- `Ctrl+Shift+1…3` still follow the global template order; favorites and
  folders never change which template a hotkey pastes.

### Look
- **New palette to match the YAZIT brand:** amber accent (`#e8a33d`) on warm
  neutrals, replacing the old indigo, across the popup, settings page,
  in-page fill-in form, toast, `/` autocomplete and the docs site. Dark mode
  uses warm blacks instead of blue-greys; light mode stays and still follows
  the OS theme. Amber fills carry dark text, and a darker amber is used for
  text and focus rings on plain backgrounds, so every pairing meets WCAG AA
  (≥4.5:1). Favorite stars use a separate yellow so they don't blend with
  the accent.
- **Popup shortcut is now `Alt+Shift+Y`** (was `Alt+Shift+T`). Chrome and
  Firefox only apply a suggested key on first install — existing users keep
  their current binding and can change it at `chrome://extensions/shortcuts`
  or *about:addons → Manage Extension Shortcuts*.

### Import / export / backups
- Exports carry a template's folder as its **name** (`"folder": "Work"`), not
  its install-local id, and stay a plain JSON array — older versions still
  read them. Imports match folder names case-insensitively and create missing
  folders; *Replace* rebuilds the folder list from the file.
- A merge-import in *Overwrite* mode keeps the local folder/star unless the
  file sets them.
- Backups now include folders. Restoring a pre-2.6 snapshot keeps the current
  folders; its templates come back as Uncategorized.

## [2.5.2] - 2026-09-19

A security and test-coverage pass, and the rename from TypeLess to **YAZIT**.
No schema change, no new permissions, no new locale keys, no new runtime
dependencies.

### Rebrand
- **TypeLess is now YAZIT.** New name, new tagline ("Write once. Use
  anywhere." / "Bir kez yaz. Her yerde kullan."), new icon set (16/32/48/128;
  512px master in `docs/assets/icon-512.png`). Repo, Pages site, package and
  build artifacts (`yazit-chrome.zip`, `yazit-firefox.zip`) follow the new slug.
- The Firefox add-on ID stays `typeless@kaktusdev.net` on purpose: AMO keys
  updates on it, so changing it would orphan every existing install.
- Templates, settings and backups are untouched — storage keys never carried
  the product name.
- The popup header shows the product name and version; the options page title
  does too.

### Security
- **The DOM-free sanitizer could be made to hang (exponential backtracking).**
  Its tag-attribute group used `[^>]`, which also matches a quote and so
  overlapped the two quoted alternatives; an unterminated tag made the engine
  try every partition of the quote run. 40 quote characters took 2.4s, and each
  further pair doubled it. The class is now `[^"'>]` — disjoint, therefore
  linear: 20 000 quote characters now take 2.8ms.
- **`remember` wrote Turkish users' passwords to storage in the clear.**
  `isSecretName` only knew English stems, while the extension ships a Turkish
  locale whose first-run template is literally shortcut `sifre`. `sifre`,
  `parola`, `kart_no`, `guvenlik_kodu`, `pasaport`, `kimlik_no` and the missing
  English ones (`pwd`, `2fa`, `mfa`, `seed`, `mnemonic`, `private_key`,
  `security_code`, `bearer`, `session`, `cookie`) are all recognised now.
  Names are folded to ASCII, so `Şifre`/`şifre`/`sifre` are one rule.
  Widening the rule only protects future writes, so the update also sweeps
  already-stored secrets (`TL.purgeSecretLastValues`), and `TL.saveLastValues`
  now refuses them at the store itself rather than trusting its callers.
- **A paste could be delivered into a hidden editable.** Under
  `<all_urls>` + `all_frames` any frame — including a third-party ad iframe —
  could focus an invisible `contentEditable`, register itself as the tab's
  focus frame and receive the next popup/shortcut paste. A paste target must
  now be connected to the document and actually rendered.
- CSP for extension pages tightened: `object-src 'none'` (was `'self'`).

### Fixed
- **Inserting a variable could overwrite the wrong template's body, silently.**
  `render()` replaces every card but `lastFocusedBody` kept pointing at the
  detached editor, whose `data-idx` is a position in the *old* list — so after
  a reorder or delete, "Insert variable" wrote one template's body over
  another's and saved it. A detached node is no longer a valid target.
- The DOM-free sanitizer dropped a bare `<` instead of escaping it
  (`a < b` became `a  b`). That path writes back to storage during migration,
  so it was real data loss.
- `<html>` had no `lang` on either extension page, and the options page has a
  language switcher; it now carries the resolved locale. `loadLocale` returns
  the locale it resolved to instead of duplicating that rule at the call sites.
- The options page had no viewport meta and its name/shortcut row overflowed
  narrow screens, although the build declares Firefox for Android 142+.

### Changed
- **`common.js` split in two.** `common-ui.js` holds what only the popup,
  options page and background use (tab-paste helpers, backups, import
  adapters, debounce, full-text search, merge, field-token builder). The
  content script is injected into every frame of every page and loads only
  `common.js`, so its payload drops 92.8KB -> 82.0KB per frame.
- The build packages markdown by whitelist instead of by blacklist — a stray
  note in the project root used to ship to the stores.
- `engines.node` is `>=24` (Active LTS), matching CI.

### Testing
- **Both sanitizer paths are now tested.** `DOMParser` is `[Exposed=Window]`,
  so it is missing from Chrome's MV3 service worker: the "test-only" fallback
  is a production path, and the comment claiming otherwise was wrong. Node has
  no DOMParser either, so every existing sanitizer assertion had only ever
  exercised the fallback. `test/dom-shim.js` (parse5) runs them against the DOM
  path as well, plus a parity check and allowlist invariants over hostile input.
- New test derives every context's script list from the real configs (manifest,
  both HTML pages, `build.py`, the `executeScript` fallback) and fails if any
  context calls a `TL` member the files it loads do not define.
- New test pins `manifest.json` and `package.json` to the same version.

## [2.5.1] - 2026-09-09

Stability pass on the 2.5.0 baseline: seven real bugs, two hot paths, two
leaks. No schema change, no new permissions, no new locale keys.

### Fixed
- **Options page re-rendered every card mid-keystroke** in two cases: typing
  a shortcut with a trailing hyphen (`pw-`), or adding tags to a rich-text
  template for the first time. The self-echo fingerprint was taken over the
  in-memory array, but storage trims the hyphen and orders `tags` before
  `format`, so the extension's own write looked like an external change and
  `render()` stole focus. The fingerprint is now taken over the list
  `setTemplates` actually wrote (it returns it); the write-side normalizer is
  exposed as `TL.normalizeTemplates` and covered by a test.
- **Popup / quick-slot paste failed with "no access" after navigating** a tab
  whose last editable focus was inside a subframe. Subframe ids do not survive
  navigation; the stale `frameId` made `tabs.sendMessage` throw, the fallback
  re-injected every frame and then retried the *same* stale id. The background
  now clears the record on `tabs.onUpdated(status=loading)`, and `pasteToTab`
  drops a dead record and broadcasts before it ever considers injection.
- **Slash expansion could miss on a cold cache.** The keydown handler awaited
  the template cache before calling `preventDefault()`; once the handler
  yields, the Space/Enter default action lands and the token no longer ends at
  the caret. The path is synchronous now — a cold cache warms in the
  background and lets that one key through.
- `{{cursor}}` in a contentEditable plain paste counted caret steps in UTF-16
  units while `Selection.modify` moves by character; an emoji after the marker
  shifted the caret by one. Steps are counted in code points.

- **Options page leaked every rich editor it ever rendered.** Placeholder
  highlight `Range`s stayed registered in the CSS Highlight registry after
  `render()` replaced the cards, pinning the detached editor subtrees. The
  registry is cleared before each structural render.
- Slash autocomplete could re-open a stale list when the first cache load
  resolved after the dropdown had already been closed (blur, click, newer
  keystroke). Guarded by a generation counter.
- `saveNow()` no longer leaves the in-memory list ahead of storage when the
  write is refused (quota): it reloads what is actually persisted, prunes the
  selection and reports the error instead of rejecting into the click handler.

### Changed
- Remember-last opt-out covers more identifier-like field names (IBAN, card
  number, SSN, passport, TC kimlik) in addition to credential names.
- The shortcut character-class regex is compiled once (`TL.SHORTCUT_STRIP_RE`)
  instead of on every options keystroke and every `stripShortcut` call;
  `slashRegex()` returns one shared non-global instance.
- A popup/shortcut paste no longer waits for the content script's template
  cache to load before pasting (the cache is only needed for slash commands).
- Every paste entry point in the content script reports a rejected
  `handlePaste` to the console instead of leaving it unhandled.
- Restoring a backup no longer triggers a second full render from its own
  storage echo.

### Removed
- Orphaned `lastValues:<id>` keys: replace-import and backup restore now run
  `TL.gcLastValues` so remembered values of templates that no longer exist are
  dropped (single deletes were already cleaned; bulk swaps leaked forever).
- `slashBusy` re-entrancy flag (moot on a synchronous handler); unused
  `byName` map in the placeholder form.
- `package-lock.json` root version had been stuck at 2.4.3 since two releases;
  aligned with `package.json`.

## [2.5.0] - 2026-09-02

Full-codebase audit: one functional bug, one changelog/code mismatch, dead
data, hardcoded labels and native dialogs — all addressed. Schema v3.

### Fixed
- **Placeholder form: Cancel, backdrop-close, the 📋 clipboard button,
  dirty-tracking and live cross-field defaults did not work** (since 2.4.1).
  The page-isolation added in 2.4.1 stopped events at *window capture* with
  `stopImmediatePropagation`, which also prevents them from ever reaching the
  form's own listeners inside the shadow root (only Esc, Enter-to-submit and
  the submit button — default actions — survived). Isolation is now two-layer:
  key events are still stopped at window capture (pages hook `keydown` in
  capture phase), everything else is stopped on the shadow **host in bubble
  phase**, after our listeners ran. Verified against the DOM event model.
- **`PASTE_TEMPLATE` payload re-clamp actually exists now.** The 2.4.2 notes
  claimed it; the code passed `msg.template` straight through. The content
  script now normalizes the incoming template with the same `TL.migrate`
  path storage uses.
- Quick-slot labels (popup badges, popup footer, options index line and the
  shortcut tip) show the **real** binding from `chrome.commands.getAll()` —
  `⌘⇧1` on macOS, and whatever the user remapped — instead of a hardcoded
  `Ctrl+Shift+N`. Unbound slots show nothing.

### Changed
- **Frame targeting without per-paste script injection.** Content scripts
  report editable focus to the background (`FOCUS`); the background keeps
  `frameId` per tab in `chrome.storage.session`; `pasteToTab` reads it back.
  The previous design ran `scripting.executeScript` across *every* frame on
  every paste. `scripting` remains only for the fallback injection.
- **Schema v3: the per-template `fields` array is gone.** It was validated on
  every read/write/import but never read at runtime — fields are always
  derived from the body (`parseFields`). `migrate` strips it; exports no
  longer carry it; `validateFields` removed.
- Options: `alert`/`confirm`/`prompt` replaced by an in-page dialog (same
  look as the import modal, Enter/Esc, never suppressed by the browser).
- Options: tip box is dismissible (persisted); empty list shows a first-run
  call to action; new templates are named "New template N" and the name
  field is pre-selected, instead of cloning the "Password Reset" default name.
- Popup: ↑/↓ navigate the list from the search box or an item.
- `minimum_chrome_version: 105` (`:has()`, CSS Custom Highlight API). README
  and CONTRIBUTING updated from the never-tested "Chrome 88+".

### Removed
- `browser.*` polyfill block (no call site; Firefox 140 exposes a
  promise-returning `chrome.*`).
- Legacy `lastValues` blob fallback on the read path and in `clearLastValues`
  — the eager `migrateLastValues` (2.4.3) owns that migration.
- Duplicate FNV-1a in `options.js` → `TL.fnv1a` (also used for template ids).
- `migrate()` no-op `delete quickSlots`, unused `importConfirm` locale key,
  orphaned "Remember-last value storage" comment, `__TL_LAST_FOCUS_TS__`.
- `TL.tbTokensToPlaceholders` is private again (no external caller, no test).

### Tests
- 62 tests (was 59): v2→v3 `fields` strip, `fnv1a`, `slotKeysHint`;
  `lastValues` test rewritten for the fallback-free read path.

## [2.4.3] - 2026-08-28

### Changed
- **Eager `lastValues` migration** (follow-up to the 2.4.2 review): on the
  first run after update, the pre-2.4.2 shared `lastValues` blob is folded
  into per-template `lastValues:<id>` keys and the blob is removed, instead of
  living forever behind the lazy fallback. Existing per-template keys win;
  idempotent; runs in the background onInstalled(update) handler — the single
  migration writer. The lazy fallback in `getLastValues` remains as a safety
  net for the one race window around the migration.

## [2.4.2] - 2026-08-28

Fixes from an external code review (accepted findings only).

### Fixed
- **Options echo-detection could swallow foreign writes:** the storage-change
  fingerprint compared only template id + body length, so a change from
  another context (popup, second options tab, import) that kept lengths equal
  was misread as our own save echo and ignored. Now an FNV-1a hash of the full
  JSON — computed only on save and on storage-change events.
- **`setTemplates` now guarantees unique ids** (same `while (seen) id += "x"`
  rule as `migrate`): importing two identical templates no longer writes
  duplicate deterministic ids that only the next read repaired.
- **Paste fallbacks report failure honestly:** when `insertText`/`insertHTML`
  is refused and no selection exists to fall back on, `pasteIntoElement` /
  `pasteHtmlIntoElement` now return `false` instead of claiming success.
- **`defaultParagraphSeparator` is asserted on editor focus** (editing-context
  state) instead of while building a detached node, where it isn't guaranteed
  to stick — matters with several rich editors on one page.
- **Remember-last values moved to one storage key per template**
  (`lastValues:<id>`): concurrent writes for different templates can no longer
  clobber each other in a shared-blob read-modify-write. Legacy blob is read
  as fallback; deleting a template cleans both. Helpers centralised as
  `TL.getLastValues` / `TL.saveLastValues` (content.js duplicates removed).
- Content script re-clamps incoming `PASTE_TEMPLATE` payloads (name/body caps,
  format whitelist) — defense in depth; HTML safety still rests on
  `sanitizeHtml` as the last pass.
- Removed a misleading `return true` after a synchronous `sendResponse`.
- 2 new tests (58 total).

### Not changed (reviewed, deliberate)
- `execCommand` stays as the single backend behind `TL.editorAdapter`
  (acknowledged technical debt; a beforeinput/Range backend can replace it
  behind the same interface).
- Full-card re-render and full-snapshot backups are fine at real-world sizes;
  virtualisation would be premature.
- The reviewer's TypeScript failure was environmental (dependencies not
  installed); `npm ci && npm run check` is green in CI.

## [2.4.1] - 2026-08-28

### Fixed
- **Form lost focus after every keystroke on pages that intercept keyboard
  events** (Google Docs/Sheets, Notion, Gmail single-key shortcuts, ServiceNow
  and similar). Events leaving the form's shadow root are now stopped by
  window-capture listeners for the lifetime of the dialog, so no page listener
  sees them; typing, Enter-to-submit and Esc-to-cancel keep working. Listeners
  are removed when the dialog closes. Pre-existing since 2.2.0, surfaced by
  the larger 2.4.0 forms.

## [2.4.0] - 2026-08-27

### Added
- **Conditional blocks:** `{{#if flag}}…{{else}}…{{/if}}` and
  `{{#if name=value}}` (case-insensitive equality). An `#if` on an undeclared
  name auto-creates a checkbox field. Resolved BEFORE substitution so a dropped
  branch never leaks its placeholders. Single level, no nesting.
- **Checkbox field type** (`{{ok|Label|checkbox|true}}`).
- **Required fields:** `required` flag blocks paste while empty (red border +
  message, focus jumps to the first offender). Flags slot is now
  comma-separated: `remember,required` in any order; bare `remember` still works.
- **Date formats:** `{{date|dd.MM.yyyy}}`, `{{date+3d|d MMM yyyy}}`, and the
  `date` field's options slot selects the output format
  (`yyyy-MM-dd` default, `dd.MM.yyyy`, `dd/MM/yyyy`, `MM/dd/yyyy`, `d MMM yyyy`).
  Date field defaults accept `today`, `+3d`, `-1w`, `+1m`, `+1y` or ISO.
- **Cross-field defaults:** a default may contain `{{other}}`; it is resolved
  live in the form until the user edits that field.
- **Dropdown "Other…":** an option of `*` adds a free-text entry.
- **Paste-from-clipboard button** on text/multiline form fields (async
  clipboard API inside the click gesture; no manifest permission added).
- Forms with 6+ fields lay out in two columns; multiline/checkbox rows span both.
- **Rich text:** `h2`, `h3`, `code`, `pre`, `table/thead/tbody/tr/th/td` join the
  allowlist. Toolbar gains Strike, H2, H3, numbered list, inline code, code
  block, table (rows × cols, optional header) and a proper **link popover**
  (URL + text, edit/remove an existing link) replacing `prompt()`.
- `{{placeholder}}` highlighting inside the rich editor via the CSS Custom
  Highlight API — paint only, the stored body is never mutated.
- `TL.tidyHtml`: Word/Outlook/Docs clipboard residue (empty paragraphs,
  `&nbsp;` ladders, empty formatting shells, `<br>` runs) is removed on paste.
- `htmlToPlainText` degrades tables to `a | b` rows and headings/pre/table to
  their own paragraph.
- Version is shown in the popup credits line and the options footer
  (`chrome.runtime.getManifest().version`).
- Field-builder: checkbox type, required toggle, date-format select.
- 11 new tests (56 total).

### Changed
- `TL.formatDate(d, fmt)`, `TL.formatIsoDate`, `TL.resolveDateDefault`,
  `TL.applyConditionals`, `TL.DATE_FORMATS`, `TL.tidyHtml` are public; the
  offset/clamp logic is shared by dynamic vars and date defaults.
- `TLField` gains `required` (optional; absent === false).

### Removed
- Unused locale keys `linkPrompt`, `btnSelectAll`, `importChooseFile`, `fbType`.

## [2.3.0] - 2026-08-27

### Changed
- **Dev toolchain moved to current stable:** TypeScript 7.0 (native compiler),
  web-ext 10.6, `@types/chrome` 0.2.7, `@types/node` 26.4. `jsconfig.json`
  gained a `paths` pin for `punycode` so TS 7's `allowJs` no longer
  type-checks the transitive `punycode` package pulled in by web-ext.
- **CI pinned to current action releases** (checkout v7, setup-node v7,
  setup-python v7, upload-artifact v7, configure-pages v6,
  upload-pages-artifact v5, deploy-pages v5 — all by commit SHA), installs
  with `npm ci` (lockfile-exact, cached) and runs `web-ext lint` as a real
  gate on the unpacked directory `build.py` already emits — the ad-hoc
  unzip step and `|| true` are gone. Python 3.14 for the build job.
- `npm run check` now runs the full chain: typecheck → tests → build →
  web-ext lint.
- **Store packages no longer bundle `CHANGELOG.md` / `CONTRIBUTING.md`**
  (repo meta, not part of the extension). `README.md` + `LICENSE` stay.
- `build.py` no longer re-stamps `gecko.id` / `data_collection_permissions`
  — the source `manifest.json` is the single source of truth; only the
  Android minimum is added at build time.
- `package-lock.json` removed from `.gitignore` (it is committed, per 2.2.0).

### Removed
- Dead code: `TL.extractPlaceholders` (unused legacy helper), the shipped
  `self.TLDebug` console helper in the content script, the
  `getCachedTemplatesSync` one-line wrapper, and unused options CSS
  (`.card-tags`, `.tag-chip`, `.rt-toolbar button.active`).
- `TL.hashId` / `TL.makeId` / `TL.pad2` / `TL.formatDate` / `TL.formatTime`
  are now module-private — nothing outside `common.js` used them, and a
  smaller public surface is easier to keep the `TLApi` contract honest.

### Fixed
- Options name/shortcut inputs derive `maxLength` from `TL.LIMITS` instead
  of duplicated literals (`200` / `50`).

## [2.2.0] - 2026-07-01

### Fixed
- **Multi-frame double paste (council H1, full fix):** every frame tracks its
  own `lastFocusedElement`, so a user who had focused editables in two frames
  could get the template pasted into BOTH. `TL.pasteToTab` now probes all
  frames via `scripting.executeScript` for the newest editable-focus timestamp
  and sends `PASTE_TEMPLATE` only to the winning `frameId`; the broadcast path
  remains as fallback (with subframe toasts suppressed).
- **Background survives a failed `importScripts` (council H2):** all three
  listeners now guard on `self.TL` and log instead of dying on a silent
  `ReferenceError`.
- **`migrate()` clamps oversized bodies on read** (with the mid-tag repair for
  html format) — a bloated legacy record no longer rides along unbounded.
- **Backups can no longer abort destructive ops:** `pushBackup` never throws;
  on a storage-quota error it shrinks the ring (drop oldest first) and skips
  the backup as a last resort instead of failing the delete/import it guards.
- **Slash autocomplete false positives:** `TL.fuzzySearch` added a flat +2
  shortcut weight even when the shortcut did NOT match (`-1 + 2 = 1`), so
  typing a non-matching `/query` popped the dropdown with every template.
  The weight now applies only to actual shortcut matches; no match → no dropdown.
- **Multi-frame toast spam:** `tabs.sendMessage` without a `frameId` delivers
  `PASTE_TEMPLATE` to every frame; each frame without a focused editable showed
  its own "focus a field first" toast. Only the top frame reports now; subframes
  stay silent.
- **Popup shortcut never bound:** `Ctrl+Shift+T` is a browser-reserved shortcut
  (reopen closed tab) in both Chrome and Firefox, so the suggested key silently
  failed to register. Changed to `Alt+Shift+T` (manifest, locales, README, USAGE).
- **In-page UI ignored the language override:** the placeholder form and toasts
  always used the browser language via `chrome.i18n`. Content now asks the
  background for the chosen locale's strings when `uiLang !== "auto"` (zero
  overhead in the default case; cache invalidated on `uiLang` change).
- **Storage could hold mid-tag-cut HTML:** `setTemplates` and import truncation
  sanitized *then* sliced to `MAX_BODY`; a cut landing inside a tag was stored
  as-is. Both now re-sanitize the clamped slice (same repair as `storeRichBody`).
- **`{{date+1m}}` month-end overflow:** Jan 31 + 1m produced Mar 3 via raw
  `setMonth` rollover. Month/year offsets now clamp to the last day of the
  target month (Jan 31 + 1m → Feb 28/29; Feb 29 + 1y → Feb 28).
- **`npm run lint:ext` had no input:** the script pointed at
  `dist/firefox-unpacked`, which `build.py` never produced. The Firefox build
  now also emits the unpacked directory.
- Content `onMessage` no longer returns `true` for unhandled message types
  (kept the sender's promise pending indefinitely).

### Changed
- **quickSlots retired:** written by migrations but never read anywhere (both
  background and popup resolve Ctrl+Shift+1..3 by template order). `migrate()`
  drops it and the update path removes the stored key.
- **Options search is now a show/hide filter** over existing cards instead of
  rebuilding every card per keystroke; `render()` runs only on structural
  changes. `TL.searchTemplates` caches per-template haystacks (WeakMap,
  field-identity invalidation) instead of re-joining + lowercasing every body
  on each keystroke.
- Rich-editor char-count updates from the debounced store instead of
  serializing `innerHTML` on every keystroke.
- Link toolbar passes the CLEANED url (`TL.cleanHref`, now public) to
  `createLink` instead of the raw prompt value.
- `mergeImport` moved to `common.js` as pure `TL.mergeImport` (unit-testable).

### Added
- **Real `TLApi` type contract** in `types/globals.d.ts` replacing `TL: any` —
  `npm run typecheck` now verifies call sites (and caught one live mismatch).
- `package-lock.json` (reproducible dev-tooling installs) and GitHub Actions
  pinned to commit SHAs (supply-chain hardening).
- Regression tests: fuzzy-search no-false-positive, month/year clamp,
  truncated-HTML well-formedness, migrate body clamp, `TL.mergeImport`
  conflict modes, `TL.isSystemUrl`, haystack-cache invalidation (45 tests).

## [2.1.1] - 2026-06-22

### Fixed
- **Clean AMO / web-ext validation (0 warnings).** The three sanitized-HTML
  insertion points (rich-editor render + sync, and the contentEditable paste
  fallback) no longer use `innerHTML =` / `createContextualFragment`. A new
  `TL.htmlToFragment()` parses the already-sanitized string with DOMParser
  (inert) and inserts real DOM nodes via `replaceChildren` / `insertNode` —
  functionally identical, but uses no linter-flagged DOM-write sink.

### Fixed (independent code-review pass)
- Sanitizer DOM-free fallback: void kill-tags (`<base>`/`<meta>`/`<link>`/`<frame>`)
  no longer swallow trailing content.
- Import "overwrite" conflict mode now preserves/clears the `format` flag (was
  corrupting rich templates into plain on merge).
- Rich-editor body writes go through one `storeRichBody` helper that re-sanitizes
  a length-clamped slice (can't store mid-tag-truncated HTML) and keeps the
  char-count in sync across the editor, toolbar and insert-variable paths.
- Field-builder rewrites every occurrence of a repeated placeholder token.
- `storage.onChanged` uses a write-fingerprint instead of a one-shot suppress
  flag, so a concurrent write from another context is no longer swallowed;
  order-sort is NaN-safe.

### Changed
- content.js shares one constructable `CSSStyleSheet` (`adoptedStyleSheets`)
  across shadow hosts instead of injecting a `<style>` per host; options + popup
  search inputs are debounced.
- Added a static product page under `docs/` (GitHub Pages, EN/TR, comparison
  table) with a `pages.yml` deploy workflow, a user guide (`docs/USAGE.md`) and
  copy-paste store-listing copy (`docs/store-listing.md`). `docs/` is excluded
  from the packaged extension.

## [2.1.0] - 2026-06-21

Still 100% local, zero runtime dependencies, no new permissions, AMO
`data_collection_permissions.required = none` unchanged.

### Added
- **Rich-text templates.** A template can opt into formatted content
  (bold/italic/underline, links, bulleted lists) via a per-template plain↔rich
  toggle with a small toolbar in the options page. Rich templates paste
  **formatted** into rich editors (Gmail/CKEditor/Quill/ProseMirror/TinyMCE) and
  **degrade to clean plain text** in `<input>`/`<textarea>`.
- **Visual field-builder.** A collapsible *Fields* panel per template detects
  `{{placeholders}}` in the body and lets you set each field's label, type
  (text/multiline/dropdown/date), default, options and remember-last with form
  controls — writing the canonical pipe-syntax back into the body (which stays
  the single source of truth, so the paste path is unchanged).

### Security
- **`TL.sanitizeHtml` — one audited trust boundary.** Rich content is sanitized
  with a DOMParser-based allowlist rebuild (tags `b,strong,i,em,u,s,a,br,p,ul,ol,li`;
  every other element unwrapped or dropped-with-subtree; **all** attributes
  default-denied except a validated `href` on `<a>`; `javascript:`/`data:`/
  `vbscript:`/scheme-relative hrefs neutralised; `rel="noopener noreferrer nofollow"`
  forced). HTML is **re-sanitized on save, on import, and again at paste**.
- **Escape-on-fill.** Placeholder values in HTML templates are HTML-escaped
  before substitution and the whole result is sanitized last, so a malicious
  field value cannot inject markup at the one HTML sink.
- README "No innerHTML anywhere" reworded to reflect the single audited sanitizer.

### Changed
- `README.md` features + docs updated; `_locales` gained the rich-text and
  field-builder UI strings (EN/TR parity preserved). New `node:test` cases cover
  the sanitizer XSS corpus, escape-on-fill, `htmlToPlainText`, and the
  `buildFieldToken` round-trip.

## [2.0.0] - 2026-06-20

A large feature + maturity release. Everything stays **local — no server, no
network calls** — and the extension keeps shipping **zero runtime dependencies**.

### Fixed (P0 — independently shippable bugfixes)
- **Hyphenated / non-default shortcuts now expand via slash.** The slash matcher
  ignored `-` while the editor accepted it, so a `client-reply` shortcut could
  never be triggered by `/client-reply`. All three call sites (slash matcher,
  options live-strip, import validation) now derive from a single
  `TL.SHORTCUT_CHARS` constant.
- **No more double paste after content-script re-injection.** A per-frame
  `__TL_CONTENT_LOADED__` guard stops the `executeScript` fallback from
  registering a second set of listeners.
- **Rich-editor inserts preserve undo and caret.** ContentEditable paste now
  uses `insertText` (plain text, single-step undo) with a Selection-API
  fallback, and slash-token deletion uses a `Range` so CKEditor/Quill/ProseMirror
  models stay consistent.

### Added — features
- **Slash autocomplete** — typing `/` shows a caret-anchored, fuzzy-matched,
  dark-aware dropdown of templates (↑/↓ to move, Enter/Tab to accept, Esc to close).
- **Dynamic variables** (zero-permission, computed locally): `{{date}}`,
  `{{time}}`, `{{datetime}}`, date offsets like `{{date+3d}}` / `{{date-2w}}`,
  and `{{cursor}}` to position the caret after paste.
- **Smart placeholder fields** via pipe syntax
  `{{name|Label|type|default|opt1,opt2|remember}}` — text / multiline / dropdown /
  date inputs, defaults, and opt-in last-value recall (never for secret-looking
  field names like password/otp/cvv/token).
- **Tags + search** across name/shortcut/body/tags, in both the options page and
  the popup.
- **Dark mode** everywhere (options, popup, and the in-page modal/toast/
  autocomplete) via `prefers-color-scheme`.
- **Automatic local backups** — a 5-snapshot ring buffer written before
  destructive operations, with one-click restore from the options page.
- **Competitor import** — Text Blaze and Magical exports are auto-detected and
  converted to YAZIT templates (a pure client-side migration funnel).
- **Drag-and-drop reordering**, **copy-all-as-JSON to clipboard**, an
  **insert-variable helper** menu, and a **conflict resolver** on import
  (keep-both / overwrite / skip) with a rejected/truncated summary.

### Added — engineering
- **Schema v2** with stable, deterministic per-template `id`s and an explicit
  `order`, migrated forward idempotently (authoritative single write on
  install/update; migrate-on-read elsewhere).
- **Hardening caps**: max 500 templates, 20 000-char bodies, and a 2 MB import
  size guard checked before parsing.
- **Zero-dependency unit tests** (`node:test`) and **`// @ts-check`** across all
  five JS files (via `jsconfig.json` + ambient types).
- **CI** now runs unit tests, `tsc --noEmit`, and `web-ext lint` alongside the
  existing JSON/locale-parity checks.

### Cut / deferred (decided by review)
- **Unlimited custom keyboard shortcuts** — *cut*: MV3 commands are hard-capped
  and not runtime-registerable; the slash autocomplete covers the need.
- **`{{clipboard}}` variable** and **`storage.sync`** — *deferred*: both would
  introduce a permission or a network path that contradicts the "no network,
  nothing leaves your device" guarantee. Local backups + import/export cover the
  cross-device need.
- **Hierarchical folders**, a **visual field-builder UI**, and a **per-edit undo
  timeline** — *deferred to a later release*; flat tags, inline pipe syntax, and
  snapshot restore deliver most of the value now.

## [1.1.0] - 2026-05-09

### Added
- New i18n key `popupSystemPage` for system-page paste error messages (en, tr).
- Shared helpers `TL.isSystemUrl(url)` and `TL.pasteToTab(tabId, template)` in `common.js` to consolidate URL filtering and paste-with-fallback logic.
- `setNativeValue(el, value)` helper in `content.js` for DRY native-setter pattern.
- Build script (`build.py`) now filters dev/internal `.md` files from store packages via glob patterns (`*-bug-*.md`, `*-fix-*.md`, `STEP*_*.md`, `ANALYSIS_*.md`), with `README.md` / `CHANGELOG.md` / `CONTRIBUTING.md` / `LICENSE` whitelisted.
- Build script forces UTF-8 stdout on Windows to avoid cp1252 encoding errors.
- `CONTRIBUTING.md`, `CHANGELOG.md`, `.github/` templates and CI workflow.
- Placeholder modal now shows the template name beneath the title for clearer context when filling fields.

### Changed
- `showPlaceholderForm()` API simplified: removed redundant `onSubmit` callback parameter; now Promise-only (`resolve(values)` on submit, `resolve(null)` on cancel/escape).
- `popup.js` and `background.js` now delegate URL filtering and paste fallback to shared helpers in `common.js` (~25 lines removed across both).
- `background.js` URL filter now also blocks Web Store URLs (Chrome Web Store, Edge Add-ons, Firefox AMO) — previously only the URL scheme was checked. Paste shortcut on store pages now silently no-ops instead of throwing.

### Fixed
- Popup error message on system pages was hardcoded Turkish; now uses `popupSystemPage` i18n key (English users no longer see Turkish text).
- Removed startup `console.log` in `content.js` that fired on every page load (and every iframe with `all_frames: true`), causing console noise on every visited page.

### Removed
- Unused public API `TL.escapeAttr` (never called anywhere).
- Unused public API `TL.getActiveLang` (never called; module-private `activeLang` retained for `TL.t` lookup).

## [1.0.8] - 2026-04-17

This is the initial release in this repository (the v1.0.8 git tag points to the
first commit). Earlier 1.0.x versions exist as published store releases but have
no commit history here.

### Notable in 1.0.8
- Firefox AMO support (`browser_specific_settings.gecko` with `id`, `strict_min_version: "140.0"`, `data_collection_permissions: { required: ["none"] }`).
- Dual-build pipeline: `build.py` produces browser-specific Chrome (`service_worker`) and Firefox (`background.scripts`) packages from a single source manifest.
- Removed all `innerHTML` usage in favor of native DOM APIs (`createElement` / `textContent`) for store-review compliance and XSS-surface reduction.
- Bilingual UI (English / Turkish) via `chrome.i18n` + custom locale loader in `common.js`.
- Three paste mechanisms: keyboard shortcuts (`Ctrl+Shift+1..3`), popup menu, slash commands (`/shortcut + space`).
- Placeholder system: `{{variable_name}}` opens a Shadow-DOM-isolated form to collect values before paste.

## [Earlier versions]

For changes in 1.0.x releases prior to 1.0.8, see the GitHub Releases page —
no commit history exists in this repository for those versions.

[Unreleased]: https://github.com/yfthcn/yazit/compare/v2.5.2...HEAD
[2.5.2]: https://github.com/yfthcn/yazit/releases/tag/v2.5.2
[2.5.1]: https://github.com/yfthcn/yazit/releases/tag/v2.5.1
[2.5.0]: https://github.com/yfthcn/yazit/releases/tag/v2.5.0
[1.1.0]: https://github.com/yfthcn/yazit/releases/tag/v1.1.0
[1.0.8]: https://github.com/yfthcn/yazit/releases/tag/v1.0.8