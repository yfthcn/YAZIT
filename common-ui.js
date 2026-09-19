// @ts-check
// ==============================
// YAZIT — Common utilities, extension-page half
// ==============================
// Loaded by the popup, the options page and the background worker — NOT by the
// content script. Nothing in here is reachable from content.js, and the content
// script is injected into every frame of every page (<all_urls> + all_frames),
// so splitting it out keeps ~15 KB of source and its top-level objects out of
// each of those frames.
//
// This file EXTENDS the TL that common.js creates; it is never loaded alone.
// test/common.test.js derives every context's script list from the real configs
// (manifest.json, the two HTML pages, build.py) and fails if any of them calls
// a TL member the files it loads do not define.
// ==============================

(function (/** @type {any} */ global) {
  "use strict";

  const TL = global.TL;
  if (!TL) {
    console.error("[YAZIT] common-ui.js loaded without common.js");
    return;
  }
  // Same no-clobber contract as common.js: a second load keeps the live state.
  if (TL.debounce) return;
  TL.sanitizeFilename = (name) => {
    const cleaned = String(name ?? "")
      .replace(/[^\p{L}\p{N}_\- ]+/gu, "_")
      .replace(/\s+/g, "_")
      .slice(0, 50);
    return cleaned || "template";
  };

  /**
   * Normalize clipboard HTML (Word / Outlook / Google Docs) AFTER sanitizing:
   * empty formatting shells, empty paragraphs, runs of &nbsp; and stray
   * whitespace-only rows are removed so a pasted mail body doesn't carry a
   * ladder of blank lines into the template. Pure string pass; idempotent.
   * @param {string} safeHtml sanitizeHtml output
   * @returns {string}
   */
  TL.tidyHtml = function (safeHtml) {
    let s = String(safeHtml ?? "");
    s = s.replace(/(?:&nbsp;|\u00a0)(?:\s*(?:&nbsp;|\u00a0))+/g, " "); // nbsp runs → one space
    s = s.replace(/&nbsp;/g, " ");
    // Empty inline / block shells (repeat: unwrapping may expose more).
    const EMPTY = /<(b|strong|i|em|u|s|code|p|li|h2|h3|td|th|tr|thead|tbody|ul|ol|pre|table)>\s*<\/\1>/g;
    let prev;
    do { prev = s; s = s.replace(EMPTY, ""); } while (s !== prev);
    s = s.replace(/^(\s*<br>\s*)+|(\s*<br>\s*)+$/g, "");   // leading/trailing <br> ladder
    s = s.replace(/(<br>\s*){3,}/g, "<br><br>");            // cap blank-line runs
    return s.trim();
  };


  // --- Placeholder colours (settings page editors + Fields panel) ---
  TL.PH_SLOTS = 8;

  /**
   * Give every field named in a body its own colour slot (0…PH_SLOTS-1).
   * The preferred slot comes from a hash of the name, so "customer" tends to
   * keep its colour from template to template; a slot already taken in THIS
   * body moves to the next free one, so two fields of one template never
   * share a colour (until there are more fields than slots). Fields tested
   * only by {{#if name}} get a slot too — they are checkboxes in the form.
   * @param {string} text
   * @returns {Map<string, number>}
   */
  TL.placeholderSlots = function (text) {
    const src = String(text ?? "");
    const names = [];
    const re = /\{\{([^{}]+)\}\}/g;
    let m;
    const later = [];
    while ((m = re.exec(src)) !== null) {
      const t = TL.tokenKind(m[1]);
      if (!t.name) continue;
      (t.kind === "field" ? names : t.kind === "control" ? later : []).push(t.name);
    }
    const slots = new Map();
    const used = new Set();
    for (const name of [...names, ...later]) {
      if (slots.has(name)) continue;
      let s = parseInt(TL.fnv1a(name), 16) % TL.PH_SLOTS;
      if (used.size < TL.PH_SLOTS) while (used.has(s)) s = (s + 1) % TL.PH_SLOTS;
      slots.set(name, s);
      used.add(s);
    }
    return slots;
  };

  /**
   * A colour slot per folder, from the same 8-colour palette as placeholders.
   * Keyed by folder id (a rename keeps the colour); the id's hash picks the
   * preferred slot and folders are placed in list order (= creation order),
   * so adding a folder never recolours an existing one and no two of the
   * first eight share a colour.
   * @param {{id: string}[]} folders
   * @returns {Map<string, number>}
   */
  TL.folderSlots = function (folders) {
    const slots = new Map();
    const used = new Set();
    for (const f of folders || []) {
      if (!f || !f.id || slots.has(f.id)) continue;
      let s = parseInt(TL.fnv1a(f.id), 16) % TL.PH_SLOTS;
      if (used.size < TL.PH_SLOTS) while (used.has(s)) s = (s + 1) % TL.PH_SLOTS;
      slots.set(f.id, s);
      used.add(s);
    }
    return slots;
  };

  /**
   * Highlight key for one token: its field's slot ("0"…"7"), "ctl" for
   * condition markers, "dyn" for dynamic variables.
   * @param {string} inner
   * @param {Map<string, number>} slots from placeholderSlots over the same body
   */
  TL.placeholderKey = function (inner, slots) {
    const t = TL.tokenKind(inner);
    if (t.kind === "control") return "ctl";
    if (t.kind === "dynamic") return "dyn";
    return String(slots.get(t.name) ?? parseInt(TL.fnv1a(t.name), 16) % TL.PH_SLOTS);
  };

  /**
   * Markers for the condition builder on the settings page. Names and values
   * are cleaned to what COND_OPEN_RE (common.js) accepts: a name may not hold
   * { } = |, a value may not hold { } |. Whitespace inside a name is kept
   * (collapsed) so picking an existing field like "order no" still matches it.
   * @param {{name: string, equals?: string}} spec
   * @returns {{open: string, otherwise: string, close: string} | null} null = no usable name
   */
  TL.buildCondition = function (spec) {
    const name = String(spec?.name ?? "").replace(/[{}=|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 50);
    if (!name) return null;
    const eq = spec.equals == null ? "" : String(spec.equals).replace(/[{}|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
    return {
      open: "{{#if " + name + (eq ? "=" + eq : "") + "}}",
      otherwise: "{{else}}",
      close: "{{/if}}",
    };
  };

  TL.getLang = async function () {
    const { uiLang = "auto" } = await chrome.storage.local.get("uiLang");
    return uiLang;
  };
  TL.setLang = (lang) => chrome.storage.local.set({ uiLang: lang });

  /** @returns {Promise<"auto"|"light"|"dark">} */
  TL.getTheme = async function () {
    const { uiTheme } = await chrome.storage.local.get("uiTheme");
    return TL.normalizeTheme(uiTheme);
  };
  // theme.js (loaded on every extension page) listens for this key and
  // repaints; nothing else needs to be told.
  TL.setTheme = (theme) => chrome.storage.local.set({ uiTheme: TL.normalizeTheme(theme) });

  // --- Tab paste helpers (shared by popup + background) ---
  TL.isSystemUrl = (url) => {
    if (!url) return true;
    if (/^(chrome|edge|brave|opera|about|moz-extension|chrome-extension):/i.test(url)) return true;
    return url.includes("chrome.google.com/webstore")
        || url.includes("microsoftedge.microsoft.com/addons")
        || url.includes("addons.mozilla.org");
  };

  /**
   * Frame targeting for multi-frame pages. Content scripts report every
   * editable focusin to the background (FOCUS message); the background stores
   * the sender's frameId per tab in chrome.storage.session under this key.
   * Popup/background read it back here — no per-paste executeScript probe of
   * every frame. null = unknown → caller broadcasts (single-frame pages are
   * unaffected either way). Fixes the multi-frame double-paste: without a
   * frameId, tabs.sendMessage delivers PASTE_TEMPLATE to EVERY frame.
   */
  TL.focusKey = (tabId) => "focus:" + tabId;

  /**
   * @param {number} tabId
   * @returns {Promise<number|null>}
   */
  TL.pickTargetFrame = async (tabId) => {
    try {
      const key = TL.focusKey(tabId);
      const got = await chrome.storage.session.get(key);
      return typeof got[key] === "number" ? got[key] : null;
    } catch (_) {
      return null; // storage.session unavailable → broadcast fallback
    }
  };

  /**
   * Resolve the user's real keyboard shortcut for each quick-slot command
   * (paste-template-1..3). Reflects platform mapping (⌘ on macOS) and any
   * remap the user made in the browser's shortcut settings, instead of a
   * hardcoded "Ctrl+Shift+N" label. Returns "" for unbound slots.
   * @returns {Promise<string[]>} index 0..2 → shortcut label
   */
  TL.getSlotKeys = async function () {
    const out = ["", "", ""];
    try {
      const cmds = await chrome.commands.getAll();
      for (const c of cmds || []) {
        const m = /^paste-template-([123])$/.exec(c.name || "");
        if (m) out[Number(m[1]) - 1] = c.shortcut || "";
      }
    } catch (_) { /* commands API unavailable → labels stay empty */ }
    return out;
  };

  /**
   * Compact human label for the three slot keys: "Ctrl+Shift+1..3" when they
   * share a prefix, otherwise the bound ones joined with " / ", or "" if none.
   * @param {string[]} keys
   */
  TL.slotKeysHint = function (keys) {
    const k = (Array.isArray(keys) ? keys : []).filter(Boolean);
    if (!k.length) return "";
    const m = k.map((x) => /^(.*?)(\d)$/.exec(x));
    if (k.length === 3 && m.every(Boolean) && m.every((x) => x[1] === m[0][1])) {
      return m[0][1] + m[0][2] + ".." + m[2][2];
    }
    return k.join(" / ");
  };

  /**
   * Deliver PASTE_TEMPLATE to a tab. Order of attempts:
   *  1. the frame that last reported editable focus (if known);
   *  2. if that frame is gone (navigated / removed — the record was stale),
   *     drop the record and broadcast to every frame (the content script's
   *     own target check keeps only the focused frame acting);
   *  3. no listener anywhere → inject the content script, then broadcast.
   * Step 2 is what keeps a stale frameId from escalating into a needless
   * all-frames re-injection, or worse, a "no access" error in the popup.
   * @param {number} tabId
   * @param {TLTemplate} template
   * @param {number} [injectDelayMs]
   */
  TL.pasteToTab = async (tabId, template, injectDelayMs = 150) => {
    // `broadcast` tells the receiving frames that this message went to ALL of
    // them rather than to one known target. A subframe treats that as the
    // weaker signal it is and only acts if the user has interacted with it
    // (see content.js) — a legitimate iframe editor the user clicked into
    // passes that test; an iframe that merely sits on the page does not.
    const send = (frameId) =>
      chrome.tabs.sendMessage(
        tabId,
        { type: "PASTE_TEMPLATE", template, broadcast: frameId == null },
        frameId != null ? { frameId } : {}
      );

    const frameId = await TL.pickTargetFrame(tabId);
    try { await send(frameId); return; } catch { /* fall through */ }

    if (frameId != null) {
      try { await chrome.storage.session.remove(TL.focusKey(tabId)); } catch { /* ignore */ }
      try { await send(null); return; } catch { /* fall through */ }
    }

    // Top frame first. The declarative content script already covers every
    // frame, so this fallback exists for the case where it did not run at all
    // — and in that case the top frame is where the user is. Widening to
    // allFrames only when the narrow attempt finds no listener keeps the
    // injection surface off every third-party iframe in the common case.
    const inject = (allFrames) =>
      chrome.scripting.executeScript({ target: { tabId, allFrames }, files: ["common.js", "content.js"] });
    await inject(false);
    await new Promise((r) => setTimeout(r, injectDelayMs));
    try { await send(null); return; } catch { /* nothing in the top frame */ }

    await inject(true);
    await new Promise((r) => setTimeout(r, injectDelayMs));
    await send(null);
  };
  // ============================================================
  // Debounce
  // ============================================================
  /**
   * Trailing-edge debounce with a flush() escape hatch so callers can force the
   * pending invocation immediately (e.g. on blur / page-hide) — closing the
   * data-loss window where a still-pending call would be dropped on unload.
   * Backward compatible: the returned value is callable exactly as before and
   * additionally exposes .flush() and .cancel().
   * @template {(...args:any[]) => any} F
   * @param {F} fn
   * @param {number} [delay]
   */
  TL.debounce = function (fn, delay = 300) {
    let timer = null;
    /** @type {any} */ let lastThis = undefined;
    /** @type {any[]} */ let lastArgs = [];
    const debounced = function (/** @type {any[]} */ ...args) {
      lastThis = this;
      lastArgs = args;
      clearTimeout(timer);
      timer = setTimeout(() => { timer = null; fn.apply(lastThis, lastArgs); }, delay);
    };
    /** Run any pending invocation now and clear the timer (no-op if idle). */
    debounced.flush = function () {
      if (timer !== null) { clearTimeout(timer); timer = null; fn.apply(lastThis, lastArgs); }
    };
    /** Drop any pending invocation without running it. */
    debounced.cancel = function () { clearTimeout(timer); timer = null; };
    return debounced;
  };

  /**
   * Serialize a field back to its minimal canonical pipe-token — the exact
   * inverse of parseFields. Strips pipe/brace/comma from label/default/options
   * (a stray pipe would shift the field's meaning). Used by the field-builder.
   * @param {TLField} field
   * @returns {string}
   */
  TL.buildFieldToken = function (field) {
    const f = /** @type {any} */ (field || {});
    const clean = (v) => String(v ?? "").replace(/[|{}]/g, "").trim();
    const cleanNoComma = (v) => clean(v).replace(/,/g, "");
    const name = cleanNoComma(f.name);
    const label = cleanNoComma(f.label) === name ? "" : cleanNoComma(f.label);
    const type = ["multiline", "dropdown", "date", "checkbox"].includes(f.type) ? f.type : "";
    const def = cleanNoComma(f.def);
    let options = "";
    if (f.type === "dropdown" && Array.isArray(f.options)) options = f.options.map(cleanNoComma).filter(Boolean).join(",");
    else if (f.type === "date" && Array.isArray(f.options) && TL.DATE_FORMATS.includes(f.options[0]) && f.options[0] !== "yyyy-MM-dd") options = f.options[0];
    const flags = [];
    if (f.remember && !TL.isSecretName(name)) flags.push("remember");
    if (f.required) flags.push("required");
    const parts = [name, label, type, def, options, flags.join(",")];
    while (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
    return "{{" + parts.join("|") + "}}";
  };

  // ============================================================
  // Backups — ring buffer (plan step 14)
  // ============================================================
  /** Pure ring-push: newest first, capped. */
  TL.ringPush = (arr, item, max) => [item, ...(Array.isArray(arr) ? arr : [])].slice(0, max);

  TL.pushBackup = async function () {
    // Never throws: pushBackup is awaited as a safety net BEFORE destructive
    // ops (delete/import/restore) — a quota failure here must not abort them.
    // Worst case at MAX_TEMPLATES × MAX_BODY the ring multiplies storage ~6×,
    // so on a quota error we shrink the ring (drop oldest first) until the
    // write fits, and skip the backup entirely as the last resort.
    try {
      const { templates = [], backups = [], folders = [] } = await chrome.storage.local.get(["templates", "backups", "folders"]);
      if (!Array.isArray(templates) || templates.length === 0) return;
      // Folders ride along: a snapshot without them would restore every
      // template's folderId as a dangling (= uncategorized) pointer.
      const snap = { ts: Date.now(), schemaVersion: TL.CURRENT_SCHEMA, count: templates.length, templates, folders };
      let next = TL.ringPush(backups, snap, TL.LIMITS.MAX_BACKUPS);
      while (next.length > 0) {
        try {
          await chrome.storage.local.set({ backups: next });
          return;
        } catch (_) {
          next = next.slice(0, next.length - 1); // drop the oldest, retry
        }
      }
      console.warn("[YAZIT] Backup skipped: storage quota exceeded.");
    } catch (err) {
      console.warn("[YAZIT] Backup skipped:", err);
    }
  };

  TL.getBackups = async () => {
    const { backups = [] } = await chrome.storage.local.get("backups");
    return Array.isArray(backups) ? backups : [];
  };

  TL.restoreBackup = async function (ts) {
    const backups = await TL.getBackups();
    const b = backups.find((x) => x.ts === ts);
    if (!b) return false;
    const migrated = TL.migrate({ templates: b.templates });
    // Pre-v4 snapshots have no folders: keep the current ones rather than
    // wiping them — the restored templates simply read as uncategorized.
    if (Array.isArray(b.folders)) await TL.setFolders(b.folders);
    await TL.setTemplates(migrated.templates);
    return true;
  };

  // ============================================================
  // Competitor import adapters (plan step 16) — pure, fixture-tested.
  // Best-effort: convert vendor tokens to {{placeholders}}, else keep literal.
  // ============================================================

  /** Convert Text Blaze {formtext: name=foo} / {time}/{date} tokens → {{...}}. */
  function tbTokensToPlaceholders(text) {
    let s = String(text ?? "");
    s = s.replace(/\{form(?:text|paragraph|menu|date)\s*:\s*([^}]*)\}/gi, (_m, inner) => {
      const nameMatch = /name\s*=\s*([^;]+)/i.exec(inner);
      const nm = (nameMatch ? nameMatch[1] : "field").trim().replace(/[^\w\- ]+/g, "").trim() || "field";
      return `{{${nm}}}`;
    });
    s = s.replace(/\{time[^}]*\}/gi, "{{time}}").replace(/\{date[^}]*\}/gi, "{{date}}");
    return s;
  }

  /** @returns {Array<{name:string,shortcut:string,body:string}>|null} */
  TL.adaptTextBlaze = function (parsed) {
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.snippets) ? parsed.snippets : null);
    if (!list) return null;
    const out = [];
    for (const s of list) {
      if (!s || typeof s !== "object") continue;
      const body = s.snippet ?? s.text ?? s.content ?? s.body;
      if (typeof body !== "string") continue;
      out.push({
        name: String(s.name ?? s.label ?? s.shortcut ?? "Text Blaze").slice(0, TL.LIMITS.MAX_NAME),
        shortcut: TL.stripShortcut(String(s.shortcut ?? s.trigger ?? "").replace(/^\//, "")),
        body: tbTokensToPlaceholders(body),
      });
    }
    return out.length ? out : null;
  };

  /** @returns {Array<{name:string,shortcut:string,body:string}>|null} */
  TL.adaptMagical = function (parsed) {
    const list = Array.isArray(parsed) ? parsed
      : (Array.isArray(parsed?.expansions) ? parsed.expansions
        : (Array.isArray(parsed?.shortcuts) ? parsed.shortcuts : null));
    if (!list) return null;
    const out = [];
    for (const s of list) {
      if (!s || typeof s !== "object") continue;
      const body = s.expansion ?? s.text ?? s.value ?? s.body;
      if (typeof body !== "string") continue;
      out.push({
        name: String(s.label ?? s.name ?? s.trigger ?? "Magical").slice(0, TL.LIMITS.MAX_NAME),
        shortcut: TL.stripShortcut(String(s.trigger ?? s.shortcut ?? "").replace(/^[/-]/, "")),
        body: String(body), // Magical uses {{label}} tokens already
      });
    }
    return out.length ? out : null;
  };

  /**
   * Detect a foreign export shape and adapt it; returns { source, items } or null
   * (null = treat as native YAZIT JSON).
   * @param {any} parsed
   * @returns {{source:string, items:Array}|null}
   */
  TL.detectAndAdapt = function (parsed) {
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const looksNative = arr.some((x) => x && typeof x === "object" && typeof x.body === "string");
    if (looksNative) return null;

    const tb = TL.adaptTextBlaze(parsed);
    if (tb) return { source: "textblaze", items: tb };
    const mg = TL.adaptMagical(parsed);
    if (mg) return { source: "magical", items: mg };
    return null;
  };

  /**
   * Full-text search over name/shortcut/body/tags (for options + popup).
   * Haystacks are cached per template object (WeakMap) and invalidated by
   * field identity — an in-place edit assigns a NEW string/array, so the
   * reference check catches it. Avoids re-joining + lowercasing every body
   * (worst case megabytes at MAX_TEMPLATES) on every keystroke.
   * @param {string} query
   * @param {any[]} templates
   */
  const hayCache = new WeakMap();
  function haystackOf(t) {
    const c = hayCache.get(t);
    if (c && c.name === t.name && c.shortcut === t.shortcut && c.body === t.body && c.tags === t.tags) {
      return c.hay;
    }
    const hay = [t.name, t.shortcut, t.body, ...(t.tags || [])].join("\n").toLowerCase();
    hayCache.set(t, { name: t.name, shortcut: t.shortcut, body: t.body, tags: t.tags, hay });
    return hay;
  }
  TL.searchTemplates = function (query, templates) {
    const q = String(query ?? "").trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => haystackOf(t).includes(q));
  };

  /**
   * Merge imported templates into the existing list applying a conflict
   * strategy for case-insensitive duplicate shortcuts. Pure.
   * @param {any[]} existing
   * @param {any[]} incoming
   * @param {"keepboth"|"skip"|"overwrite"} conflictMode
   * @returns {any[]}
   */
  TL.mergeImport = function (existing, incoming, conflictMode) {
    if (conflictMode === "keepboth") return existing.concat(incoming);
    const byShortcut = new Map();
    existing.forEach((t, i) => { if (t.shortcut) byShortcut.set(t.shortcut.toLowerCase(), i); });
    const result = existing.slice();
    for (const inc of incoming) {
      const key = (inc.shortcut || "").toLowerCase();
      if (key && byShortcut.has(key)) {
        if (conflictMode === "skip") continue;
        if (conflictMode === "overwrite") {
          const i = byShortcut.get(key);
          const next = { ...result[i], name: inc.name, body: inc.body, tags: inc.tags };
          if (inc.format === "html") next.format = "html"; else delete next.format;
          // Grouping only moves when the file says so; an ungrouped export
          // must not strip the local folder/star off the template it updates.
          if (inc.folderId) next.folderId = inc.folderId;
          if (inc.favorite) next.favorite = true;
          result[i] = next;
          continue;
        }
      }
      result.push(inc);
    }
    return result;
  };

  // ============================================================
  // Folder ⇄ file mapping (v4). Files carry the folder NAME; storage the id.
  // ============================================================
  /**
   * Pure: templates as they go into an export file — folderId swapped for the
   * folder's name (dropped when dangling), internal id/order kept as before.
   * @param {any[]} templates
   * @param {TLFolder[]} folders
   */
  TL.toExportable = function (templates, folders) {
    const nameById = new Map((folders || []).map((f) => [f.id, f.name]));
    return (templates || []).map((t) => {
      const { folderId, ...rest } = t;
      const name = folderId ? nameById.get(folderId) : "";
      return name ? { ...rest, folder: name } : rest;
    });
  };

  /**
   * Pure: resolve validated imports' folder names to ids, creating folders
   * that don't exist yet (case-insensitive name match). In "replace" mode the
   * folder list is rebuilt from what the file references.
   * @param {any[]} items   validateTemplates().accepted
   * @param {TLFolder[]} folders  current folders
   * @param {"merge"|"replace"} mode
   * @param {() => string} [newId]
   * @returns {{templates:any[], folders:TLFolder[]}}
   */
  TL.resolveImportFolders = function (items, folders, mode, newId = TL.makeFolderId) {
    const out = mode === "replace" ? [] : (folders || []).slice();
    const byName = new Map(out.map((f) => [f.name.toLocaleLowerCase(), f.id]));
    const templates = (items || []).map((t) => {
      const { folder, ...rest } = t;
      if (!folder) return rest;
      const key = folder.toLocaleLowerCase();
      let id = byName.get(key);
      if (!id) {
        if (out.length >= TL.LIMITS.MAX_FOLDERS) return rest; // cap hit → uncategorized
        id = newId();
        out.push({ id, name: folder, order: out.length });
        byName.set(key, id);
      }
      return { ...rest, folderId: id };
    });
    return { templates, folders: TL.normalizeFolders(out) };
  };

  // Node (unit tests) — same TL object common.js exported.
  if (typeof module !== "undefined" && module.exports) module.exports = TL;
})(typeof self !== "undefined" ? self : (typeof globalThis !== "undefined" ? globalThis : this));
