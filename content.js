// @ts-check
// ==============================
// YAZIT — Content script
// ==============================
// Injected on all pages/frames. Tracks focused inputs, pastes templates
// (plain-text, framework-safe), resolves dynamic variables + placeholder
// forms, and powers slash-command expansion and the slash autocomplete.
// ==============================

(function () {
  "use strict";

  // Per-frame double-load guard. The executeScript fallback in
  // common.js#pasteToTab re-injects this file; without this guard the IIFE
  // would re-run and register a second keydown/onMessage listener, causing
  // double pastes. (Plan step 2)
  if (self.__TL_CONTENT_LOADED__) return;
  self.__TL_CONTENT_LOADED__ = true;

  // Inert in tiny/invisible subframes (ad/tracking iframes) to cut the
  // all_frames cost — they never hold a real editor. (Plan step 9)
  if (self !== self.top) {
    const w = self.innerWidth, h = self.innerHeight;
    if ((w > 0 && w < 60) || (h > 0 && h < 60)) return;
  }

  // --- In-page UI strings (uiLang override support) ---
  // chrome.i18n always follows the BROWSER language; if the user picked an
  // explicit language in options (uiLang !== "auto") the in-page form/toast
  // must honor it. Content scripts can't fetch _locales (not web-accessible),
  // so the background relays the handful of keys we need. Zero overhead for
  // the default ("auto") case.
  const CONTENT_I18N_KEYS = ["formHeading", "formCancel", "formPaste", "needFocus", "formRequired", "formOther", "formClipboard", "formClipboardFail", "condBrokenSkipped"];
  let contentStrings = null;   // null = not loaded; {} = use chrome.i18n fallback
  let stringsLoading = null;
  function ensureStrings() {
    if (contentStrings) return Promise.resolve();
    if (stringsLoading) return stringsLoading;
    stringsLoading = (async () => {
      try {
        const { uiLang = "auto" } = await chrome.storage.local.get("uiLang");
        if (uiLang === "auto") { contentStrings = {}; return; }
        const res = await chrome.runtime.sendMessage({ type: "GET_UI_STRINGS", keys: CONTENT_I18N_KEYS });
        contentStrings = (res && res.strings) || {};
      } catch (_) {
        contentStrings = {}; // background unavailable — chrome.i18n fallback
      } finally {
        stringsLoading = null;
      }
    })();
    return stringsLoading;
  }
  const t = (k, s) => (contentStrings && contentStrings[k]) || TL.t(k, s);

  // --- In-page UI theme (uiTheme override support) ---
  // Same lazy pattern as the strings: one storage read the first time any
  // in-page UI can appear (editable focus → autocomplete, or a paste), never
  // at injection time in every frame. Until it lands, "auto" = the OS theme,
  // which is exactly the pre-setting behaviour.
  let themePref = /** @type {"auto"|"light"|"dark"} */ ("auto");
  let themeLoaded = false;
  let themeLoading = null;
  function ensureTheme() {
    if (themeLoaded) return Promise.resolve();
    if (themeLoading) return themeLoading;
    themeLoading = chrome.storage.local.get("uiTheme")
      .then(({ uiTheme }) => { themePref = TL.normalizeTheme(uiTheme); })
      .catch(() => { /* context invalidated etc. → stay on auto */ })
      .finally(() => { themeLoaded = true; themeLoading = null; bindOnChanged(); });
    return themeLoading;
  }
  /** The theme the in-page UI should render in right now. */
  const resolvedTheme = () =>
    themePref === "auto"
      ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : themePref;

  // --- State ---
  let lastFocusedElement = null;
  let templateCache = null; // null = not loaded yet (lazy)
  let cacheLoading = null;  // in-flight promise (coalesces concurrent loads)
  let onChangedBound = false;

  // --- Lazy template cache (plan steps 8/9) ---
  // No eager load. ensureCache() fires on first editable focus and before a
  // paste; the storage.onChanged listener is only wired once we've loaded.
  function ensureCache() {
    if (templateCache) return Promise.resolve(templateCache);
    if (cacheLoading) return cacheLoading;
    ensureTheme(); // the autocomplete this cache feeds is themed UI too
    cacheLoading = TL.getTemplates()
      .then((list) => {
        templateCache = list || [];
        bindOnChanged();
        return templateCache;
      })
      .catch((err) => {
        console.error("[YAZIT] Cache load failed:", err);
        templateCache = [];
        return templateCache;
      })
      .finally(() => { cacheLoading = null; });
    return cacheLoading;
  }

  function bindOnChanged() {
    if (onChangedBound) return;
    onChangedBound = true;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      // ensureTheme can bind this before the template cache exists; a
      // templates change then must not seed the cache with the raw, un-migrated
      // store — ensureCache's TL.getTemplates will load it properly.
      if (changes.templates && templateCache) {
        const next = /** @type {any[]} */ (changes.templates.newValue || []);
        templateCache = next.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      }
      if (changes.uiLang) contentStrings = null; // re-fetch on next use
      if (changes.uiTheme) themePref = TL.normalizeTheme(changes.uiTheme.newValue);
    });
  }

  // --- Track last focused editable element + warm the cache ---
  document.addEventListener(
    "focusin",
    (e) => {
      const el = e.target;
      if (el && isEditable(el)) {
        lastFocusedElement = el;
        reportFocus();
        ensureCache();
      }
    },
    true
  );

  // Tell the background which frame holds the newest editable focus so
  // popup/shortcut pastes target this frame only (TL.pickTargetFrame). One
  // tiny message per editable focusin; a stale extension context is ignored.
  function reportFocus() {
    // A SUBFRAME only gets to claim the tab's paste target once the user has
    // actually interacted with that frame. Without this, any third-party
    // iframe on the page could focus its own hidden editable at load time and
    // silently become the destination for the next popup/shortcut paste.
    // navigator.userActivation is Chrome 72+ / Firefox 120+, both below this
    // extension's declared minimums (105 / 140), so there is no fallback path
    // to keep in sync. The top frame is exempt: it is the page the user chose.
    if (self !== self.top && !navigator.userActivation?.hasBeenActive) { armFocusRetry(); return; }
    try {
      const p = chrome.runtime.sendMessage({ type: "FOCUS" });
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (_) { /* extension reloaded underneath us */ }
  }

  // Tabbing INTO an iframe activates the parent, not the child: user
  // activation propagates to ancestors, never to descendants. So a keyboard
  // user who tabs into an iframe editor and pastes before typing had no way
  // to register the frame, and the report above was dropped for good. Wait
  // for the first event that does activate THIS frame and report once then.
  let focusRetryArmed = false;
  function armFocusRetry() {
    if (focusRetryArmed) return;
    focusRetryArmed = true;
    const retry = () => {
      if (!isUsableTarget(lastFocusedElement)) return; // focus moved on; nothing to claim
      off();
      reportFocus();
    };
    const off = () => {
      focusRetryArmed = false;
      for (const ev of ["keydown", "input", "pointerdown"]) removeEventListener(ev, retry, true);
    };
    for (const ev of ["keydown", "input", "pointerdown"]) addEventListener(ev, retry, true);
  }

  // A paste target must be a LIVE, VISIBLE editable — not merely "the last
  // thing that reported focus". Under <all_urls> + all_frames any frame on the
  // page, including a third-party ad iframe, can focus a hidden
  // contentEditable, register itself as the tab's focus frame (the FOCUS
  // message below) and have the next popup/shortcut paste delivered into it —
  // which reads the template, passwords included.
  //
  // Deliberately NOT gated on document.hasFocus(): while the popup is open the
  // page is not the focused document, which is precisely why
  // lastFocusedElement exists. That check would break every popup paste.
  function isUsableTarget(el) {
    if (!isEditable(el)) return false;
    if (!el.isConnected) return false;          // detached by a re-render
    // getClientRects().length > 0 is NOT a visibility test — it only rules out
    // display:none and detached nodes. opacity:0, visibility:hidden, a 1x1 box
    // and anything parked at left:-9999px all return rects, so a hostile frame
    // could keep an invisible contentEditable focused, register itself as the
    // tab's paste target and receive the template — password included.
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    if (Number(cs.opacity) < 0.1) return false;

    // Hit-testing is a SUBFRAME rule, deliberately. The threat it answers is a
    // third-party iframe keeping an invisible editor focused to catch the next
    // paste. The top frame is the page the user chose to be on, and a hostile
    // top page can already read its own fields — probing it buys nothing and
    // costs real editors: a ticket composer taller than the window, a
    // placeholder overlay, a sticky toolbar. Those all failed the probe.
    if (self === self.top) return true;
    return TL.visibleHit(r, { width: innerWidth, height: innerHeight }, (x, y) => {
      // elementFromPoint retargets out of a shadow tree to the host, so accept
      // the element, something inside it, or an ancestor that contains it.
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
    });
  }

  function isEditable(el) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName === "INPUT") {
      const type = (el.type || "text").toLowerCase();
      // password intentionally excluded (privacy + AMO review principle).
      return ["text", "search", "email", "url", "tel", ""].includes(type);
    }
    return el.isContentEditable === true;
  }

  // Native setter so React/Vue/Angular detect the change.
  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  const CURSOR = TL.CURSOR_TOKEN;
  // Every paste entry point (message, slash, autocomplete) goes through here so
  // a rejected handlePaste is reported instead of silently unhandled.
  const runPaste = (template) =>
    handlePaste(template).catch((err) => console.error("[YAZIT] Paste failed:", err));
  const stripCursor = (s) => s.split(CURSOR).join("");

  // ============================================================
  // Paste — plain-text, undo-preserving (plan step 3)
  // ============================================================
  function pasteIntoElement(el, text) {
    if (!el) return false;

    // 1. Plain textarea / input
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const newValue = el.value.slice(0, start) + stripCursor(text) + el.value.slice(end);
      setNativeValue(el, newValue);
      placeCaretInInput(el, start, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    // 2. ContentEditable (TinyMCE, CKEditor, Quill, ProseMirror, Gmail…)
    if (el.isContentEditable) {
      el.focus();
      const markerIdx = text.indexOf(CURSOR);
      const plain = stripCursor(text);
      // insertText — plain text, preserves the editor's own undo stack and
      // model far better than insertHTML; no HTML injection. Routed through
      // TL.editorAdapter so the execCommand backend lives in one place.
      let ok = TL.editorAdapter.insertText(plain);
      if (!ok) {
        const sel = window.getSelection();
        if (!sel?.rangeCount) return false; // no caret anywhere — nothing was pasted
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(plain));
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      // sel.modify steps by user-perceived character, not UTF-16 unit — count
      // code points so an emoji after {{cursor}} doesn't throw the caret off.
      if (markerIdx >= 0) moveCaretBackEditable(codePoints(plain.slice(markerIdx)));
      return true;
    }
    return false;
  }

  // After inserting into an input/textarea, honour a {{cursor}} marker;
  // otherwise place caret at end of inserted text.
  function placeCaretInInput(el, start, insertedWithMarker) {
    const markerIdx = insertedWithMarker.indexOf(CURSOR);
    const pos = markerIdx >= 0 ? start + markerIdx : start + stripCursor(insertedWithMarker).length;
    el.setSelectionRange?.(pos, pos);
  }

  const codePoints = (s) => { let n = 0; for (const _ of s) n++; return n; };

  function moveCaretBackEditable(steps) {
    const sel = window.getSelection();
    if (!sel || steps <= 0) return;
    for (let i = 0; i < steps; i++) sel.modify?.("move", "backward", "character");
  }

  // ============================================================
  // Shared in-page theme (modal, toast, autocomplete, form) — light/dark.
  // One CSS string; the host carries data-yazit-theme (resolved, never
  // "auto"), set by makeShadowHost/applyHostTheme. Namespaced on purpose: the
  // host sits in the PAGE's DOM, and plenty of sites style a bare
  // [data-theme="dark"] — outer rules beat :host ones, so a generic name
  // would let the page repaint our backdrop.
  // ============================================================
  const THEME_CSS = `
    :host { all: initial; }
    /* YAZIT palette — same tokens as popup/options. \`all\` does not reset
       custom properties, so they are declared on the host after it. */
    :host {
      --tl-primary: #e8a33d; --tl-primary-hover: #d4912a; --tl-on-primary: #1a1408;
      --tl-primary-text: #8f5d10; --tl-primary-soft: #fbf0dc; --tl-ring: rgba(232,163,61,.28);
      --tl-raised: #ffffff; --tl-field: #ffffff; --tl-hover: #f3efe6;
      --tl-border: #e6e0d4; --tl-input-border: #d8d0c0;
      --tl-text: #1c1a16; --tl-label: #4a4438; --tl-muted: #6f6858;
      --tl-danger: #c2410c; --tl-toast: #1c1a16; --tl-on-toast: #f3efe6;
      /* \`all: initial\` resets the inherited color-scheme to "normal", which
         left native pickers (select, date) light inside the dark form. */
      color-scheme: light;
    }
    :host([data-yazit-theme="dark"]) {
      color-scheme: dark;
      --tl-primary-hover: #f0b35a; --tl-primary-text: #f0b95a; --tl-primary-soft: #1c2b47;
      --tl-raised: #16213a; --tl-field: #0a1122; --tl-hover: #1f2c48;
      --tl-border: #22304d; --tl-input-border: #2f3f62;
      --tl-text: #e7edf7; --tl-label: #c5d0e3; --tl-muted: #8e9bb6;
      --tl-danger: #f28b6b; --tl-toast: #16213a;
    }
    * { box-sizing: border-box; }
    .tl-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .tl-modal {
      background: var(--tl-raised); color: var(--tl-text);
      padding: 24px; border-radius: 10px;
      min-width: 380px; max-width: 520px; width: 92%;
      box-shadow: 0 20px 50px rgba(0,0,0,0.35);
      max-height: 85vh; overflow-y: auto;
    }
    .tl-modal h3 { margin: 0 0 6px; font-size: 16px; font-weight: 600; }
    .tl-tname { margin: 0 0 16px; font-size: 13px; color: var(--tl-muted); font-weight: 500; }
    label { display: block; margin-bottom: 12px; font-size: 13px; color: var(--tl-label); }
    label span.lbl { display: block; margin-bottom: 5px; font-weight: 600; }
    input, select, textarea {
      width: 100%; padding: 9px 11px;
      border: 1px solid var(--tl-input-border); border-radius: 6px;
      font-size: 14px; font-family: inherit;
      background: var(--tl-field); color: var(--tl-text);
    }
    textarea { min-height: 70px; resize: vertical; }
    .tl-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 14px; }
    .tl-grid label.wide { grid-column: 1 / -1; }
    .tl-modal.wide { max-width: 680px; }
    label.tl-check { display: flex; align-items: center; gap: 8px; }
    label.tl-check input { width: auto; margin: 0; accent-color: var(--tl-primary); }
    label.tl-check span.lbl { margin: 0; }
    .tl-req { color: var(--tl-danger); margin-left: 2px; }
    .tl-field-wrap { position: relative; display: flex; gap: 6px; align-items: stretch; }
    .tl-field-wrap > input, .tl-field-wrap > textarea, .tl-field-wrap > select { flex: 1; min-width: 0; }
    .tl-clip {
      flex: 0 0 auto; padding: 0 10px; border: 1px solid var(--tl-input-border); border-radius: 6px;
      background: var(--tl-hover); color: var(--tl-label); font-size: 13px; cursor: pointer;
    }
    .tl-clip:hover { background: var(--tl-primary-soft); border-color: var(--tl-primary); }
    .tl-other { margin-top: 6px; }
    .tl-invalid { border-color: var(--tl-danger) !important; box-shadow: 0 0 0 3px rgba(194,65,12,0.18) !important; }
    .tl-err { color: var(--tl-danger); font-size: 12px; margin-top: 4px; min-height: 14px; }
    input:focus, select:focus, textarea:focus {
      outline: none; border-color: var(--tl-primary);
      box-shadow: 0 0 0 3px var(--tl-ring);
    }
    .tl-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }
    button {
      padding: 9px 18px; border-radius: 6px; cursor: pointer;
      font-size: 14px; font-family: inherit; font-weight: 500;
    }
    .tl-cancel { border: 1px solid var(--tl-input-border); background: var(--tl-raised); color: var(--tl-label); }
    .tl-cancel:hover { background: var(--tl-hover); }
    .tl-submit { border: none; background: var(--tl-primary); color: var(--tl-on-primary); font-weight: 600; }
    .tl-submit:hover { background: var(--tl-primary-hover); }
    .tl-submit:focus-visible, .tl-cancel:focus-visible { outline: 2px solid var(--tl-primary-text); outline-offset: 2px; }
    .tl-toast {
      font-family: system-ui, -apple-system, sans-serif;
      background: var(--tl-toast); color: var(--tl-on-toast); padding: 12px 18px;
      border-radius: 8px; font-size: 14px; max-width: 340px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.25); border-left: 3px solid var(--tl-primary);
      animation: tlIn .2s ease-out, tlOut .3s ease-in 3s forwards;
    }
    @keyframes tlIn { from { transform: translateX(20px); opacity: 0; } to { transform: none; opacity: 1; } }
    @keyframes tlOut { to { opacity: 0; transform: translateX(20px); } }
    .tl-ac {
      position: fixed; z-index: 2147483647; min-width: 220px; max-width: 360px;
      background: var(--tl-raised); color: var(--tl-text); border: 1px solid var(--tl-border); border-radius: 8px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.18); overflow: hidden;
      font-family: system-ui, -apple-system, sans-serif; font-size: 13px;
    }
    .tl-ac-item { display: flex; justify-content: space-between; gap: 12px; padding: 8px 12px; cursor: pointer; }
    .tl-ac-item .nm { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tl-ac-item .sc { color: var(--tl-muted); font-family: ui-monospace, monospace; }
    .tl-ac-item.active { background: var(--tl-primary-soft); box-shadow: inset 3px 0 0 var(--tl-primary); }
    /* The toast is the only animated thing we inject into a page. Drop the
       slide entirely under "reduce motion" — showToast removes the host on a
       timer, so nothing depends on tlOut ever running. */
    @media (prefers-reduced-motion: reduce) {
      .tl-toast { animation: none; }
    }
  `;

  // Parse the theme CSS ONCE into a constructable stylesheet shared by every
  // shadow host (modern; avoids re-parsing the CSS string per modal/toast/
  // dropdown). Falls back to a <style> element on engines without it.
  //
  // Built on FIRST USE, not at load. This file runs in every frame of every
  // page, and the overwhelming majority of those frames never show a modal,
  // a toast or the autocomplete — parsing 4 KB of CSS eagerly spent that on
  // all of them to serve the few. `null` is also the "no support" value, so
  // the flag is what distinguishes "not built yet" from "cannot build".
  let themeSheet = null;
  let themeSheetBuilt = false;
  function getThemeSheet() {
    if (!themeSheetBuilt) {
      themeSheetBuilt = true;
      try {
        themeSheet = new CSSStyleSheet();
        themeSheet.replaceSync(THEME_CSS);
      } catch (_) { themeSheet = null; }
    }
    return themeSheet;
  }

  /** @param {HTMLElement} host */
  function applyHostTheme(host) {
    host.setAttribute("data-yazit-theme", resolvedTheme());
  }

  function makeShadowHost(positionCss) {
    const host = document.createElement("div");
    host.style.cssText = positionCss;
    applyHostTheme(host);
    const shadow = host.attachShadow({ mode: "closed" });
    const sheet = getThemeSheet();
    if (sheet) {
      shadow.adoptedStyleSheets = [sheet];
    } else {
      const style = document.createElement("style");
      style.textContent = THEME_CSS;
      shadow.appendChild(style);
    }
    return { host, shadow };
  }

  // ============================================================
  // Placeholder form (Shadow DOM, dark-aware) — smart fields (plan step 11)
  // ============================================================
  function showPlaceholderForm(fields, templateName, lastValues) {
    return new Promise((resolve) => {
      const { host, shadow } = makeShadowHost("position:fixed;inset:0;z-index:2147483647;");
      const backdrop = document.createElement("div");
      backdrop.className = "tl-backdrop";

      // Two-column layout once the form gets tall (6+ fields); multiline and
      // checkbox rows span both columns so they stay readable.
      const twoCol = fields.length >= 6;
      const modal = document.createElement("div");
      modal.className = "tl-modal" + (twoCol ? " wide" : "");
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-labelledby", "tl-h");

      const heading = document.createElement("h3");
      heading.id = "tl-h";
      heading.textContent = t("formHeading");
      modal.appendChild(heading);

      if (templateName) {
        const nameEl = document.createElement("div");
        nameEl.className = "tl-tname";
        nameEl.textContent = templateName;
        modal.appendChild(nameEl);
      }

      const form = document.createElement("form");
      form.noValidate = true;
      const grid = document.createElement("div");
      if (twoCol) grid.className = "tl-grid";
      form.appendChild(grid);

      /** @type {Array<{f:any, get:()=>string, set:(v:string)=>void, ctrl:any, dirty:boolean, err:HTMLElement}>} */
      const rows = [];
      const readValues = () => { const v = {}; for (const r of rows) v[r.f.name] = r.get(); return v; };

      for (const f of fields) {
        const labelEl = document.createElement("label");
        const isWide = f.type === "multiline" || f.type === "checkbox";
        if (twoCol && isWide) labelEl.classList.add("wide");
        const spanEl = document.createElement("span");
        spanEl.className = "lbl";
        spanEl.textContent = f.label || f.name;
        if (f.required && f.type !== "checkbox") {
          const star = document.createElement("span");
          star.className = "tl-req"; star.textContent = "*";
          star.setAttribute("aria-hidden", "true");
          spanEl.appendChild(star);
        }

        const remembered = (f.remember && lastValues && lastValues[f.name]) || "";
        // Defaults may reference other fields ({{ticket}} inside a default);
        // they're resolved live until the user edits the field themselves.
        const dynDef = /\{\{[^{}]+\}\}/.test(f.def || "");
        const initial = remembered || (dynDef ? "" : (f.def || ""));

        const row = { f, get: () => "", set: (_v) => {}, ctrl: null, dirty: !!remembered, err: null };
        let control;

        if (f.type === "checkbox") {
          labelEl.className = "tl-check";
          control = document.createElement("input");
          control.type = "checkbox";
          control.checked = remembered ? remembered === "true" : /^(true|1|yes|on)$/i.test(f.def || "");
          labelEl.append(control, spanEl);
          row.get = () => (control.checked ? "true" : "");
          row.set = (v) => { control.checked = v === "true"; };
        } else {
          labelEl.appendChild(spanEl);
          const wrap = document.createElement("div");
          wrap.className = "tl-field-wrap";
          if (f.type === "dropdown" && f.options.length) {
            const hasOther = f.options.includes("*");
            const opts = f.options.filter((o) => o !== "*");
            control = document.createElement("select");
            for (const opt of opts) {
              const o = document.createElement("option");
              o.value = opt; o.textContent = opt;
              control.appendChild(o);
            }
            let otherInput = null;
            if (hasOther) {
              const o = document.createElement("option");
              o.value = "\u0000other"; o.textContent = t("formOther");
              control.appendChild(o);
              otherInput = document.createElement("input");
              otherInput.type = "text";
              otherInput.className = "tl-other";
              otherInput.hidden = true;
              control.addEventListener("change", () => {
                const on = control.value === "\u0000other";
                otherInput.hidden = !on;
                if (on) otherInput.focus();
              });
            }
            const want = initial || opts[0] || "";
            if (opts.includes(want)) control.value = want;
            else if (hasOther && want) { control.value = "\u0000other"; otherInput.value = want; otherInput.hidden = false; }
            wrap.appendChild(control);
            labelEl.appendChild(wrap);
            if (otherInput) labelEl.appendChild(otherInput);
            row.get = () => (control.value === "\u0000other" ? (otherInput ? otherInput.value : "") : control.value);
            row.set = (v) => { if (opts.includes(v)) control.value = v; };
          } else if (f.type === "multiline") {
            control = document.createElement("textarea");
            control.value = initial;
            wrap.appendChild(control);
            wrap.appendChild(clipButton(control));
            labelEl.appendChild(wrap);
            row.get = () => control.value;
            row.set = (v) => { control.value = v; };
          } else if (f.type === "date") {
            control = document.createElement("input");
            control.type = "date";
            control.value = remembered || TL.resolveDateDefault(f.def);
            wrap.appendChild(control);
            labelEl.appendChild(wrap);
            row.get = () => TL.formatIsoDate(control.value, f.options[0]);
            row.set = (v) => { control.value = v; };
          } else {
            control = document.createElement("input");
            control.type = "text";
            control.value = initial;
            wrap.appendChild(control);
            wrap.appendChild(clipButton(control));
            labelEl.appendChild(wrap);
            row.get = () => control.value;
            row.set = (v) => { control.value = v; };
          }
          const err = document.createElement("div");
          err.className = "tl-err";
          labelEl.appendChild(err);
          row.err = err;
        }
        row.ctrl = control;
        control.addEventListener("input", () => { row.dirty = true; control.classList.remove("tl-invalid"); if (row.err) row.err.textContent = ""; });
        grid.appendChild(labelEl);
        rows.push(row);
      }

      // Live cross-field defaults: recompute every untouched dynamic default
      // from the current values on any input.
      const dynRows = rows.filter((r) => /\{\{[^{}]+\}\}/.test(r.f.def || ""));
      const refreshDefaults = () => {
        if (!dynRows.length) return;
        const values = readValues();
        for (const r of dynRows) {
          if (r.dirty) continue;
          r.set(TL.fillTemplate(r.f.def, values).replace(/\{\{[^{}]+\}\}/g, ""));
        }
      };
      if (dynRows.length) { form.addEventListener("input", refreshDefaults); refreshDefaults(); }

      const actions = document.createElement("div");
      actions.className = "tl-actions";
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button"; cancelBtn.className = "tl-cancel";
      cancelBtn.textContent = t("formCancel");
      const submitBtn = document.createElement("button");
      submitBtn.type = "submit"; submitBtn.className = "tl-submit";
      submitBtn.textContent = t("formPaste");
      actions.appendChild(cancelBtn);
      actions.appendChild(submitBtn);
      form.appendChild(actions);

      modal.appendChild(form);
      backdrop.appendChild(modal);
      shadow.appendChild(backdrop);
      document.body.appendChild(host);
      rows[0]?.ctrl?.focus();

      // Isolate the form from the host page. Events leave a shadow root with
      // composed:true, and pages like Google Docs, Notion or Gmail (single-key
      // shortcuts) react to document-level keydown by yanking focus back to
      // their own editor.
      //
      // Two layers, because stopping propagation at window-capture stops the
      // event BEFORE it reaches our own listeners inside the shadow root
      // (2.4.1–2.4.3 shipped exactly that bug: Cancel, backdrop-close, the
      // clipboard button and dirty-tracking never fired):
      //  - KEY events: window-capture stopImmediatePropagation. Pages hook
      //    keydown in capture phase too, so this must run first. Nothing in
      //    the form listens for keys (Esc is handled right here, Enter-to-
      //    submit and Tab are default actions, which propagation doesn't
      //    affect).
      //  - Everything else: stopPropagation on the HOST in bubble phase. Our
      //    shadow-internal listeners (click/input/mousedown) run first, then
      //    the event is stopped at the host so no document/window bubble
      //    listener of the page sees it.
      const KEY_EVS = ["keydown", "keyup", "keypress"];
      const HOST_EVS = ["input", "beforeinput", "mousedown", "mouseup", "click", "focusin", "focusout"];
      const keyIsolate = (e) => {
        if (!e.composedPath().includes(host)) return;
        e.stopImmediatePropagation();
        if (e.type === "keydown" && e.key === "Escape") { cleanup(); resolve(null); }
      };
      const hostIsolate = (e) => e.stopPropagation();
      for (const ev of KEY_EVS) window.addEventListener(ev, keyIsolate, true);
      for (const ev of HOST_EVS) host.addEventListener(ev, hostIsolate);

      const cleanup = () => {
        for (const ev of KEY_EVS) window.removeEventListener(ev, keyIsolate, true);
        host.remove();
      };
      cancelBtn.addEventListener("click", () => { cleanup(); resolve(null); });
      backdrop.addEventListener("mousedown", (e) => {
        if (e.target === backdrop) { cleanup(); resolve(null); }
      });
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        // Required check: block paste on the first empty required field.
        let firstBad = null;
        for (const r of rows) {
          if (!r.f.required || r.f.type === "checkbox") continue;
          if (r.get().trim() === "") {
            r.ctrl.classList.add("tl-invalid");
            if (r.err) r.err.textContent = t("formRequired");
            firstBad = firstBad || r.ctrl;
          }
        }
        if (firstBad) { firstBad.focus(); return; }
        const values = readValues();
        const remember = {};
        for (const r of rows) if (r.f.remember) remember[r.f.name] = r.f.type === "date" ? r.ctrl.value : values[r.f.name];
        cleanup();
        resolve({ values, remember });
      });
    });
  }

  // "Paste from clipboard" button for text fields. Uses the async clipboard
  // API inside the click gesture — Firefox shows its paste prompt, Chrome may
  // ask once per site. No manifest permission is added for this.
  function clipButton(control) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tl-clip";
    btn.textContent = "\u{1F4CB}";
    btn.title = t("formClipboard");
    btn.setAttribute("aria-label", t("formClipboard"));
    btn.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (typeof text !== "string") throw new Error("empty");
        const s = control.selectionStart ?? control.value.length;
        const e = control.selectionEnd ?? control.value.length;
        control.value = control.value.slice(0, s) + text + control.value.slice(e);
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.focus();
      } catch (_) {
        btn.title = t("formClipboardFail");
        control.focus();
      }
    });
    return btn;
  }

  // --- Toast ---
  function showToast(message) {
    const { host, shadow } = makeShadowHost("position:fixed;top:20px;right:20px;z-index:2147483647;");
    const toast = document.createElement("div");
    toast.className = "tl-toast";
    toast.textContent = message;
    shadow.appendChild(toast);
    document.body.appendChild(host);
    setTimeout(() => host.remove(), 3500);
  }

  // ============================================================
  // Main paste flow — dynamic vars → fields → fill → insert → caret
  // ============================================================
  async function handlePaste(template) {
    await Promise.all([ensureStrings(), ensureTheme()]);
    const active = document.activeElement;
    const target = isUsableTarget(active)
      ? active
      : (isUsableTarget(lastFocusedElement) ? lastFocusedElement : null);
    if (!target) lastFocusedElement = null; // stop holding a dead node

    // tabs.sendMessage without a frameId delivers PASTE_TEMPLATE to EVERY
    // frame in the tab; only the frame that actually holds a target should
    // act. Frames with no target stay silent — except the top frame, which
    // shows the "focus a field first" toast (otherwise a page with N iframes
    // would stack N toasts for a single popup click).
    if (!target) {
      if (self === self.top) showToast(t("needFocus"));
      return;
    }

    const isHtml = template.format === "html";
    const withVars = TL.applyDynamicVars(template.body);
    // applyConditionals refuses to resolve an unbalanced body (it would leak
    // raw markers either way, and on an unclosed chain the regex is cubic).
    // Say so, because the alternative is the user discovering "{{#if}}" in a
    // message they already sent.
    if (TL.checkConditionals(withVars)) showToast(t("condBrokenSkipped"));
    const fields = TL.parseFields(withVars);

    let filled = withVars;
    let formShown = false;
    if (fields.length > 0) {
      const lastValues = await TL.getLastValues(template.id);
      const result = await showPlaceholderForm(fields, template.name, lastValues);
      if (!result) return;
      // Conditionals first (dropped branches never leak their placeholders),
      // then substitution. For HTML, every user value is escaped BEFORE it
      // lands in the markup.
      const resolved = TL.applyConditionals(withVars, result.values);
      filled = TL.fillTemplate(resolved, result.values, { escape: isHtml });
      if (Object.keys(result.remember).length) TL.saveLastValues(template.id, result.remember);
      formShown = true;
    }

    const doPaste = isHtml
      ? () => pasteHtmlIntoElement(target, TL.sanitizeHtml(filled)) // sanitize is ALWAYS the last pass
      : () => pasteIntoElement(target, filled);

    target.focus();
    if (formShown) setTimeout(doPaste, 30); // let focus settle after the modal closes
    else doPaste();
  }

  // --- Rich (HTML) paste: contentEditable gets sanitized HTML; input/textarea degrade ---
  function pasteHtmlIntoElement(el, safeHtml) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      return pasteIntoElement(el, TL.htmlToPlainText(safeHtml));
    }
    if (el.isContentEditable) {
      el.focus();
      const hasCursor = safeHtml.includes(CURSOR);
      // safeHtml is sanitizeHtml output; routed through the editor adapter.
      let ok = TL.editorAdapter.insertHtml(safeHtml);
      if (!ok) {
        const sel = window.getSelection();
        if (!sel?.rangeCount) return false; // no caret anywhere — nothing was pasted
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(TL.htmlToFragment(safeHtml)); // already sanitized; DOMParser, not createContextualFragment
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      if (hasCursor) placeCaretAtSentinel(el);
      return true;
    }
    return false;
  }

  // Locate the {{cursor}} sentinel that we inserted as a text char, place the
  // caret there and remove it. Falls back silently to end-of-insertion.
  function placeCaretAtSentinel(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const idx = node.nodeValue.indexOf(CURSOR);
      if (idx < 0) continue;
      node.nodeValue = node.nodeValue.slice(0, idx) + node.nodeValue.slice(idx + CURSOR.length);
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStart(node, idx);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
  }

  // --- Message listener (from popup / background) ---
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Only trust messages originating from our own extension (popup/background).
    if (sender?.id !== chrome.runtime.id) return;
    if (msg?.type === "PASTE_TEMPLATE" && msg.template && typeof msg.template === "object") {
      // A broadcast reached every frame because the target frame was unknown.
      // The top frame is the page the user chose, so it always answers; a
      // subframe only does once the user has actually interacted with it.
      // That keeps the iframe editors people really use (Gmail, TinyMCE —
      // the user clicked into them) while a passive third-party frame stays
      // silent instead of quietly catching the paste. Answering nothing here
      // is safe: other frames still respond, and if none does the sender
      // falls through to its injection path.
      if (msg.broadcast && self !== self.top && !navigator.userActivation?.hasBeenActive) return;
      // Defense in depth: re-clamp the payload through the same normalizer
      // storage uses (name/shortcut/body caps, format whitelist, sanitized
      // HTML). The sender is us, but the cost is one small object.
      const [template] = TL.migrate({ templates: [msg.template] }).templates;
      ensureCache(); // warm for later slash use — the paste itself doesn't need it
      runPaste(template);
      sendResponse({ ok: true }); // synchronous — no async channel to keep open
      return;
    }
    // Unknown type: return nothing so the sender's promise isn't held open.
  });

  // ============================================================
  // Slash command expansion (exact match on space/enter/tab) — step 1/3
  // ============================================================
  function getSlashContext(el) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const pos = el.selectionStart ?? 0;
      // Only the last few chars can hold a "/shortcut" token; copying the whole
      // value up to the caret is wasteful in long fields. The slash regex is
      // end-anchored, so a window of MAX_SHORTCUT + 2 ("/" + chars + slack) is
      // sufficient and keeps `start = pos - m[0].length` correct.
      const from = Math.max(0, pos - (TL.LIMITS.MAX_SHORTCUT + 2));
      const before = el.value.slice(from, pos);
      const m = TL.slashRegex().exec(before);
      if (!m) return null;
      return { type: "input", start: pos - m[0].length, end: pos, shortcut: m[1] };
    }
    if (el.isContentEditable) {
      const sel = window.getSelection();
      if (!sel?.rangeCount) return null;
      const range = sel.getRangeAt(0);
      if (range.startContainer.nodeType !== Node.TEXT_NODE) return null;
      const before = range.startContainer.textContent.slice(0, range.startOffset);
      const m = TL.slashRegex().exec(before);
      if (!m) return null;
      return {
        type: "editable", container: range.startContainer,
        start: range.startOffset - m[0].length, end: range.startOffset, shortcut: m[1],
      };
    }
    return null;
  }

  function deleteSlashToken(el, info) {
    if (info.type === "input") {
      const before = el.value.slice(0, info.start);
      const after = el.value.slice(info.end);
      setNativeValue(el, before + after);
      el.setSelectionRange?.(info.start, info.start);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      // Range-based delete keeps the rich editor's DOM consistent. (Plan step 3)
      const range = document.createRange();
      range.setStart(info.container, info.start);
      range.setEnd(info.container, info.end);
      range.deleteContents();
      const sel = window.getSelection();
      const collapsed = document.createRange();
      collapsed.setStart(info.container, info.start);
      collapsed.collapse(true);
      sel.removeAllRanges();
      sel.addRange(collapsed);
    }
  }

  // Synchronous on purpose: preventDefault() only counts while the keydown is
  // still being dispatched. An await here (even on a resolved promise) hands
  // control back to the browser, and on a cold cache the Space/Enter default
  // action lands before we get to cancel it — the token ends up with a
  // trailing space and never expands.
  function handleSlashCommand(el, triggerEvent) {
    const info = getSlashContext(el);
    if (!info) return false;

    const template = templateCache.find(
      (tpl) => tpl.shortcut && tpl.shortcut.toLowerCase() === info.shortcut.toLowerCase()
    );
    if (!template) return false;

    triggerEvent.preventDefault();
    triggerEvent.stopPropagation();
    deleteSlashToken(el, info);
    closeAutocomplete();
    runPaste(template);
    return true;
  }

  const slashHandler = (e) => {
    if (e.isComposing) return;

    // Autocomplete keyboard control takes priority when open.
    if (acOpen && acHandleKey(e)) return;

    if (e.key !== " " && e.key !== "Enter" && e.key !== "Tab") return;
    if (!isEditable(e.target)) return;
    // Cold cache (focusin normally warmed it): kick the load, let this key
    // through untouched rather than racing the default action.
    if (!templateCache) { ensureCache(); return; }

    try {
      handleSlashCommand(e.target, e);
    } catch (err) {
      console.error("[YAZIT] Slash handler error:", err);
    }
  };
  document.addEventListener("keydown", slashHandler, { capture: true, passive: false });

  // ============================================================
  // Slash autocomplete dropdown (plan step 17) — caret-anchored, fuzzy
  // ============================================================
  let acHost = null, acShadow = null, acList = null;
  let acItems = [], acIndex = 0, acOpen = false, acTarget = null, acInfo = null;
  let acRaf = 0;
  // Generation counter: every input tick and every close bumps it, so a
  // cache load that resolves after the dropdown was closed (blur, click
  // elsewhere, newer keystroke) can't re-open a stale list.
  let acGen = 0;

  function closeAutocomplete() {
    acGen++;
    if (acRaf) { cancelAnimationFrame(acRaf); acRaf = 0; }
    if (acHost) { acHost.remove(); acHost = null; acShadow = null; acList = null; }
    acOpen = false; acItems = []; acIndex = 0; acTarget = null; acInfo = null;
  }

  function caretRect(el) {
    try {
      if (el.isContentEditable) {
        const sel = window.getSelection();
        if (sel?.rangeCount) {
          const r = sel.getRangeAt(0).getClientRects()[0];
          if (r) return { left: r.left, bottom: r.bottom };
        }
      }
    } catch (_) {}
    const r = el.getBoundingClientRect();
    return { left: r.left + 6, bottom: r.top + Math.min(r.height, 28) };
  }

  function renderAutocomplete(matches, el, info) {
    if (!acHost) {
      const h = makeShadowHost("position:fixed;top:0;left:0;z-index:2147483647;");
      acHost = h.host; acShadow = h.shadow;
      acList = document.createElement("div");
      acList.className = "tl-ac";
      acShadow.appendChild(acList);
      document.body.appendChild(acHost);
    }
    applyHostTheme(acHost); // reused across shows — the setting may have changed
    acList.replaceChildren();
    acItems = matches;
    acIndex = 0;
    matches.forEach((tpl, i) => {
      const item = document.createElement("div");
      item.className = "tl-ac-item" + (i === 0 ? " active" : "");
      const nm = document.createElement("span");
      nm.className = "nm"; nm.textContent = tpl.name || tpl.shortcut || "";
      const sc = document.createElement("span");
      sc.className = "sc"; sc.textContent = tpl.shortcut ? "/" + tpl.shortcut : "";
      item.append(nm, sc);
      item.addEventListener("mousedown", (e) => { e.preventDefault(); acAccept(i); });
      acList.appendChild(item);
    });
    const rect = caretRect(el);
    acList.style.left = Math.round(rect.left) + "px";
    acList.style.top = Math.round(rect.bottom + 4) + "px";
    acOpen = true; acTarget = el; acInfo = info;
  }

  function acHighlight() {
    const nodes = acList?.querySelectorAll(".tl-ac-item") || [];
    nodes.forEach((n, i) => n.classList.toggle("active", i === acIndex));
  }

  function acHandleKey(e) {
    if (!acItems.length) return false;
    if (e.key === "ArrowDown") { acIndex = (acIndex + 1) % acItems.length; acHighlight(); e.preventDefault(); return true; }
    if (e.key === "ArrowUp") { acIndex = (acIndex - 1 + acItems.length) % acItems.length; acHighlight(); e.preventDefault(); return true; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); acAccept(acIndex); return true; }
    if (e.key === "Escape") { closeAutocomplete(); e.preventDefault(); return true; }
    return false; // space/other keys fall through to slash expansion
  }

  function acAccept(i) {
    const tpl = acItems[i];
    const el = acTarget, info = acInfo;
    closeAutocomplete();
    if (!tpl || !el || !info) return;
    deleteSlashToken(el, getSlashContext(el) || info);
    runPaste(tpl);
  }

  // input event drives the live dropdown (rAF-debounced).
  document.addEventListener("input", (e) => {
    const el = e.target;
    if (!isEditable(el)) { closeAutocomplete(); return; }
    if (acRaf) cancelAnimationFrame(acRaf);
    const gen = ++acGen;
    acRaf = requestAnimationFrame(() => {
      acRaf = 0;
      const info = getSlashContext(el);
      if (!info || info.shortcut.length < 1) { closeAutocomplete(); return; }
      ensureCache().then((templates) => {
        if (gen !== acGen) return; // closed or superseded while the cache loaded
        const matches = TL.fuzzySearch(info.shortcut, templates, 8);
        if (!matches.length) { closeAutocomplete(); return; }
        renderAutocomplete(matches, el, info);
      });
    });
  }, true);

  document.addEventListener("focusout", () => closeAutocomplete(), true);
  document.addEventListener("mousedown", (e) => {
    if (acHost && e.target !== acHost) closeAutocomplete();
  }, true);
})();
