// @ts-check
// ==============================
// YAZIT — Common utilities
// ==============================
// i18n, escaping, validation, storage, schema migration, dynamic
// variables, placeholder parsing and the fuzzy scorer — shared by
// popup.js, options.js, content.js and background.js. Everything the
// content script cannot reach (backups, competitor adapters, the tab
// paste helpers) lives in common-ui.js. Designed to run in service
// worker, page and Node (unit-test) contexts. Zero runtime dependencies.
// ==============================

/**
 * @typedef {Object} TLField
 * @property {string} name      Placeholder key, e.g. "customer_name"
 * @property {string} label     Human label shown in the form
 * @property {"text"|"multiline"|"dropdown"|"date"|"checkbox"} type
 * @property {string} def       Default value (date: "today" | "+3d" | ISO; checkbox: "true"/"")
 * @property {string[]} options Dropdown options ("*" = free-text "Other…"); date: [format]
 * @property {boolean} remember Pre-fill with the last value used
 * @property {boolean} [required] Block paste while empty (absent === false)
 */

/**
 * @typedef {Object} TLTemplate
 * @property {string} id        Stable, deterministic id
 * @property {number} order     Position (decoupled from array index)
 * @property {string} name
 * @property {string} shortcut
 * @property {string} body
 * @property {string[]} [tags]
 * @property {"text"|"html"} [format]  Absent === "text" (plain). "html" => body holds sanitized HTML.
 * @property {string} [folderId]  Absent (or dangling) === uncategorized
 * @property {boolean} [favorite] Absent === false
 */

/**
 * @typedef {Object} TLFolder
 * @property {string} id     Random, stable ("f_…")
 * @property {string} name
 * @property {number} order
 */

(function (/** @type {any} */ global) {
  "use strict";

  // No-clobber guard: if YAZIT is already loaded in this context
  // (e.g. content-script re-injection via the executeScript fallback),
  // keep the existing TL — including its live cache — and bail out so we
  // never re-register listeners or wipe state. (Plan step 2)
  if (global.TL) return;

  // Firefox 140+ exposes a promise-returning chrome.* namespace natively, so
  // no browser.* polyfill is needed anywhere in the codebase.

  const TL = {};

  // --- Limits / hardening caps (plan step 7) ---
  TL.LIMITS = Object.freeze({
    MAX_TEMPLATES: 500,
    MAX_NAME: 200,
    MAX_SHORTCUT: 50,
    MAX_BODY: 20000,
    MAX_TAGS: 20,
    MAX_TAG_LEN: 30,
    MAX_FIELDS: 30,
    MAX_OPTIONS: 50,
    MAX_BACKUPS: 5,
    MAX_FOLDERS: 50,
    MAX_FOLDER_NAME: 40,
    MAX_IMPORT_BYTES: 2 * 1024 * 1024, // 2 MB
  });

  // --- Schema version ---
  TL.CURRENT_SCHEMA = 4;

  // ============================================================
  // Theme preference ("uiTheme" in storage.local, beside "uiLang")
  // ============================================================
  /**
   * Coerce a stored theme preference to one the UI understands. Anything
   * unknown — missing key, a value from a newer version, a hand-edited store —
   * means "auto" (follow the OS) — the only behaviour before this setting existed.
   * theme.js runs before this file on the extension pages and carries its own
   * copy of this rule; test/common.test.js runs both against the same inputs.
   * @param {unknown} v
   * @returns {"auto"|"light"|"dark"}
   */
  TL.normalizeTheme = (v) => (v === "light" || v === "dark" ? v : "auto");

  // ============================================================
  // i18n
  // ============================================================
  let uiStrings = {};
  let activeLang = "en";

  /**
   * Load localized strings. Falls back to chrome.i18n if custom locale fails.
   * Returns the locale it RESOLVED to ("auto" → "tr"/"en"), which is what the
   * pages need for <html lang>; resolving it again at the call site would put
   * that rule in two places.
   * @param {string} [langPref] - "auto" | "en" | "tr"
   * @returns {Promise<string>} the concrete locale in effect
   */
  TL.loadLocale = async function (langPref = "auto") {
    activeLang = langPref;
    if (activeLang === "auto") {
      const browserLang = (chrome.i18n.getUILanguage?.() || "en").toLowerCase();
      activeLang = browserLang.startsWith("tr") ? "tr" : "en";
    }
    try {
      const url = chrome.runtime.getURL(`_locales/${activeLang}/messages.json`);
      const res = await fetch(url);
      const data = await res.json();
      uiStrings = {};
      for (const [k, v] of Object.entries(data)) uiStrings[k] = v.message;
    } catch (err) {
      console.warn("[YAZIT] Locale load failed, using fallback:", err);
      uiStrings = {};
    }
    return activeLang;
  };

  /**
   * Get translated message. Supports $PLACEHOLDER$ substitution.
   * @param {string} key
   * @param {Array<string>|string} [subs]
   * @returns {string}
   */
  TL.t = function (key, subs) {
    let msg = uiStrings[key];
    if (!msg) {
      try { msg = chrome.i18n.getMessage(key, subs); } catch (_) {}
    }
    if (!msg) return key;
    if (subs != null) {
      const arr = Array.isArray(subs) ? [...subs] : [String(subs)];
      msg = msg.replace(/\$(\w+)\$/g, () => arr.shift() ?? "");
    }
    return msg;
  };

  // ============================================================
  // Escaping
  // ============================================================
  const HTML_ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  TL.escapeHtml = (str) => String(str ?? "").replace(/[&<>"']/g, (c) => HTML_ESC_MAP[c]);

  // ============================================================
  // Rich-text sanitizer (the ONE sanctioned HTML insertion path).
  // This is the entire trust boundary for rich templates. Everything
  // outside this function builds UI with createElement + textContent.
  // Authoritative path: DOMParser (inert) -> allowlist tree rebuild.
  //
  // The DOM-free fallback is NOT test-only. DOMParser is `[Exposed=Window]`,
  // so it is absent from Chrome's MV3 service worker: background.js reaches
  // sanitizeHtml through migrate()/normalizeTemplates and takes the fallback
  // there, and that output can be written back to storage. Both paths are
  // production paths and the suite exercises both (test/dom-shim.js).
  // They may differ in STRUCTURE — an HTML tree builder re-parents an orphan
  // <td>, a regex cannot — but never in the allowlist invariants.
  // ============================================================
  TL.ALLOWED_TAGS = Object.freeze(new Set(
    ["b", "strong", "i", "em", "u", "s", "a", "br", "p", "ul", "ol", "li",
     "h2", "h3", "code", "pre", "table", "thead", "tbody", "tr", "th", "td"]
  ));
  // Removed together with their entire subtree (content discarded).
  TL.KILL_TAGS = Object.freeze(new Set(
    ["script", "style", "iframe", "object", "embed", "link", "meta", "base",
     "form", "svg", "math", "template", "noscript", "title", "head", "frame", "frameset"]
  ));
  // Void / never-closed kill-tags: drop the tag but do NOT enter "skip subtree"
  // state — they have no subtree, and otherwise everything after a
  // <base>/<meta>/<link>/<frame> would be swallowed in the DOM-free fallback.
  const VOID_KILL = new Set(["link", "meta", "base", "frame"]);
  const SAFE_PROTOCOLS = ["http:", "https:", "mailto:", "tel:"];

  /** Decode the handful of entities we care about (for the DOM-free fallback). */
  function decodeEntities(s) {
    return String(s)
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
      .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&#39;/g, "'")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&"); // last, so &amp;lt; -> &lt; (literal)
  }
  function safeCodePoint(n) {
    try { return (n > 0 && n <= 0x10ffff) ? String.fromCodePoint(n) : ""; } catch (_) { return ""; }
  }

  /** Validate an href; returns a safe value or null. Rejects scheme-relative. */
  function cleanHref(href) {
    if (!href) return null;
    // Strip control chars + ALL whitespace so "java\tscript:" === "javascript:".
    const s = decodeEntities(String(href)).replace(/[\u0000-\u0020\u007F]/g, "");
    if (!s || s.startsWith("//")) return null; // scheme-relative -> reject
    if (typeof document !== "undefined") {
      try {
        const a = document.createElement("a");
        a.href = s;
        return SAFE_PROTOCOLS.includes(a.protocol.toLowerCase()) ? s : null;
      } catch (_) { /* fall through */ }
    }
    return /^(https?:|mailto:|tel:)/i.test(s) ? s : null;
  }

  function renderOpenTag(tag, href) {
    if (tag === "br") return "<br>";
    if (tag === "a") {
      const safe = cleanHref(href);
      return safe
        ? `<a href="${TL.escapeHtml(safe)}" rel="noopener noreferrer nofollow">`
        : "<a>";
    }
    return `<${tag}>`;
  }

  // --- Authoritative DOM path ---
  function sanitizeWithDom(dirty) {
    const doc = new DOMParser().parseFromString(dirty, "text/html");
    const out = [];
    walkDom(doc.body, out);
    return out.join("");
  }
  function walkDom(node, out) {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { out.push(TL.escapeHtml(child.nodeValue)); continue; }
      if (child.nodeType !== 1) continue; // comments / others dropped
      const tag = child.tagName.toLowerCase();
      if (TL.KILL_TAGS.has(tag)) continue;            // drop subtree
      if (!TL.ALLOWED_TAGS.has(tag)) { walkDom(child, out); continue; } // unwrap
      if (tag === "br") { out.push("<br>"); continue; }
      out.push(renderOpenTag(tag, child.getAttribute && child.getAttribute("href")));
      walkDom(child, out);
      out.push(`</${tag}>`);
    }
  }

  // --- DOM-free fallback (node:test only) ---
  function sanitizeFallback(dirty) {
    const out = [];
    const stack = [];
    let kill = 0;
    // `[^"'>]` — NOT `[^>]`: the bare class would also match a quote and so
    // overlap the two quoted alternatives, letting an unterminated tag explode
    // into exponentially many partitions of the quote run. Disjoint = linear.
    // The final alternative also accepts a lone "<": one that starts no tag is
    // text, exactly as the HTML parser treats it. Without that branch it
    // matched nothing and was dropped from the output.
    const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>|([^<]+|<)/g;
    let m;
    while ((m = re.exec(dirty)) !== null) {
      if (m[4] != null) { if (!kill) out.push(TL.escapeHtml(decodeEntities(m[4]))); continue; }
      if (m[2] === undefined) continue; // comment
      const closing = m[1] === "/";
      const tag = m[2].toLowerCase();
      if (TL.KILL_TAGS.has(tag)) {
        const selfClose = /\/\s*$/.test(m[3] || "");
        if (closing) { if (kill) kill--; }
        else if (!VOID_KILL.has(tag) && !selfClose) kill++;
        continue;
      }
      if (kill) continue;
      if (!TL.ALLOWED_TAGS.has(tag)) continue; // unwrap
      if (tag === "br") { if (!closing) out.push("<br>"); continue; }
      if (closing) {
        const idx = stack.lastIndexOf(tag);
        if (idx >= 0) { for (let k = stack.length - 1; k >= idx; k--) out.push(`</${stack[k]}>`); stack.length = idx; }
      } else {
        let href = null;
        if (tag === "a") {
          const hm = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[3] || "");
          if (hm) href = hm[2] ?? hm[3] ?? hm[4];
        }
        out.push(renderOpenTag(tag, href));
        stack.push(tag);
      }
    }
    for (let k = stack.length - 1; k >= 0; k--) out.push(`</${stack[k]}>`);
    return out.join("");
  }

  /**
   * Sanitize untrusted HTML down to a tiny formatting allowlist.
   * @param {string} dirty
   * @returns {string} safe HTML
   */
  TL.sanitizeHtml = function (dirty) {
    const src = String(dirty ?? "");
    if (!src) return "";
    return typeof DOMParser !== "undefined" ? sanitizeWithDom(src) : sanitizeFallback(src);
  };

  /**
   * Parse an ALREADY-sanitized HTML string into a DocumentFragment of nodes via
   * DOMParser (inert) + importNode — instead of innerHTML / createContextualFragment.
   * Functionally identical, but uses no linter-flagged DOM-write sink, so the
   * AMO / web-ext validator stays clean. ONLY ever call this on sanitizeHtml output.
   * @param {string} safeHtml
   * @returns {DocumentFragment}
   */
  TL.htmlToFragment = function (safeHtml) {
    const frag = document.createDocumentFragment();
    const doc = new DOMParser().parseFromString(String(safeHtml ?? ""), "text/html");
    for (const node of Array.from(doc.body.childNodes)) {
      frag.appendChild(document.importNode(node, true));
    }
    return frag;
  };

  /** Strip every remaining tag (used by htmlToPlainText). */
  const stripTags = (s) => String(s).replace(/<\/?[a-zA-Z][^>]*>/g, "");

  /**
   * Convert (sanitized) HTML to readable plain text for input/textarea targets.
   * Preserves the {{cursor}} sentinel so caret placement still works.
   * @param {string} html
   * @returns {string}
   */
  TL.htmlToPlainText = function (html) {
    let s = String(html ?? "");
    s = s.replace(/<br\s*\/?>/gi, "\n");
    s = s.replace(/<li[^>]*>/gi, "- ");
    // Tables: cells joined with " | ", one row per line.
    s = s.replace(/<\/(td|th)>\s*<(td|th)[^>]*>/gi, " | ");
    s = s.replace(/<\/tr>/gi, "\n");
    s = s.replace(/<\/(h[1-6]|pre|table)>/gi, "\n\n");
    s = s.replace(/<\/(p|div|li|ul|ol)>/gi, "\n");
    // Attributes captured as ONE span, href picked out of it afterwards. The
    // previous single pattern put [^>]* before and after a bare ([^\s>]+),
    // three variable runs over overlapping classes: quadratic on an <a> whose
    // tag never closes (measured 242ms at MAX_BODY). One span is linear, and
    // the href extractor is the same one sanitizeFallback already uses.
    s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs, text) => {
      const hm = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs || "");
      const href = String(hm ? (hm[2] ?? hm[3] ?? hm[4]) : "").trim();
      const t = stripTags(text).trim();
      return href && href !== t ? `${t} (${href})` : t;
    });
    s = stripTags(s);
    s = decodeEntities(s);
    // Per line, anchored at $. `/[ \t]+\n/` needs a newline the run may never
    // reach: on 20 KB of spaces the engine retries from every position and
    // backtracks the whole run each time — measured 185ms, quadratic. Anchored
    // on a single line there is nothing to backtrack into.
    s = s.split("\n").map((line) => line.replace(/[ \t]+$/, "")).join("\n");
    s = s.replace(/\n{3,}/g, "\n\n");
    return s.replace(/^\n+|\s+$/g, "");
  };

  // ============================================================
  // Editor command adapter — the ONLY place that talks to the rich-text
  // editing backend. Today that backend is document.execCommand; when
  // browsers drop support this is the single file/object to swap (e.g. for
  // a Selection/Range or beforeinput-based implementation). Callers in
  // content.js (insertText/insertHTML) and options.js (toolbar, paste,
  // paragraph-separator, variable insert) MUST route through here — they
  // never call document.execCommand directly. Behaviour is intentionally
  // identical to the previous inline calls (try/catch → boolean).
  // ============================================================
  TL.editorAdapter = {
    /**
     * Run an editor command against the focused contentEditable.
     * @param {string} command
     * @param {string} [value]
     * @returns {boolean} true if the backend reported success
     */
    exec(command, value) {
      try {
        return typeof document !== "undefined" && typeof document.execCommand === "function"
          ? document.execCommand(command, false, value)
          : false;
      } catch (_) {
        return false;
      }
    },
    /** Insert plain text, preserving the editor's native undo stack. */
    insertText(text) { return this.exec("insertText", text); },
    /** Insert ALREADY-sanitized HTML (only ever call on sanitizeHtml output). */
    insertHtml(html) { return this.exec("insertHTML", html); },
    /** Wrap the current selection in a link to url. */
    createLink(url) { return this.exec("createLink", url); },
    /** Make Enter produce the given block separator ("p" => <p>). */
    setParagraphSeparator(sep) { return this.exec("defaultParagraphSeparator", sep); },
  };

  // ============================================================
  // Shortcut char-class — single source of truth (plan step 1)
  // ASCII A-Z a-z 0-9 _ - : the only real bug was the missing hyphen,
  // and stored data is already ASCII-stripped, so Unicode would force a
  // needless migration. content.js (slash), options.js (live-strip) and
  // validateTemplates all derive from this one constant.
  // ============================================================
  TL.SHORTCUT_CHARS = "A-Za-z0-9_-";

  /** Compiled once; used by stripShortcut and the options live-strip (per keystroke). */
  TL.SHORTCUT_STRIP_RE = new RegExp(`[^${TL.SHORTCUT_CHARS}]`, "g");

  /** Strip a shortcut down to the allowed char-class; trim trailing hyphens.
   *  The trim runs AFTER the cap, not before: trimming first let the slice cut
   *  an over-long value back to a trailing hyphen, so the one thing this
   *  function promises — a shortcut never ends in "-" — failed at exactly the
   *  length where it is hardest to notice. */
  TL.stripShortcut = (s) =>
    String(s ?? "")
      .replace(TL.SHORTCUT_STRIP_RE, "")
      .slice(0, TL.LIMITS.MAX_SHORTCUT)
      .replace(/-+$/, "");

  /** Matches a trailing /shortcut. Non-global (no lastIndex state), so one
   *  compiled instance is safe to share across every call. */
  const SLASH_RE = new RegExp(`\\/([${TL.SHORTCUT_CHARS}]+)$`);
  TL.slashRegex = () => SLASH_RE;

  // ============================================================
  // Deterministic id + schema migration (plan step 7)
  // ============================================================
  /** FNV-1a 32-bit hash → 8 hex chars. Deterministic across contexts.
   *  Shared by makeId (below) and the options page's write-echo fingerprint. */
  TL.fnv1a = function (str) {
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return ("00000000" + (h >>> 0).toString(16)).slice(-8);
  };

  /** Deterministic id from name+body (NOT random — concurrent migrations converge). */
  const makeId = (tpl) => "t_" + TL.fnv1a(String(tpl?.name ?? "") + " " + String(tpl?.body ?? ""));

  /**
   * Forward-only, pure, idempotent migration of a raw storage object to the
   * current schema. Never drops unknown store keys; assigns stable ids + order
   * to legacy templates, clamps oversized bodies and strips the retired
   * per-template `fields` array (v3: fields are always derived from the body
   * via parseFields — a stored copy was a second source of truth nobody read).
   * @param {any} store
   * @returns {{schemaVersion:number, templates:TLTemplate[], [k:string]:any}}
   */
  TL.migrate = function (store) {
    const s = (store && typeof store === "object" && !Array.isArray(store)) ? store : {};
    const rawTemplates = Array.isArray(s.templates) ? s.templates : [];
    const out = { ...s };
    const seen = new Set();

    out.templates = rawTemplates.map((t, i) => {
      const base = (t && typeof t === "object") ? t : {};
      const name = String(base.name ?? "").slice(0, TL.LIMITS.MAX_NAME);
      let body = String(base.body ?? "");
      if (body.length > TL.LIMITS.MAX_BODY) {
        // Clamp on read too: a bloated legacy record would otherwise ride
        // along unbounded in memory until the next write.
        body = body.slice(0, TL.LIMITS.MAX_BODY);
        if (base.format === "html") body = TL.sanitizeHtml(body); // repair a mid-tag cut
      }
      let id = (typeof base.id === "string" && base.id) ? base.id : makeId({ name, body });
      while (seen.has(id)) id += "x"; // deterministic collision disambiguation
      seen.add(id);

      /** @type {TLTemplate} */
      const tpl = {
        id,
        order: (typeof base.order === "number") ? base.order : i,
        name,
        shortcut: TL.stripShortcut(base.shortcut),
        body,
      };
      if (Array.isArray(base.tags)) tpl.tags = TL.normalizeTags(base.tags);
      if (base.format === "html") tpl.format = "html"; // storage already sanitized; copy hint
      copyGrouping(base, tpl);
      return tpl;
    });
    // v4: folders are optional. A store without them stays without them —
    // absent === "no folders", so v3 → v4 needs no data rewrite.
    if ("folders" in s) out.folders = TL.normalizeFolders(s.folders);

    out.schemaVersion = TL.CURRENT_SCHEMA;
    return out;
  };

  /** folderId / favorite are optional: copied only when meaningful, so a
   *  template that never touched grouping serializes exactly as in v3. */
  function copyGrouping(src, tpl) {
    if (typeof src.folderId === "string" && src.folderId && src.folderId.length <= 64) tpl.folderId = src.folderId;
    if (src.favorite === true) tpl.favorite = true;
  }

  // ============================================================
  // Folders (v4) — one level, stored under their own "folders" key.
  // A template points at a folder by id; a dangling id reads as
  // uncategorized, so deleting a folder can never lose a template.
  // ============================================================
  TL.cleanFolderName = (name) =>
    String(name ?? "").replace(/\s+/g, " ").trim().slice(0, TL.LIMITS.MAX_FOLDER_NAME);

  /** Random id — folders are born from a user action, never from a
   *  concurrent migration, so they don't need makeId's determinism. */
  TL.makeFolderId = () => "f_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);

  /**
   * Pure: drop malformed/unnamed entries and duplicate ids, cap, sort by
   * order and re-stamp order by position.
   * @param {unknown} raw
   * @returns {TLFolder[]}
   */
  TL.normalizeFolders = function (raw) {
    const seen = new Set();
    const list = (Array.isArray(raw) ? raw : [])
      .map((/** @type {any} */ f, i) => ({
        id: (f && typeof f.id === "string" && f.id.length <= 64) ? f.id : "",
        name: TL.cleanFolderName(f?.name),
        order: typeof f?.order === "number" ? f.order : i,
      }))
      .filter((f) => f.id && f.name && !seen.has(f.id) && seen.add(f.id))
      .sort((a, b) => a.order - b.order)
      .slice(0, TL.LIMITS.MAX_FOLDERS);
    return list.map((f, i) => ({ id: f.id, name: f.name, order: i }));
  };

  /**
   * The folder a template is effectively in: its folderId when that folder
   * exists, "" (uncategorized) otherwise.
   * @param {{folderId?:string}} tpl
   * @param {Set<string>} folderIds
   */
  TL.folderOf = (tpl, folderIds) => (tpl.folderId && folderIds.has(tpl.folderId) ? tpl.folderId : "");

  TL.normalizeTags = (tags) =>
    (Array.isArray(tags) ? tags : [])
      .map((x) => String(x ?? "").trim().slice(0, TL.LIMITS.MAX_TAG_LEN))
      .filter(Boolean)
      .slice(0, TL.LIMITS.MAX_TAGS);

  // ============================================================
  // Storage wrappers
  // ============================================================

  /** Read templates, migrate-on-read (no write), order-sorted. */
  TL.getTemplates = async function () {
    const { templates = [] } = await chrome.storage.local.get("templates");
    const migrated = TL.migrate({ templates });
    return migrated.templates.sort((a, b) => a.order - b.order);
  };

  /** @returns {Promise<TLFolder[]>} */
  TL.getFolders = async function () {
    const { folders = [] } = await chrome.storage.local.get("folders");
    return TL.normalizeFolders(folders);
  };

  /**
   * @param {unknown[]} folders
   * @returns {Promise<TLFolder[]>} the list actually written
   */
  TL.setFolders = async function (folders) {
    const norm = TL.normalizeFolders(folders);
    await chrome.storage.local.set({ folders: norm });
    return norm;
  };

  /**
   * Pure write-side normalization: re-stamp order by array index, ensure ids,
   * apply caps, strip shortcuts, re-sanitize HTML. This is EXACTLY what
   * setTemplates persists — the options page fingerprints its output to
   * recognise its own storage echo, so in-memory drift (a trailing hyphen the
   * live-strip keeps, a `tags` key appended after `format`) can never be
   * mistaken for an external change.
   * @param {unknown[]} templates
   * @returns {TLTemplate[]}
   */
  TL.normalizeTemplates = function (templates) {
    const seen = new Set(); // same uniqueness guarantee migrate() gives on read
    return (Array.isArray(templates) ? templates : [])
      .slice(0, TL.LIMITS.MAX_TEMPLATES)
      .map((/** @type {any} */ t, i) => {
        const name = String(t.name ?? "").slice(0, TL.LIMITS.MAX_NAME);
        // HTML templates are re-sanitized on write so storage NEVER holds dirty HTML.
        const isHtml = t.format === "html";
        let body = isHtml ? TL.sanitizeHtml(String(t.body ?? "")) : String(t.body ?? "");
        if (body.length > TL.LIMITS.MAX_BODY) {
          body = body.slice(0, TL.LIMITS.MAX_BODY);
          // Re-sanitizing the clamped slice repairs a mid-tag cut (same repair
          // as storeRichBody) so storage never holds malformed HTML.
          if (isHtml) body = TL.sanitizeHtml(body);
        }
        let id = (typeof t.id === "string" && t.id) ? t.id : makeId({ name, body });
        while (seen.has(id)) id += "x"; // two identical imports must not share an id
        seen.add(id);
        /** @type {TLTemplate} */
        const tpl = {
          id,
          order: i,
          name,
          shortcut: TL.stripShortcut(t.shortcut),
          body,
        };
        if (Array.isArray(t.tags)) tpl.tags = TL.normalizeTags(t.tags);
        if (isHtml) tpl.format = "html";
        copyGrouping(t, tpl);
        return tpl;
      });
  };

  /**
   * Persist templates (normalized). Resolves with the list that was actually
   * written so callers can fingerprint it without normalizing twice.
   * @param {unknown[]} templates
   * @returns {Promise<TLTemplate[]>}
   */
  TL.setTemplates = async function (templates) {
    const norm = TL.normalizeTemplates(templates);
    await chrome.storage.local.set({ templates: norm, schemaVersion: TL.CURRENT_SCHEMA });
    return norm;
  };

  // ============================================================
  // Remember-last values. One storage key PER TEMPLATE ("lastValues:<id>")
  // so concurrent writes from different templates/contexts can't clobber
  // each other in a read-modify-write of one shared blob. The pre-2.4.2
  // shared "lastValues" blob is folded into these keys once, on update, by
  // migrateLastValues (background) — no lazy fallback on the read path.
  // ============================================================
  const lvKey = (id) => "lastValues:" + id;

  /**
   * Load the remembered values for one template.
   * @param {string} templateId
   * @returns {Promise<Record<string,string>>}
   */
  TL.getLastValues = async function (templateId) {
    if (!templateId) return {};
    try {
      const key = lvKey(templateId);
      const got = await chrome.storage.local.get(key);
      return /** @type {Record<string,string>} */ (got[key] || {});
    } catch (_) { return {}; }
  };

  /**
   * Merge new remembered values for one template. Only this template's key is
   * written; a same-template race can still last-write-win, which is harmless.
   * Secret-named entries are dropped HERE as well as at the callers: the store
   * is the last place that can still refuse to put a password on disk, and a
   * caller that forgets the check must not be able to get one past it.
   * @param {string} templateId
   * @param {Record<string,string>} values
   */
  TL.saveLastValues = async function (templateId, values) {
    if (!templateId || !values) return;
    const safe = {};
    for (const [k, v] of Object.entries(values)) if (!TL.isSecretName(k)) safe[k] = v;
    if (!Object.keys(safe).length) return;
    try {
      const current = await TL.getLastValues(templateId);
      await chrome.storage.local.set({ [lvKey(templateId)]: { ...current, ...safe } });
    } catch (_) { /* storage unavailable */ }
  };

  /**
   * Sweep remembered values whose field name is secret under the CURRENT rule.
   * Widening isSecretName only stops future writes; anything a user already had
   * remembered under a narrower rule (the English-only list missed "sifre",
   * "parola", "kart_no" …) is still on disk in the clear. Called once per
   * update from the background migration. Idempotent.
   */
  TL.purgeSecretLastValues = async function () {
    try {
      const all = await chrome.storage.local.get(null);
      const write = {};
      const drop = [];
      for (const [key, values] of Object.entries(all)) {
        if (!key.startsWith("lastValues:") || !values || typeof values !== "object") continue;
        const kept = {};
        let purged = false;
        for (const [name, v] of Object.entries(values)) {
          if (TL.isSecretName(name)) purged = true;
          else kept[name] = v;
        }
        if (!purged) continue;
        if (Object.keys(kept).length) write[key] = kept;
        else drop.push(key);
      }
      if (Object.keys(write).length) await chrome.storage.local.set(write);
      if (drop.length) await chrome.storage.local.remove(drop);
    } catch (_) { /* storage unavailable — nothing we can do here */ }
  };

  /**
   * One-shot eager migration of the pre-2.4.2 shared "lastValues" blob into
   * per-template keys, then remove the blob. Existing per-template keys win
   * (they are newer by definition). Idempotent; called from the background
   * onInstalled(update) handler — the single migration writer.
   */
  TL.migrateLastValues = async function () {
    try {
      const { lastValues } = await chrome.storage.local.get("lastValues");
      if (!lastValues || typeof lastValues !== "object") return;
      const ids = Object.keys(lastValues);
      if (ids.length) {
        const existing = await chrome.storage.local.get(ids.map(lvKey));
        const out = {};
        for (const id of ids) {
          const key = lvKey(id);
          if (!existing[key]) out[key] = lastValues[id];
        }
        if (Object.keys(out).length) await chrome.storage.local.set(out);
      }
      await chrome.storage.local.remove("lastValues");
    } catch (_) { /* storage unavailable — lazy fallback keeps working */ }
  };

  /**
   * Remove the orphaned remembered values for a deleted template.
   * Safe no-op if none exist.
   * @param {string} templateId
   */
  TL.clearLastValues = async function (templateId) {
    if (!templateId) return;
    try { await chrome.storage.local.remove(lvKey(templateId)); }
    catch (_) { /* storage unavailable — nothing to clean */ }
  };

  /**
   * Remove every "lastValues:<id>" key whose template no longer exists.
   * clearLastValues covers single deletes; replace-import and backup restore
   * swap the whole list at once and would otherwise leave orphans forever.
   * Reads the full store, so call it only after those bulk operations.
   * @param {string[]} validIds
   */
  TL.gcLastValues = async function (validIds) {
    try {
      const keep = new Set(Array.isArray(validIds) ? validIds : []);
      const all = await chrome.storage.local.get(null);
      const orphans = Object.keys(all).filter((k) => k.startsWith("lastValues:") && !keep.has(k.slice(11)));
      if (orphans.length) await chrome.storage.local.remove(orphans);
    } catch (_) { /* storage unavailable — orphans are harmless */ }
  };

  // ============================================================
  // Field validation + import validation summary (plan steps 6, 11)
  // ============================================================
  const FIELD_TYPES = ["text", "multiline", "dropdown", "date", "checkbox"];

  /**
   * Validate + normalize imported templates, returning a summary so the UI
   * can report what was accepted / rejected / truncated.
   * @param {unknown} raw
   * Grouping travels by folder NAME (`folder`), not id: ids are local to one
   * install, a name means the same thing on every machine.
   * @returns {{accepted:Array<{name:string,shortcut:string,body:string,tags?:string[],format?:"text"|"html",folder?:string,favorite?:boolean}>, rejected:number, truncated:number}}
   */
  TL.validateTemplates = function (raw) {
    const items = Array.isArray(raw) ? raw : [raw];
    const accepted = [];
    let rejected = 0;
    let truncated = 0;

    for (const t of items) {
      if (!t || typeof t !== "object" || typeof t.body !== "string") { rejected++; continue; }
      const isHtml = t.format === "html";
      // Imported HTML is sanitized here — never trust an external file's markup.
      let body = isHtml ? TL.sanitizeHtml(t.body) : t.body;
      if (body.length > TL.LIMITS.MAX_BODY) {
        body = body.slice(0, TL.LIMITS.MAX_BODY);
        if (isHtml) body = TL.sanitizeHtml(body); // repair a mid-tag cut
        truncated++;
      }
      const tpl = {
        name: String(t.name ?? "Template").slice(0, TL.LIMITS.MAX_NAME),
        shortcut: TL.stripShortcut(t.shortcut ?? ""),
        body,
      };
      if (Array.isArray(t.tags)) tpl.tags = TL.normalizeTags(t.tags);
      if (isHtml) tpl.format = "html";
      const folder = TL.cleanFolderName(t.folder);
      if (folder) tpl.folder = folder;
      if (t.favorite === true) tpl.favorite = true;
      accepted.push(tpl);
      if (accepted.length >= TL.LIMITS.MAX_TEMPLATES) break;
    }
    return { accepted, rejected, truncated };
  };

  // ============================================================
  // Dynamic variables (plan step 10) — zero permissions, pure
  // {{date}} {{time}} {{datetime}} {{date+3d}} {{date-2w}} {{cursor}}
  // ============================================================
  TL.CURSOR_TOKEN = ""; // private-use sentinel; stripped after paste

  const pad2 = (n) => String(n).padStart(2, "0");
  const formatTime = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

  /** Date formats accepted by {{date|fmt}} and the `date` field's options slot. */
  TL.DATE_FORMATS = Object.freeze(["yyyy-MM-dd", "dd.MM.yyyy", "dd/MM/yyyy", "MM/dd/yyyy", "d MMM yyyy"]);
  const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /**
   * Format a date with a tiny yyyy/MM/dd/d/MMM token set. Unknown formats fall
   * back to ISO so a typo in a template never yields "undefined".
   * @param {Date} d
   * @param {string} [fmt]
   */
  TL.formatDate = function (d, fmt) {
    const f = TL.DATE_FORMATS.includes(fmt) ? fmt : "yyyy-MM-dd";
    return f.replace(/yyyy|MMM|MM|dd|d/g, (t) => {
      if (t === "yyyy") return String(d.getFullYear());
      if (t === "MMM") return MONTHS_SHORT[d.getMonth()];
      if (t === "MM") return pad2(d.getMonth() + 1);
      if (t === "dd") return pad2(d.getDate());
      return String(d.getDate());
    });
  };
  const formatDate = TL.formatDate;

  /**
   * Re-format an ISO date string (what <input type=date> yields) with a
   * DATE_FORMATS entry. Non-ISO input is returned unchanged.
   * @param {string} iso
   * @param {string} [fmt]
   */
  TL.formatIsoDate = function (iso, fmt) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
    if (!m) return String(iso ?? "");
    return formatDate(new Date(+m[1], +m[2] - 1, +m[3]), fmt);
  };

  /**
   * Apply a "+3d" / "-2w" / "+1m" / "+1y" offset to a date (month/year clamp
   * to the last day of the target month: Jan 31 + 1m → Feb 28/29).
   * @param {Date} base
   * @param {string} sign "+" | "-"
   * @param {number} n
   * @param {string} unit d|w|m|y
   */
  function offsetDate(base, sign, n, unit) {
    const d = new Date(base.getTime());
    const k = n * (sign === "-" ? -1 : 1);
    if (unit === "d") d.setDate(d.getDate() + k);
    else if (unit === "w") d.setDate(d.getDate() + k * 7);
    else {
      const day = d.getDate();
      if (unit === "m") d.setMonth(d.getMonth() + k);
      else d.setFullYear(d.getFullYear() + k);
      if (d.getDate() !== day) d.setDate(0);
    }
    return d;
  }

  /**
   * Resolve a `date` field default into an ISO value for <input type=date>:
   * "" → "", "today" → today, "+3d"/"-2w"/… → offset, ISO → as-is.
   * @param {string} def
   * @param {Date} [now]
   * @returns {string} ISO yyyy-MM-dd or ""
   */
  TL.resolveDateDefault = function (def, now) {
    const s = String(def ?? "").trim();
    if (!s) return "";
    const base = now instanceof Date ? now : new Date();
    if (/^today$/i.test(s)) return formatDate(base);
    const m = /^([+-])\s*(\d+)\s*([dwmy])$/i.exec(s);
    if (m) return formatDate(offsetDate(base, m[1], parseInt(m[2], 10), m[3].toLowerCase()));
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
  };

  /**
   * Resolve date/time/cursor variables. `now` injectable for deterministic tests.
   * @param {string} text
   * @param {Date} [now]
   * @returns {string}
   */
  TL.applyDynamicVars = function (text, now) {
    const base = now instanceof Date ? now : new Date();
    // {{date}} {{date+3d}} {{date|dd.MM.yyyy}} {{date-1w|d MMM yyyy}} {{datetime}} {{time}}
    let out = String(text).replace(
      /\{\{\s*(date|time|datetime)(?:\s*([+-])\s*(\d+)\s*([dwmy]))?\s*(?:\|\s*([^|{}]+?)\s*)?\}\}/gi,
      (_m, kind, sign, num, unit, fmt) => {
        const d = (sign && num && unit) ? offsetDate(base, sign, parseInt(num, 10), unit.toLowerCase()) : base;
        const k = kind.toLowerCase();
        if (k === "time") return formatTime(d);
        if (k === "datetime") return `${formatDate(d, fmt)} ${formatTime(d)}`;
        return formatDate(d, fmt);
      }
    );
    out = out.replace(/\{\{\s*cursor\s*\}\}/gi, TL.CURSOR_TOKEN);
    return out;
  };

  // Names treated as dynamic — never prompted as form fields.
  const DYNAMIC_RE = /^(date|time|datetime|cursor)([+-]\d+[dwmy])?$/i;
  // Names that address Object.prototype rather than a value. They are not a
  // pollution vector here (fillTemplate gates on hasOwnProperty and the value
  // maps are plain literals), but an assignment to values["__proto__"] is
  // silently swallowed, so the token survives substitution and {{__proto__}}
  // is pasted verbatim into whatever the user sends a customer. Refusing the
  // name at the parser keeps that out of the form and out of the output.
  const RESERVED_NAME_RE = /^(__proto__|constructor|prototype)$/i;

  // ============================================================
  // Placeholder field parsing (plan step 11)
  // Pipe syntax: {{name|label|type|default|options|flags}}
  //   flags: comma-separated "remember", "required"
  //   date:  default "today" | "+3d" | ISO; options = format (see DATE_FORMATS)
  //   dropdown: an option of "*" adds a free-text "Other…" entry
  // Conditionals: {{#if name}} … {{else}} … {{/if}}  |  {{#if name=value}}
  //   An #if on an undeclared name auto-creates a checkbox field.
  // ============================================================
  const COND_OPEN_RE = /\{\{\s*#if\s+([^{}=|]+?)\s*(?:=\s*([^{}|]*?)\s*)?\}\}/gi;
  const COND_CTRL_RE = /^(#if\b|else$|\/if$)/i;

  /**
   * What a {{…}} token is, from its inner text: a form field, a condition
   * marker ({{#if x}} / {{else}} / {{/if}}) or a dynamic variable ({{date}},
   * {{cursor}}…). Same rules parseFields uses, so the editor's colours and
   * the form never disagree about a token.
   * @param {string} inner text between the braces
   * @returns {{kind: "field"|"control"|"dynamic", name: string}} name = field name
   *   (for an #if: the tested field; else/endif: "")
   */
  TL.tokenKind = function (inner) {
    const name = String(inner ?? "").split("|")[0].trim();
    if (COND_CTRL_RE.test(name)) {
      return { kind: "control", name: /^#if/i.test(name) ? name.slice(3).split("=")[0].trim() : "" };
    }
    if (DYNAMIC_RE.test(name)) return { kind: "dynamic", name };
    return { kind: "field", name };
  };

  /**
   * Parse form fields from a template body (after dynamic vars resolved).
   * @param {string} text
   * @returns {TLField[]}
   */
  TL.parseFields = function (text) {
    const src = String(text ?? "");
    const re = /\{\{([^{}]+)\}\}/g;
    const seen = new Set();
    /** @type {TLField[]} */
    const out = [];
    let m;
    while ((m = re.exec(src)) !== null) {
      const parts = m[1].split("|").map((s) => s.trim());
      const name = parts[0];
      if (!name || COND_CTRL_RE.test(name) || DYNAMIC_RE.test(name) || RESERVED_NAME_RE.test(name) || seen.has(name)) continue;
      seen.add(name);
      let type = (parts[2] || "text").toLowerCase();
      if (!FIELD_TYPES.includes(type)) type = "text";
      let options = [];
      if (type === "dropdown" && parts[4]) {
        options = parts[4].split(",").map((s) => s.trim()).filter(Boolean).slice(0, TL.LIMITS.MAX_OPTIONS);
      } else if (type === "date" && parts[4] && TL.DATE_FORMATS.includes(parts[4])) {
        options = [parts[4]];
      }
      const flags = new Set((parts[5] || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean));
      out.push({
        name,
        label: parts[1] || name,
        type: /** @type {any} */ (type),
        def: parts[3] || "",
        options,
        remember: flags.has("remember") && !TL.isSecretName(name),
        required: flags.has("required"),
      });
    }
    // {{#if flag}} on a name that is not a declared field → implicit checkbox.
    COND_OPEN_RE.lastIndex = 0;
    while ((m = COND_OPEN_RE.exec(src)) !== null) {
      const name = m[1].trim();
      if (!name || seen.has(name) || DYNAMIC_RE.test(name) || RESERVED_NAME_RE.test(name)) continue;
      seen.add(name);
      out.push({ name, label: name, type: "checkbox", def: "", options: [], remember: false, required: false });
    }
    return out.slice(0, TL.LIMITS.MAX_FIELDS);
  };

  /**
   * Truthiness used by {{#if}}: checkbox "true", any non-empty text, or
   * (with =value) a case-insensitive equality against the value.
   * @param {Record<string,string>} values
   * @param {string} name
   * @param {string|undefined} eq
   */
  function condTrue(values, name, eq) {
    const v = String((values && values[name]) ?? "").trim();
    if (eq !== undefined) return v.toLowerCase() === String(eq).trim().toLowerCase();
    return v !== "" && v !== "false" && v !== "0";
  }

  /**
   * Resolve {{#if}}…{{else}}…{{/if}} blocks against form values (single level;
   * runs BEFORE fillTemplate so removed branches never leak placeholders).
   * Unterminated blocks are left untouched.
   * @param {string} template
   * @param {Record<string,string>} values
   * @returns {string}
   */
  // One token of the condition grammar. Same shapes COND_BLOCK_RE accepts,
  // pulled apart so a single left-to-right pass can pair them up.
  //   1 = #if name, 2 = #if value (optional), 3 = else, 4 = /if
  const COND_TOKEN_RE =
    /\{\{\s*(?:#if\s+([^{}=|]+?)\s*(?:=\s*([^{}|]*?)\s*)?|(else)\s*|(\/if)\s*)\}\}/gi;

  TL.applyConditionals = function (template, values) {
    const src = String(template ?? "");
    if (src.indexOf("{{") < 0) return src;

    // A scanner, not a regex, and the reason is a denial of service.
    // COND_BLOCK_RE carries two lazy [\s\S]*? spans; on an unclosed
    // {{#if}}…{{else}} chain its backtracking is cubic — 4ms at 1.7 KB, 204ms
    // at 6.8 KB, 4.8s at MAX_BODY — and this runs on the PAGE's main thread
    // while someone is pasting. A structural gate ("refuse the whole body if
    // the lint rejects it") fixed the hang but was too blunt: one stray
    // {{/if}} anywhere disabled every well-formed block before it. This pass
    // is linear AND resolves each block independently, so a broken marker
    // costs only itself.
    //
    // The pairing rule reproduces the regex exactly: from an #if, take the
    // FIRST {{/if}} after it; an {{else}} splits the block only when it comes
    // before that {{/if}}, and only the first one does. Everything else in
    // between — including a nested #if — is literal branch content, which is
    // what the lazy spans produced. Branch content is emitted verbatim and
    // never rescanned, exactly as String.replace does not rescan its output.
    const tokens = [];
    COND_TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = COND_TOKEN_RE.exec(src)) !== null) {
      tokens.push({
        kind: m[3] ? "else" : m[4] ? "end" : "if",
        name: m[1],
        value: m[2],
        start: m.index,
        end: m.index + m[0].length,
      });
    }
    if (!tokens.length) return src;

    // Index of the first "end" at or after each token. Without it, a chain of
    // unterminated #ifs would rescan the tail for every one of them — which is
    // precisely the pathological input this rewrite exists to survive.
    const nextEnd = new Array(tokens.length);
    for (let j = tokens.length - 1; j >= 0; j--) {
      nextEnd[j] = tokens[j].kind === "end" ? j : (j + 1 < tokens.length ? nextEnd[j + 1] : -1);
    }

    let out = "";
    let pos = 0; // first source index not yet copied out
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.kind !== "if") continue;          // a stray else / /if stays literal
      const endIdx = i + 1 < tokens.length ? nextEnd[i + 1] : -1;
      if (endIdx < 0) continue;                 // never closed → literal, keep scanning
      let elseIdx = -1;
      for (let j = i + 1; j < endIdx; j++) {
        if (tokens[j].kind === "else") { elseIdx = j; break; }
      }
      const yes = src.slice(tok.end, (elseIdx >= 0 ? tokens[elseIdx] : tokens[endIdx]).start);
      const no = elseIdx >= 0 ? src.slice(tokens[elseIdx].end, tokens[endIdx].start) : "";
      out += src.slice(pos, tok.start);
      out += condTrue(values, String(tok.name ?? "").trim(), tok.value) ? yes : no;
      pos = tokens[endIdx].end;
      i = endIdx;                               // resume after the block we consumed
    }
    return out + src.slice(pos);
  };

  /**
   * Lint the {{#if}} structure of a body (settings page). Conditionals are
   * single-level and must pair up: applyConditionals leaves whatever it can't
   * pair as literal text, so a missing {{/if}} or a nested block silently
   * pastes raw markers into the customer's ticket. Returns the FIRST problem
   * in reading order, or null when the structure is sound.
   * @param {string} text
   * @returns {null | {code: "unclosed"|"nested"|"strayElse"|"strayClose"|"doubleElse"|"noName", name?: string}}
   */
  TL.checkConditionals = function (text) {
    const re = /\{\{\s*(#if\b[^{}]*|else|\/if)\s*\}\}/gi;
    const src = String(text ?? "");
    /** @type {string|null} */
    let open = null;
    let sawElse = false;
    let m;
    while ((m = re.exec(src)) !== null) {
      const tok = m[1].trim();
      if (/^#if/i.test(tok)) {
        const name = tok.slice(3).split("=")[0].trim();
        if (!name) return { code: "noName" };
        if (open !== null) return { code: "nested", name };
        open = name;
        sawElse = false;
      } else if (/^else$/i.test(tok)) {
        if (open === null) return { code: "strayElse" };
        if (sawElse) return { code: "doubleElse", name: open };
        sawElse = true;
      } else {
        if (open === null) return { code: "strayClose" };
        open = null;
      }
    }
    return open !== null ? { code: "unclosed", name: open } : null;
  };

  /**
   * Fill {{placeholders}} (supporting pipe syntax) with values.
   * For HTML templates pass {escape:true} so every user value is HTML-escaped
   * BEFORE substitution — this is what keeps a malicious value (e.g. an
   * `<img onerror>`) from injecting markup at the one HTML insertion sink.
   * @param {string} template
   * @param {Record<string,string>} values
   * @param {{escape?:boolean}} [opts]
   * @returns {string}
   */
  TL.fillTemplate = function (template, values, opts) {
    const escape = !!(opts && opts.escape);
    return String(template).replace(/\{\{([^{}]+?)\}\}/g, (full, inner) => {
      const name = inner.split("|")[0].trim();
      if (values && Object.prototype.hasOwnProperty.call(values, name)) {
        return escape ? TL.escapeHtml(values[name]) : values[name];
      }
      return full;
    });
  };

  // --- Secret field detection (remember-last opt-out) ---
  // Matching is TOKEN-based, not substring: the old un-anchored stems flagged
  // "shipping", "passenger", "bypass" and "pinned" as credentials.
  // Names are folded to ASCII first, so "Şifre" / "şifre" / "sifre" are one
  // rule — the extension ships a Turkish locale (its first-run Turkish
  // template is shortcut "sifre"), and an English-only list meant `remember`
  // wrote Turkish users' passwords to storage in the clear.
  const SECRET_TOKENS = new Set([
    // English
    "pass", "passwd", "password", "pwd", "pw", "otp", "2fa", "mfa", "totp",
    "cvv", "cvc", "cvn", "ccv", "secret", "token", "bearer", "session", "cookie",
    "auth", "jwt", "credential", "credentials", "master", "ssh",
    "pin", "iban", "ssn", "passport", "seed", "mnemonic", "apikey", "creditcard",
    // Turkish
    "sifre", "parola", "gizli", "anahtar", "pasaport", "kimlik", "tckn", "vkn", "kartno",
  ]);
  // Turkish roots matched as a PREFIX, not as a whole token. Turkish is
  // agglutinative — suffixes attach to the end of the root — so "sifre",
  // "sifreniz", "sifresi" and "sifrem" are one word, and token equality
  // missed every inflected form. That left the extension weakest in the very
  // language its own first-run template ships in (shortcut "sifre").
  // Deliberately NOT applied to the English stems: prefix-matching "pass"
  // brings back "passenger"/"bypass", which is why the token rule exists.
  // A false positive here only means a value is not remembered; a false
  // negative means a password on disk. The trade is not symmetric.
  const SECRET_PREFIXES_TR = [
    "sifre", "parola", "gizli", "anahtar", "kart", "kimlik", "pasaport", "guvenlik", "kredi",
  ];
  // Two-word concepts, matched against the folded underscore form.
  const SECRET_PHRASES =
    /(?:api|private|secret)_?key|credit_?card|card_?(?:number|no)|kart_?(?:no|numara)|kredi_?kart|guvenlik_?kod|dogrulama_?kod|sms_?kod|security_?code|recovery_?(?:phrase|code|key|kod)|tc_?(?:no|kn)|vergi_?no/;

  /** Fold a field name to lowercase ASCII tokens joined by "_". */
  const foldName = (name) =>
    String(name ?? "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")  // camelCase -> camel_Case
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")         // ş -> s, ü -> u, ğ -> g …
      .replace(/ı/g, "i")                 // dotless ı carries no mark
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

  TL.isSecretName = function (name) {
    const folded = foldName(name);
    if (!folded) return false;
    if (SECRET_PHRASES.test(folded)) return true;
    return folded.split("_").some((token) => {
      // "password1" / "pass1" / "pin2": a trailing counter is not a different
      // word. Stripping digits cannot create a false positive here — the
      // stripped form still has to BE one of the listed tokens.
      const bare = token.replace(/\d+$/, "");
      if (SECRET_TOKENS.has(token) || SECRET_TOKENS.has(bare)) return true;
      return SECRET_PREFIXES_TR.some((root) => bare.startsWith(root));
    });
  };

  /**
   * Is an element's on-screen part actually reachable at some point inside it?
   * Pure geometry so it can be unit-tested without a DOM: the caller supplies
   * the rect, the viewport and a hit-test closure.
   *
   * Samples the VISIBLE part, not the whole rect's centre. A composer taller
   * than the viewport has its centre off-screen, and a placeholder overlay or
   * a sticky toolbar owns the one pixel at the middle — all everyday layouts,
   * and a single centre probe called every one of them hidden.
   * Five points, and ANY hit is enough: an overlay that covers the middle
   * still leaves the corners of the visible band clear.
   *
   * @param {{left:number, top:number, width:number, height:number}} rect
   * @param {{width:number, height:number}} viewport
   * @param {(x:number, y:number) => boolean} hitAt true if that point lands on the element
   * @returns {boolean}
   */
  TL.visibleHit = function (rect, viewport, hitAt) {
    const left = Math.max(rect.left, 0);
    const top = Math.max(rect.top, 0);
    const right = Math.min(rect.left + rect.width, viewport.width);
    const bottom = Math.min(rect.top + rect.height, viewport.height);
    if (!(right > left) || !(bottom > top)) return false; // nothing of it is on screen
    const w = right - left;
    const h = bottom - top;
    return [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]
      .some(([fx, fy]) => hitAt(left + w * fx, top + h * fy));
  };

  // Public href validator (same function the sanitizer uses) so callers like
  // the options link-toolbar can pass a CLEANED url to the editor backend
  // instead of the raw prompt value.
  TL.cleanHref = cleanHref;

  // ============================================================
  // Fuzzy scorer (plan step 17) — subsequence match with bonuses
  // ============================================================
  /** @returns {number} higher = better, -1 = no subsequence match */
  TL.fuzzyScore = function (query, target) {
    const q = String(query ?? "").toLowerCase();
    const t = String(target ?? "").toLowerCase();
    if (!q) return 0;
    let qi = 0, score = 0, prev = -2;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) {
        score += ti === prev + 1 ? 3 : 1; // consecutive bonus
        if (ti === 0) score += 4;          // start-of-string bonus
        prev = ti;
        qi++;
      }
    }
    return qi === q.length ? score : -1;
  };

  /**
   * Rank templates by fuzzy match over shortcut (weighted) then name.
   * @param {string} query
   * @param {any[]} templates
   * @param {number} [limit]
   */
  TL.fuzzySearch = function (query, templates, limit = 8) {
    if (!query) return templates.slice(0, limit);
    const scored = [];
    for (const t of templates) {
      // Weight the shortcut ONLY when it actually matches: a miss is -1 and
      // "-1 + 2" would otherwise turn every non-matching template into a
      // score-1 false positive (the whole list would pop up for garbage input).
      const scShortcut = TL.fuzzyScore(query, t.shortcut || "");
      const scName = TL.fuzzyScore(query, t.name || "");
      const sc = Math.max(scShortcut >= 0 ? scShortcut + 2 : -1, scName);
      if (sc >= 0) scored.push({ t, s: sc });
    }
    // Equal scores: favorites first (sort is stable, so order breaks the rest).
    scored.sort((a, b) => (b.s - a.s) || ((b.t.favorite ? 1 : 0) - (a.t.favorite ? 1 : 0)));
    return scored.slice(0, limit).map((x) => x.t);
  };

  // Expose
  global.TL = TL;
  // Node (unit tests) — pure functions don't touch chrome.
  if (typeof module !== "undefined" && module.exports) module.exports = TL;
})(typeof self !== "undefined" ? self : (typeof globalThis !== "undefined" ? globalThis : this));
