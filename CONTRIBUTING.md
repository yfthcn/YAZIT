# Contributing to YAZIT

Thanks for your interest in YAZIT! This document outlines the project's philosophy and how to contribute effectively.

## Project Philosophy

YAZIT is intentionally **minimal** and **dependency-free**. Before opening a PR, please understand and respect these constraints:

- **Zero npm dependencies.** No `package.json`, no `node_modules`. The extension ships exactly what's in source — no bundling, no transpilation, no minification.
- **Zero CDN.** All resources are local. No `<script src="https://...">`.
- **Vanilla JavaScript.** No React, Vue, jQuery, or any framework. Use native DOM APIs.
- **MV3-only.** Manifest V2 support has been dropped permanently.
- **Native browser features only.** If a feature isn't supported in Chrome 105+ AND Firefox 140+ (`minimum_chrome_version` in the manifest is the source of truth), don't use it.
- **No tracking, no telemetry, no external network calls.** "Private by design" is the core value.

If your contribution conflicts with any of these, it likely won't be merged — but feel free to open an issue first to discuss.

## Project Structure

```
yazit/
├── manifest.json     # MV3 manifest (Chrome format; build.py converts for Firefox)
├── build.py          # Python build script (stdlib only, no pip required)
├── common.js         # Shared TL namespace (i18n, storage, escape, helpers)
├── background.js     # Service worker (Chrome) / background scripts (Firefox)
├── content.js        # Injected into all pages — paste, slash command, focus tracking
├── popup.html/.js    # Toolbar popup — template list
├── options.html/.js  # Settings page — CRUD, import/export
├── icons/            # 16/48/128 px PNG icons
├── _locales/         # WebExtension i18n (en, tr)
└── dist/             # build.py output (gitignored)
```

## Building Locally

You need Python 3.8+ (no other dependencies):

```bash
python3 build.py
```

This produces:
- `dist/yazit-chrome.zip` — for Chrome / Edge / Brave / Opera
- `dist/yazit-firefox.zip` — for Firefox 140+

### Loading in Chromium browsers (Chrome / Edge / Brave / Opera)
1. Go to `chrome://extensions` (or `edge://extensions`, etc.)
2. Enable **Developer mode**
3. Click **Load unpacked** and select the project root (or extract `yazit-chrome.zip`)

### Loading in Firefox
1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `dist/yazit-firefox.zip` or any file inside the extracted folder

> **Note:** After installing/reloading the extension, refresh any open tabs. Content scripts don't auto-inject into pre-existing tabs.

## Code Style

- Use `const` by default, `let` only when reassignment is needed; never `var`.
- Prefer arrow functions for callbacks, regular `function` declarations for top-level helpers.
- Use template literals for string interpolation.
- Use optional chaining (`?.`) and nullish coalescing (`??`).
- Indentation: 2 spaces.
- No semicolons-optional debate: **use semicolons**.
- All user-facing strings must go through `TL.t("key")` (i18n) — both `_locales/en/messages.json` and `_locales/tr/messages.json` need entries.

## Testing

There's no automated test suite. Manual smoke test before submitting a PR:

- [ ] Popup: click each template, paste works in a normal `<input>`
- [ ] Keyboard shortcut: `Ctrl+Shift+1` pastes the first template
- [ ] Slash command: `/shortcut + space` expands in `<input>`, `<textarea>`, and contentEditable
- [ ] Placeholder modal: `{{var}}`-containing template prompts for values
- [ ] Options: Add / Edit / Delete / Reorder / Import / Export all work
- [ ] System pages: popup shows error on `chrome://`, `about:`, etc.
- [ ] Both Chromium and Firefox builds load without errors

## Submitting a PR

1. Fork the repo
2. Create a topic branch (`feat/...`, `fix/...`, `docs/...`)
3. Make your changes — keep commits focused
4. Update `CHANGELOG.md` under `## [Unreleased]` section
5. Bump version in `manifest.json` only if maintainer asks
6. Open a PR using the template

## Reporting Bugs

Use the GitHub issue tracker with the **Bug report** template. Include:
- Browser and version
- Extension version
- Steps to reproduce
- What you expected vs what actually happened
- Console errors (F12 → Console)

## License

By contributing, you agree your contributions are licensed under GPL-3.0 (same as the project).
