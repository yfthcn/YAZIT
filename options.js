// @ts-check
// ==============================
// YAZIT — Options page
// ==============================

(async function () {
  "use strict";

  // --- State ---
  let templates = [];
  let selectedIds = new Set();      // id-based (survives reorder/delete) — plan step 17
  let pendingImport = null;          // validated templates awaiting confirm
  let pendingConflicts = [];         // incoming shortcuts that collide (lowercased)
  let pendingSource = null;          // "textblaze" | "magical" | null
  let userLang = "auto";
  let lastWriteSig = "";             // fingerprint of our last write (echo detection)
  let lastFocusedBody = null;        // for variable insertion
  let searchTerm = "";
  // Which cards are open. Id-based like selectedIds, so a reorder/delete or an
  // external-change render() keeps them open; everything starts collapsed so
  // the page is a scannable list at 5 templates and at 100.
  const expanded = new Set();
  let slotKeys = ["", "", ""];         // real Ctrl+Shift+1..3 bindings (platform/remap aware)
  /** @type {TLFolder[]} */
  let folders = [];
  let lastFoldersSig = "";           // echo detection for the "folders" key
  /** "" = all, "*" = favorites, "~" = uncategorized, otherwise a folder id */
  let view = "";

  // Fingerprint of a template list — only OUR own storage echo matches it, so
  // a concurrent write from another context (other tab/backup/migration) is
  // applied instead of being swallowed. FNV-1a over the full JSON; runs only
  // on save and on storage-change events, never per keystroke.
  // Always taken over the list setTemplates actually WROTE (its return value),
  // never over the in-memory array: the live-strip keeps a trailing hyphen
  // that storage drops, and a `tags` key added to a rich template lands after
  // `format` in memory but before it in storage — either mismatch used to make
  // our own echo look external and re-render every card mid-keystroke.
  const sig = (list) => TL.fnv1a(JSON.stringify(Array.isArray(list) ? list : []));

  // Scroll behaviour for the three places this page moves the viewport itself.
  // An explicit behavior:"smooth" in JS wins over the stylesheet's
  // scroll-behavior, so the reduced-motion media query alone would not reach
  // these — the preference has to be read here too. Queried per call: the
  // setting can be flipped while the page is open.
  const scrollBehavior = () =>
    /** @type {ScrollBehavior} */ (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

  // getSlotKeys does not depend on the language; awaiting it after the locale
  // fetch just added its round trip to the page's time-to-first-paint.
  const [langPref, slots] = await Promise.all([TL.getLang(), TL.getSlotKeys()]);
  userLang = langPref;
  slotKeys = slots;
  document.documentElement.lang = await TL.loadLocale(userLang);

  const $ = (id) => /** @type {any} */ (document.getElementById(id));
  const refs = {
    pageTitle: $("page-title"), title: $("title"), subtitle: $("subtitle"),
    hintsTitle: $("hints-title"), hintPlaceholder: $("hint-placeholder"),
    hintShortcut: $("hint-shortcut"), hintSlash: $("hint-slash"), hintIf: $("hint-if"),
    hints: $("hints"), hintsClose: $("hints-close"),
    dlg: $("dlg"), dlgTitle: $("dlg-title"), dlgMsg: $("dlg-msg"), dlgInput: $("dlg-input"),
    dlgCancel: $("dlg-cancel"), dlgOk: $("dlg-ok"),
    btnAdd: $("add"), btnExportAll: $("export-all"), btnExportClip: $("export-clip"),
    btnImport: $("import-btn"), btnBackups: $("backups-btn"), importFile: $("import-file"),
    status: $("status"), langSelect: $("lang-select"),
    dataBtn: $("data-btn"), settingsBtn: $("settings-btn"), toggleAll: $("toggle-all"),
    themeSelect: $("theme-select"), themeLabel: $("theme-label"), btnForgetAll: $("forget-all"),
    themeOptAuto: $("theme-opt-auto"), themeOptLight: $("theme-opt-light"), themeOptDark: $("theme-opt-dark"),
    search: $("search"), varBtn: $("var-btn"), varList: $("var-list"),
    backupsPanel: $("backups-panel"), backupsTitle: $("backups-title"), backupsList: $("backups-list"),
    selectionBar: $("selection-bar"), selectionCount: $("selection-count"),
    btnExportSelected: $("export-selected"), btnDeselectAll: $("deselect-all"),
    templates: $("templates"),
    importModal: $("import-modal"), importModalTitle: $("import-modal-title"),
    importPreview: $("import-preview"), importSource: $("import-source"),
    importMergeLabel: $("import-merge-label"), importReplaceLabel: $("import-replace-label"),
    importCancel: $("import-cancel"), importConfirm: $("import-confirm"),
    conflictNote: $("conflict-note"), conflictText: $("conflict-text"),
    conflictKeepboth: $("conflict-keepboth"), conflictOverwrite: $("conflict-overwrite"), conflictSkip: $("conflict-skip"),
    btnNewFolder: $("new-folder-btn"), folderNav: $("folder-nav"),
    footerMadeBy: $("footer-made-by"), footerGithub: $("footer-github"), footerVersion: $("footer-version"),
  };

  // --- Apply translations to static UI ---
  function applyUIStrings() {
    const title = TL.t("optionsTitle");
    refs.pageTitle.textContent = title;
    refs.title.textContent = title;
    refs.subtitle.textContent = TL.t("tagline");
    refs.hintsTitle.textContent = TL.t("hintsTitle");
    refs.hintPlaceholder.textContent = TL.t("hintPlaceholder");
    refs.hintShortcut.textContent = TL.t("hintShortcut", [TL.slotKeysHint(slotKeys) || "—"]);
    refs.hintsClose.title = TL.t("hintsClose");
    refs.hintsClose.setAttribute("aria-label", TL.t("hintsClose"));
    refs.hintSlash.textContent = TL.t("hintSlash");
    refs.hintIf.textContent = TL.t("hintIf");
    refs.btnAdd.textContent = TL.t("btnAdd");
    refs.btnExportAll.textContent = TL.t("btnExportAll");
    refs.btnExportClip.textContent = TL.t("btnExportClip");
    refs.btnImport.textContent = TL.t("btnImport");
    refs.btnBackups.textContent = TL.t("btnBackups");
    refs.btnNewFolder.textContent = "+ " + TL.t("folderNew");
    refs.folderNav.setAttribute("aria-label", TL.t("foldersHeading"));
    refs.btnExportSelected.textContent = TL.t("btnExportSelected");
    refs.btnDeselectAll.textContent = TL.t("btnDeselectAll");
    refs.importModalTitle.textContent = TL.t("btnImport");
    refs.importMergeLabel.textContent = TL.t("importMerge");
    refs.importReplaceLabel.textContent = TL.t("importReplace");
    refs.importCancel.textContent = TL.t("importCancel");
    refs.dlgCancel.textContent = TL.t("importCancel");
    refs.importConfirm.textContent = TL.t("btnImport");
    refs.conflictKeepboth.textContent = TL.t("conflictKeepboth");
    refs.conflictOverwrite.textContent = TL.t("conflictOverwrite");
    refs.conflictSkip.textContent = TL.t("conflictSkip");
    refs.backupsTitle.textContent = TL.t("backupsTitle");
    refs.langSelect.value = userLang;
    refs.dataBtn.textContent = TL.t("dataMenu");
    refs.settingsBtn.textContent = "\u2699 " + TL.t("settingsMenu");
    updateToggleAllLabel();
    refs.btnForgetAll.textContent = TL.t("forgetAllRemembered");
    refs.themeLabel.textContent = TL.t("themeLabel");
    refs.themeOptAuto.textContent = TL.t("themeAuto");
    refs.themeOptLight.textContent = TL.t("themeLight");
    refs.themeOptDark.textContent = TL.t("themeDark");
    refs.search.placeholder = TL.t("searchPlaceholder");
    refs.varBtn.textContent = TL.t("varInsert");
    refs.footerMadeBy.textContent = TL.t("madeBy") + " ";
    refs.footerGithub.textContent = TL.t("viewOnGithub");
    const version = "v" + chrome.runtime.getManifest().version;
    refs.footerVersion.textContent = version;
    const titleVersion = document.getElementById("title-version");
    if (titleVersion) titleVersion.textContent = version;
    buildVarMenu();
  }

  // --- Status indicator ---
  let statusTimer = null;
  function showStatus(msg) {
    refs.status.textContent = msg;
    refs.status.style.opacity = "1";
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      refs.status.style.opacity = "0";
      setTimeout(() => (refs.status.textContent = ""), 300);
    }, 2000);
  }

  // --- In-page dialog (replaces window.alert/confirm/prompt: consistent with
  //     the import modal, keyboard-friendly, and never suppressed by the
  //     browser's "block additional dialogs" heuristics) ---
  let dlgResolve = null;
  /**
   * @param {{title?:string, message:string, input?:boolean, placeholder?:string, value?:string, okKey?:string, cancel?:boolean, danger?:boolean}} o
   * @returns {Promise<string|boolean|null>} prompt → string|null; confirm → boolean; alert → true
   */
  function dialog(o) {
    return new Promise((resolve) => {
      dlgResolve = resolve;
      refs.dlgTitle.textContent = o.title || "";
      refs.dlgTitle.hidden = !o.title;
      refs.dlgMsg.textContent = o.message;
      refs.dlgInput.hidden = !o.input;
      refs.dlgInput.value = o.value || "";
      refs.dlgInput.placeholder = o.placeholder || "";
      refs.dlgCancel.hidden = o.cancel === false;
      refs.dlgOk.textContent = TL.t(o.okKey || "dlgOk");
      refs.dlgOk.classList.toggle("danger", !!o.danger);
      refs.dlgOk.classList.toggle("primary", !o.danger);
      refs.dlg.classList.add("visible");
      (o.input ? refs.dlgInput : refs.dlgOk).focus();
      if (o.input && o.value) refs.dlgInput.select();
    });
  }
  function closeDialog(result) {
    refs.dlg.classList.remove("visible");
    const r = dlgResolve; dlgResolve = null;
    if (r) r(result);
  }
  const tlAlert = (message) => dialog({ message, cancel: false });
  const tlConfirm = (message, danger = false) => dialog({ message, danger }).then((r) => r === true);
  const tlPrompt = (message, placeholder, value) =>
    dialog({ message, input: true, placeholder, value }).then((r) => (r === true ? refs.dlgInput.value : null));
  refs.dlgOk.addEventListener("click", () => closeDialog(true));
  refs.dlgCancel.addEventListener("click", () => closeDialog(null));
  refs.dlg.addEventListener("click", (e) => { if (e.target === refs.dlg) closeDialog(null); });
  refs.dlgInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); closeDialog(true); } });

  // --- Persistence ---
  const save = TL.debounce(async () => {
    try {
      lastWriteSig = sig(await TL.setTemplates(templates));
      showStatus(TL.t("statusSaved"));
    } catch (err) {
      console.error("[YAZIT] Save failed:", err);
      showStatus(TL.t("statusError"));
    }
  }, 400);

  async function saveNow() {
    try {
      lastWriteSig = sig(await TL.setTemplates(templates));
      templates = await TL.getTemplates(); // re-read to pick up stamped ids/order
      showStatus(TL.t("statusSaved"));
    } catch (err) {
      // Storage refused the write (quota). The in-memory list already holds
      // the mutation; fall back to what is actually persisted so the UI never
      // shows state that doesn't exist on disk. Callers render() after us.
      console.error("[YAZIT] Save failed:", err);
      try { templates = await TL.getTemplates(); } catch (_) { /* keep what we have */ }
      for (const id of Array.from(selectedIds)) {
        if (!templates.some((t) => t.id === id)) selectedIds.delete(id);
      }
      showStatus(TL.t("statusError"));
    }
  }

  // --- Selection bar ---
  function updateSelectionBar() {
    const count = selectedIds.size;
    if (count > 0) {
      refs.selectionBar.classList.add("visible");
      refs.selectionCount.textContent = TL.t("selectedCount", [String(count)]);
    } else {
      refs.selectionBar.classList.remove("visible");
    }
  }

  // --- Build one card (DOM API, CSP-safe) ---
  function buildTemplateCard(tpl, i, total) {
    const card = document.createElement("div");
    card.className = "template" + (selectedIds.has(tpl.id) ? " selected" : "");
    card.dataset.idx = String(i);
    card.dataset.id = tpl.id;
    // NOTE: the card itself is NOT draggable — a draggable container blocks
    // mouse text-selection/caret placement inside the rich-text editor. Only
    // the drag handle is draggable (standard drag-handle pattern).

    const header = document.createElement("div");
    header.className = "template-header";

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "⠿";
    handle.title = TL.t("dragHint");
    handle.draggable = true;
    header.appendChild(handle);

    const expander = document.createElement("button");
    expander.type = "button";
    expander.className = "expander";
    expander.dataset.action = "toggle";
    expander.dataset.idx = String(i);
    expander.textContent = "\u25B6";
    header.appendChild(expander);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.select = tpl.id;
    checkbox.checked = selectedIds.has(tpl.id);
    checkbox.setAttribute("aria-label", `Select ${tpl.name || i + 1}`);
    header.appendChild(checkbox);

    const star = document.createElement("button");
    star.type = "button";
    star.className = "star-btn";
    star.dataset.action = "favorite";
    star.dataset.idx = String(i);
    setStar(star, !!tpl.favorite);
    header.appendChild(star);

    const nameSpan = document.createElement("span");
    nameSpan.className = "template-name-inline";
    nameSpan.textContent = tpl.name || "";
    header.appendChild(nameSpan);

    // Collapsed-row summary: /shortcut and folder, kept live by updateCardChips.
    const chips = document.createElement("span");
    chips.className = "tpl-chips";
    const scChip = document.createElement("span");
    scChip.className = "chip sc";
    const fdChip = document.createElement("span");
    fdChip.className = "chip fd";
    chips.append(scChip, fdChip);
    header.appendChild(chips);

    const indexSpan = document.createElement("span");
    indexSpan.className = "index-label";
    indexSpan.textContent = "#" + (i + 1);
    if (i < 3 && slotKeys[i]) {
      const kbd = document.createElement("kbd");
      kbd.className = "slot";
      kbd.textContent = slotKeys[i];
      kbd.title = TL.t("indexLabel", [String(i + 1)]) + TL.t("shortcutLabel", [slotKeys[i]]);
      indexSpan.appendChild(kbd);
    }
    header.appendChild(indexSpan);

    const exportBtn = document.createElement("button");
    exportBtn.className = "small";
    exportBtn.dataset.action = "export-one";
    exportBtn.dataset.idx = String(i);
    exportBtn.title = TL.t("exportSingleTooltip");
    exportBtn.textContent = TL.t("btnExportOne");
    header.appendChild(exportBtn);
    card.appendChild(header);

    // Everything below the header folds away when the card is collapsed.
    const content = document.createElement("div");
    content.className = "template-content";
    content.id = "tc-" + tpl.id;
    expander.setAttribute("aria-controls", content.id);

    // Name + Shortcut row
    const row = document.createElement("div");
    row.className = "row";
    row.appendChild(labeledInput(TL.t("labelName"), "name", i, tpl.name || "", TL.LIMITS.MAX_NAME));
    row.appendChild(labeledInput(TL.t("labelShortcut"), "shortcut", i, tpl.shortcut || "", TL.LIMITS.MAX_SHORTCUT));
    content.appendChild(row);

    // Folder + search keywords (tags)
    const groupRow = document.createElement("div");
    groupRow.className = "row";
    const folderWrap = document.createElement("div");
    folderWrap.className = "folder-field";
    const folderLabel = document.createElement("label");
    folderLabel.textContent = TL.t("labelFolder");
    const folderSelect = document.createElement("select");
    folderSelect.dataset.folderSelect = "";
    folderSelect.dataset.idx = String(i);
    fillFolderSelect(folderSelect, tpl);
    folderWrap.append(folderLabel, folderSelect);
    const tagsWrap = document.createElement("div");
    const tagsLabel = document.createElement("label");
    tagsLabel.textContent = TL.t("labelTags");
    const tagsInput = document.createElement("input");
    tagsInput.className = "tag-input";
    tagsInput.dataset.field = "tags";
    tagsInput.dataset.idx = String(i);
    tagsInput.placeholder = TL.t("tagsPlaceholder");
    tagsInput.value = (tpl.tags || []).join(", ");
    tagsWrap.appendChild(tagsLabel);
    tagsWrap.appendChild(tagsInput);
    groupRow.append(folderWrap, tagsWrap);
    content.appendChild(groupRow);

    // Body (plain textarea or rich-text editor) + field-builder panel
    content.appendChild(buildBodySection(tpl, i));

    // Actions
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.appendChild(actionBtn("up", i, TL.t("btnUp"), i === 0));
    actions.appendChild(actionBtn("down", i, TL.t("btnDown"), i === total - 1));
    // TL.clearLastValues has existed since remembering did; until now nothing
    // called it except deleting the whole template, so a value remembered by
    // mistake could only be removed by throwing the template away with it.
    // Only shown where it can do something: a template with no remembered
    // field has nothing to forget, and an action that never does anything
    // teaches people to ignore the row it sits in. refreshForgetBtn keeps it
    // in step when the Fields panel toggles Remember.
    const forgetBtn = actionBtn("forget", i, TL.t("forgetRemembered"), false);
    forgetBtn.dataset.forget = "";
    actions.appendChild(forgetBtn);
    const delBtn = actionBtn("delete", i, TL.t("btnDelete"), false);
    delBtn.classList.add("danger");
    actions.appendChild(delBtn);
    content.appendChild(actions);
    card.appendChild(content);

    applyExpanded(card, expanded.has(tpl.id));
    updateCardChips(card, tpl);
    refreshForgetBtn(card, tpl);
    return card;
  }

  /** Show "Forget remembered values" only while the body declares one. */
  function refreshForgetBtn(card, tpl) {
    const btn = card && card.querySelector("button[data-forget]");
    if (!btn || !tpl) return;
    btn.hidden = !TL.parseFields(tpl.body || "").some((f) => f.remember);
  }

  // --- Collapse / expand ---
  function applyExpanded(card, on) {
    card.classList.toggle("collapsed", !on);
    const b = card.querySelector('button[data-action="toggle"]');
    if (b) {
      b.setAttribute("aria-expanded", String(on));
      b.title = TL.t(on ? "collapse" : "expand");
      b.setAttribute("aria-label", b.title);
    }
  }
  /** One card, without touching the toolbar label — see setExpanded. */
  function setExpandedOne(card, on) {
    if (!card || !card.dataset.id) return;
    if (on) expanded.add(card.dataset.id); else expanded.delete(card.dataset.id);
    applyExpanded(card, on);
  }
  function setExpanded(card, on) {
    setExpandedOne(card, on);
    updateToggleAllLabel();
  }
  const visibleCards = () => /** @type {HTMLElement[]} */ (Array.from(refs.templates.querySelectorAll(".template")))
    .filter((c) => c.style.display !== "none");
  /** "Expand all" while anything on screen is folded, otherwise "Collapse all". */
  function updateToggleAllLabel() {
    const cards = visibleCards();
    refs.toggleAll.hidden = cards.length < 2;
    const anyClosed = cards.some((c) => c.classList.contains("collapsed"));
    refs.toggleAll.textContent = TL.t(anyClosed ? "expandAll" : "collapseAll");
    refs.toggleAll.dataset.mode = anyClosed ? "expand" : "collapse";
  }
  refs.toggleAll.addEventListener("click", () => {
    const open = refs.toggleAll.dataset.mode === "expand";
    // Label once, after the loop: updateToggleAllLabel re-queries every card,
    // so refreshing it per card made "expand all" quadratic in the list length.
    for (const c of visibleCards()) setExpandedOne(c, open);
    updateToggleAllLabel();
  });

  /** Refresh a card's header chips (shortcut + folder) from its template. */
  function updateCardChips(card, tpl) {
    if (!card || !tpl) return;
    const sc = /** @type {HTMLElement|null} */ (card.querySelector(".chip.sc"));
    const fd = /** @type {HTMLElement|null} */ (card.querySelector(".chip.fd"));
    if (sc) { sc.textContent = tpl.shortcut ? "/" + tpl.shortcut : ""; sc.hidden = !tpl.shortcut; }
    if (fd) {
      const f = folders.find((x) => x.id === TL.folderOf(tpl, folderIdSet()));
      fd.textContent = f ? f.name : "";
      fd.hidden = !f;
      if (f) fd.dataset.fc = String(folderDerived().slots.get(f.id) ?? 0);
      else delete fd.dataset.fc;
      fd.title = f ? TL.t("labelFolder") + ": " + f.name : "";
    }
  }
  const cardAt = (idx) => /** @type {HTMLElement|null} */ (refs.templates.querySelector('.template[data-idx="' + idx + '"]'));

  function setStar(btn, on) {
    btn.textContent = on ? "★" : "☆";
    btn.setAttribute("aria-pressed", String(on));
    btn.title = TL.t(on ? "favoriteRemove" : "favoriteAdd");
    btn.setAttribute("aria-label", btn.title);
  }

  const NEW_FOLDER = "__new__";
  function fillFolderSelect(select, tpl) {
    const ids = folderIdSet();
    const opt = (value, text) => { const o = document.createElement("option"); o.value = value; o.textContent = text; return o; };
    const frag = document.createDocumentFragment();
    frag.appendChild(opt("", TL.t("folderNone")));
    for (const f of folders) frag.appendChild(opt(f.id, f.name));
    if (folders.length < TL.LIMITS.MAX_FOLDERS) frag.appendChild(opt(NEW_FOLDER, TL.t("folderNewOption")));
    select.replaceChildren(frag);
    select.value = TL.folderOf(tpl, ids);
  }
  /** Folder list changed (create/rename/delete/external) — patch the selects
   *  in place instead of render(): a rebuild would drop editor focus/caret. */
  function refreshFolderSelects() {
    refs.templates.querySelectorAll("select[data-folder-select]").forEach((sel) => {
      const tpl = templates[Number(/** @type {any} */ (sel).dataset.idx)];
      if (tpl) fillFolderSelect(sel, tpl);
    });
    // A rename changes the folder chip text too.
    refs.templates.querySelectorAll(".template").forEach((card) => {
      updateCardChips(/** @type {HTMLElement} */ (card), templates[Number(/** @type {any} */ (card).dataset.idx)]);
    });
  }

  function labeledInput(labelText, field, idx, value, maxLen) {
    const wrap = document.createElement("div");
    const label = document.createElement("label");
    label.textContent = labelText;
    const input = document.createElement("input");
    input.dataset.field = field;
    input.dataset.idx = String(idx);
    input.value = value;
    input.maxLength = maxLen;
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  function actionBtn(action, idx, text, disabled) {
    const btn = document.createElement("button");
    btn.dataset.action = action;
    btn.dataset.idx = String(idx);
    btn.disabled = disabled;
    btn.textContent = text;
    return btn;
  }

  // Rich editors whose content has changed since it was last stored (their
  // debounced store is still pending). flushPendingEdits walks THIS set, not
  // every editor on the page: storeRichBody costs a full DOMParser pass plus a
  // highlight rebuild, and the flush runs on every visibilitychange — i.e. on
  // every tab switch, not just on unload.
  const pendingRichEdits = new Set();

  // Sanitize + clamp the rich editor's content into the in-memory body and
  // refresh the char-count. Re-sanitizing a clamped slice repairs a mid-tag cut
  // so the in-memory body (used for exports) is always well-formed. Used by the
  // editor input, the toolbar commands and the insert-variable menu.
  function storeRichBody(i, editor) {
    pendingRichEdits.delete(editor);
    let b = TL.sanitizeHtml(editor.innerHTML);
    if (b.length > TL.LIMITS.MAX_BODY) b = TL.sanitizeHtml(b.slice(0, TL.LIMITS.MAX_BODY));
    templates[i].body = b;
    const card = editor.closest(".template");
    const count = card && card.querySelector(".char-count");
    if (count) count.textContent = b.length + " / " + TL.LIMITS.MAX_BODY;
    if (card) updateCondWarn(card, b);
    highlightPlaceholders(editor);
    save();
  }

  // Painting a rich card costs TWO DOMParser passes over the same string:
  // sanitizeHtml (defence in depth — storage is already sanitized, but render
  // does not take that on trust) and then htmlToFragment. render() is
  // structural, so a reorder/delete/import pays that for every card: measured
  // ~230ms of parsing alone at MAX_TEMPLATES rich templates.
  // Memoizing the sanitize on the exact body string removes one pass per card
  // without dropping the check. The key IS the input, and sanitizeHtml is
  // deterministic and idempotent, so the entry can never be stale — a miss is
  // simply today's behaviour. Bounded to one entry per template.
  const sanitizedBodyCache = new Map();
  function sanitizedBody(body) {
    const src = body || "";
    let out = sanitizedBodyCache.get(src);
    if (out === undefined) {
      out = TL.sanitizeHtml(src);
      if (sanitizedBodyCache.size >= TL.LIMITS.MAX_TEMPLATES) sanitizedBodyCache.clear();
      sanitizedBodyCache.set(src, out);
    }
    return out;
  }

  // ---- {{placeholder}} colouring ----
  // Every field gets its own colour (TL.placeholderSlots: stable per name,
  // unique within a template); condition markers and dynamic variables get
  // one shared colour each. The same key drives both editors and the Fields
  // panel, so a field looks the same everywhere on the page.
  const PH_KEYS = [...Array(TL.PH_SLOTS).keys()].map(String).concat(["ctl", "dyn"]);
  const PH_RE = /\{\{([^{}]+)\}\}/g;

  // Rich editor: CSS Custom Highlight API, one named highlight per key. Pure
  // paint — no DOM mutation, so the stored body is never touched. Silently a
  // no-op on engines without CSS.highlights.
  const hlRanges = new WeakMap(); // editor → [key, Range][]
  const hlSupported = typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight === "function";
  /** @type {Map<string, Highlight>|null} */
  const hlSets = hlSupported ? new Map(PH_KEYS.map((k) => {
    const h = new Highlight();
    CSS.highlights.set("tl-ph-" + k, h);
    return [k, h];
  })) : null;
  function highlightPlaceholders(editor) {
    if (!hlSupported) return;
    for (const [k, r] of hlRanges.get(editor) || []) hlSets.get(k).delete(r);
    const slots = TL.placeholderSlots(editor.textContent || "");
    const next = [];
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      let m;
      PH_RE.lastIndex = 0;
      while ((m = PH_RE.exec(node.nodeValue)) !== null) {
        const r = new Range();
        r.setStart(node, m.index);
        r.setEnd(node, m.index + m[0].length);
        const k = TL.placeholderKey(m[1], slots);
        next.push([k, r]);
        hlSets.get(k).add(r);
      }
    }
    hlRanges.set(editor, next);
  }
  function clearAllHighlights() {
    if (hlSupported) for (const h of hlSets.values()) h.clear();
  }

  // Plain editor: a textarea can't colour its own text, so a mirror layer
  // (.ph-backdrop) sits behind the transparent textarea and paints the tokens
  // as tinted marks at exactly the same positions.
  const plainPainters = new WeakMap(); // textarea → repaint()
  function attachPlainColors(ta) {
    const wrap = document.createElement("div");
    wrap.className = "ph-wrap";
    const backdrop = document.createElement("div");
    backdrop.className = "ph-backdrop";
    backdrop.setAttribute("aria-hidden", "true");
    wrap.append(backdrop, ta);

    let frame = 0;
    const syncBox = () => {
      // The textarea's scrollbar narrows its text column; the mirror has
      // none, so it gets the same width back as padding or lines wrap apart.
      const sb = Math.max(0, ta.offsetWidth - ta.clientWidth - 2);
      backdrop.style.paddingRight = 10 + sb + "px";
      backdrop.scrollTop = ta.scrollTop;
    };
    const paint = () => {
      frame = 0;
      const text = ta.value;
      const slots = TL.placeholderSlots(text);
      const frag = document.createDocumentFragment();
      let last = 0;
      let m;
      PH_RE.lastIndex = 0;
      while ((m = PH_RE.exec(text)) !== null) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const mark = document.createElement("mark");
        mark.className = "ph-" + TL.placeholderKey(m[1], slots);
        mark.textContent = m[0];
        frag.appendChild(mark);
        last = m.index + m[0].length;
      }
      // A trailing newline has no line box of its own in a div; keep one.
      frag.appendChild(document.createTextNode(text.slice(last) + (text.endsWith("\n") ? " " : "")));
      backdrop.replaceChildren(frag);
      syncBox();
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
    ta.addEventListener("input", schedule);
    ta.addEventListener("scroll", () => { backdrop.scrollTop = ta.scrollTop; });
    if (typeof ResizeObserver === "function") new ResizeObserver(syncBox).observe(ta);
    plainPainters.set(ta, paint);
    paint();
    return wrap;
  }
  /** Repaint after a programmatic ta.value change (no input event fires). */
  const repaintPlain = (ta) => { const p = ta && plainPainters.get(ta); if (p) p(); };

  // ============================================================
  // Body section: plain/rich toggle, rich-text editor, field-builder
  // ============================================================
  function buildBodySection(tpl, i) {
    const wrap = document.createElement("div");
    const isHtml = tpl.format === "html";

    // Head: label + plain/rich toggle + fields toggle
    const head = document.createElement("div");
    head.className = "body-head";
    const bodyLabel = document.createElement("label");
    bodyLabel.textContent = TL.t("labelBody");
    head.appendChild(bodyLabel);

    const fieldsBtn = document.createElement("button");
    fieldsBtn.type = "button";
    fieldsBtn.className = "fields-toggle";
    fieldsBtn.textContent = "{ } " + TL.t("fieldsToggle");
    fieldsBtn.setAttribute("aria-expanded", "false");
    head.appendChild(fieldsBtn);

    const condBtn = document.createElement("button");
    condBtn.type = "button";
    condBtn.className = "fields-toggle";
    condBtn.textContent = "{ if } " + TL.t("condToggle");
    condBtn.title = TL.t("condTooltip");
    condBtn.setAttribute("aria-expanded", "false");
    // Keep the editor's selection alive: it is what gets wrapped.
    condBtn.addEventListener("mousedown", (e) => e.preventDefault());
    head.appendChild(condBtn);

    const toggle = document.createElement("div");
    toggle.className = "fmt-toggle";
    const plainBtn = document.createElement("button");
    plainBtn.type = "button";
    plainBtn.textContent = TL.t("formatPlain");
    plainBtn.className = isHtml ? "" : "active";
    const richBtn = document.createElement("button");
    richBtn.type = "button";
    richBtn.textContent = TL.t("formatRich");
    richBtn.className = isHtml ? "active" : "";
    toggle.append(plainBtn, richBtn);
    head.appendChild(toggle);
    wrap.appendChild(head);

    plainBtn.addEventListener("click", () => setFormat(i, "text"));
    richBtn.addEventListener("click", () => setFormat(i, "html"));

    // Editor surface
    if (isHtml) {
      wrap.appendChild(buildRichToolbar(i));
      const editor = document.createElement("div");
      editor.className = "rich-editor";
      editor.contentEditable = "true";
      editor.setAttribute("role", "textbox");
      editor.setAttribute("aria-multiline", "true");
      editor.setAttribute("aria-label", TL.t("labelBody"));
      editor.dataset.idx = String(i);
      editor.dataset.richEditor = "1";
      // Body is stored sanitized; re-sanitize and insert as DOM nodes (no innerHTML).
      editor.replaceChildren(TL.htmlToFragment(sanitizedBody(tpl.body)));
      // Highlighted by render() once the card is in the document: a live
      // Range over nodes still inside a fragment collapses when they move.
      editor.addEventListener("focus", () => {
        lastFocusedBody = editor;
        // Make Enter produce <p> (allowed) rather than a bare <div> (which the
        // sanitizer unwraps, losing the line break). defaultParagraphSeparator
        // is editing-context state, so it must be set while an editable region
        // is focused — on a detached, unfocused node it isn't guaranteed to
        // stick. Idempotent and cheap, so simply re-assert per focus.
        TL.editorAdapter.setParagraphSeparator("p");
      });
      // Per-editor debounce: each keystroke would otherwise run sanitizeHtml
      // (DOMParser) on the full body. On input we update the char-count cheaply
      // and defer the sanitize+store to the debounced call; persistence is
      // debounced again inside storeRichBody (save()).
      const debouncedStore = TL.debounce(() => storeRichBody(i, editor), 300);
      // Per-keystroke work stays O(1): serializing editor.innerHTML on every
      // input just to refresh the counter costs a full-body serialization per
      // key on large bodies. storeRichBody (debounced 300ms) updates the
      // char-count anyway, so the counter lags at most one debounce window.
      editor.addEventListener("input", () => { pendingRichEdits.add(editor); debouncedStore(); });
      // Blur = leaving the editor (incl. clicking add/delete/reorder, which
      // would otherwise render() from a stale body within the debounce window).
      // Store synchronously and drop the now-redundant pending debounced call.
      editor.addEventListener("blur", () => { debouncedStore.cancel(); storeRichBody(i, editor); });
      // Paste into the editor: sanitize clipboard HTML before it lands.
      editor.addEventListener("paste", (e) => {
        e.preventDefault();
        // Clamped BEFORE sanitizing, not after. MAX_BODY is applied in
        // storeRichBody, i.e. downstream of sanitizeHtml + tidyHtml, so an
        // unbounded clipboard payload paid for both passes first: tidyHtml's
        // empty-shell loop is quadratic in nesting depth (measured 2.7s on a
        // 140 KB ladder of nested <b>). 2x MAX_BODY leaves room for markup
        // around text that will still fit once tags are stripped.
        const CLIP_CAP = TL.LIMITS.MAX_BODY * 2;
        const html = e.clipboardData.getData("text/html").slice(0, CLIP_CAP);
        const text = e.clipboardData.getData("text/plain").slice(0, CLIP_CAP);
        // Clipboard HTML (Word / Outlook / Docs) is sanitized, then tidied so
        // nbsp ladders and empty paragraphs don't land in the template.
        const safe = html ? TL.tidyHtml(TL.sanitizeHtml(html)) : TL.escapeHtml(text).replace(/\n/g, "<br>");
        TL.editorAdapter.insertHtml(safe);
      });
      wrap.appendChild(editor);
    } else {
      const bodyArea = document.createElement("textarea");
      bodyArea.dataset.field = "body";
      bodyArea.dataset.idx = String(i);
      bodyArea.maxLength = TL.LIMITS.MAX_BODY;
      bodyArea.value = tpl.body || "";
      bodyArea.addEventListener("focus", () => { lastFocusedBody = bodyArea; });
      bodyArea.addEventListener("input", () => {
        count.textContent = bodyArea.value.length + " / " + TL.LIMITS.MAX_BODY;
        updateCondWarn(wrap, bodyArea.value);
      });
      wrap.appendChild(attachPlainColors(bodyArea));
    }

    const count = document.createElement("div");
    count.className = "char-count";
    count.textContent = (tpl.body || "").length + " / " + TL.LIMITS.MAX_BODY;
    wrap.appendChild(count);

    // Field-builder panel (collapsible)
    const panel = document.createElement("div");
    panel.className = "fields-panel";
    panel.dataset.idx = String(i);
    wrap.appendChild(panel);
    fieldsBtn.addEventListener("click", () => {
      const open = panel.classList.toggle("open");
      fieldsBtn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) renderFieldsPanel(panel, i);
    });

    // {{#if}} structure problems, in words (hidden while the body is sound).
    const warn = document.createElement("div");
    warn.className = "cond-warn";
    warn.setAttribute("role", "status");
    warn.hidden = true;
    wrap.insertBefore(warn, panel);

    // Condition builder panel (collapsible)
    const condPanel = document.createElement("div");
    condPanel.className = "cond-panel";
    wrap.appendChild(condPanel);
    const closeCond = () => {
      condPanel.classList.remove("open");
      condPanel.replaceChildren();
      condBtn.setAttribute("aria-expanded", "false");
    };
    condBtn.addEventListener("click", () => {
      if (condPanel.classList.contains("open")) { closeCond(); return; }
      condPanel.classList.add("open");
      condBtn.setAttribute("aria-expanded", "true");
      renderCondPanel(condPanel, i, wrap, captureBodySelection(wrap), closeCond);
    });

    updateCondWarn(wrap, tpl.body || "");
    return wrap;
  }

  // ============================================================
  // Condition builder — writes {{#if name}} / {{#if name=value}} … {{/if}}
  // around the selected text, so nobody has to learn the marker syntax.
  // ============================================================
  /** @param {ParentNode} scope @param {string} body */
  function updateCondWarn(scope, body) {
    const w = /** @type {HTMLElement|null} */ (scope && scope.querySelector(".cond-warn"));
    if (!w) return;
    const problem = TL.checkConditionals(body || "");
    w.hidden = !problem;
    w.textContent = problem ? TL.t("condWarn_" + problem.code, [problem.name || ""]) : "";
  }

  /**
   * Snapshot the body's selection before the panel's inputs steal focus.
   * Only a selection that is really inside THIS body counts; otherwise the
   * markers go at the end.
   */
  function captureBodySelection(wrap) {
    const editor = wrap.querySelector("[data-rich-editor]");
    if (editor) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0);
        if (editor.contains(r.commonAncestorContainer)) return { range: r.cloneRange(), hasText: !r.collapsed };
      }
      return null;
    }
    const ta = /** @type {HTMLTextAreaElement|null} */ (wrap.querySelector('textarea[data-field="body"]'));
    if (ta && (document.activeElement === ta || lastFocusedBody === ta)) {
      return { start: ta.selectionStart, end: ta.selectionEnd, hasText: ta.selectionEnd > ta.selectionStart };
    }
    return null;
  }

  function renderCondPanel(panel, i, wrap, cap, close) {
    panel.replaceChildren();
    const fields = TL.parseFields(templates[i]?.body || "");
    const uid = "c" + Math.random().toString(36).slice(2, 8);

    const intro = document.createElement("p");
    intro.className = "cond-intro";
    intro.textContent = TL.t(cap && cap.hasText ? "condIntroSel" : "condIntro");
    panel.appendChild(intro);

    const grid = document.createElement("div");
    grid.className = "cond-grid";

    const nameLabel = document.createElement("label");
    nameLabel.textContent = TL.t("condField");
    nameLabel.htmlFor = uid + "-n";
    const nameIn = mkInput("", TL.t("condFieldPh"));
    nameIn.id = uid + "-n";
    const nameList = document.createElement("datalist");
    nameList.id = uid + "-nl";
    for (const f of fields) { const o = document.createElement("option"); o.value = f.name; nameList.appendChild(o); }
    nameIn.setAttribute("list", nameList.id);
    grid.append(nameLabel, nameIn);

    const whenLabel = document.createElement("label");
    whenLabel.textContent = TL.t("condWhen");
    const mode = document.createElement("div");
    mode.className = "cond-mode";
    const mkRadio = (value, checked) => {
      const r = document.createElement("input");
      r.type = "radio"; r.name = uid + "-m"; r.value = value; r.checked = checked;
      return r;
    };
    const rTruthy = mkRadio("truthy", true);
    const lTruthy = document.createElement("label");
    lTruthy.append(rTruthy, document.createTextNode(TL.t("condModeTruthy")));
    const rEq = mkRadio("equals", false);
    const lEq = document.createElement("label");
    lEq.className = "cond-eq";
    const valIn = mkInput("", TL.t("condValuePh"));
    const valList = document.createElement("datalist");
    valList.id = uid + "-vl";
    valIn.setAttribute("list", valList.id);
    lEq.append(rEq, document.createTextNode(TL.t("condModeEquals")), valIn);
    mode.append(lTruthy, lEq);
    grid.append(whenLabel, mode);
    panel.append(grid, nameList, valList);

    const elseLabel = document.createElement("label");
    elseLabel.className = "cond-else";
    const elseCb = document.createElement("input");
    elseCb.type = "checkbox";
    elseLabel.append(elseCb, document.createTextNode(TL.t("condElse")));
    panel.appendChild(elseLabel);

    const preview = document.createElement("div");
    preview.className = "cond-preview";
    panel.appendChild(preview);

    const refresh = () => {
      // A dropdown field offers its options as values.
      const f = fields.find((x) => x.name === nameIn.value.trim());
      valList.replaceChildren(...((f && f.options) || []).filter((o) => o !== "*").map((o) => {
        const opt = document.createElement("option"); opt.value = o; return opt;
      }));
      const spec = TL.buildCondition({ name: nameIn.value, equals: rEq.checked ? valIn.value : undefined });
      const inner = cap && cap.hasText ? TL.t("condSelectedText") : "…";
      preview.textContent = spec
        ? spec.open + inner + (elseCb.checked ? spec.otherwise + "…" : "") + spec.close
        : TL.t("condNeedName");
    };
    valIn.addEventListener("focus", () => { rEq.checked = true; refresh(); });
    for (const el of [nameIn, valIn]) el.addEventListener("input", () => { el.classList.remove("invalid"); refresh(); });
    for (const el of [rTruthy, rEq, elseCb]) el.addEventListener("change", refresh);
    refresh();

    const actions = document.createElement("div");
    actions.className = "cond-actions";
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.className = "small"; cancel.textContent = TL.t("importCancel");
    cancel.addEventListener("click", close);
    const ok = document.createElement("button");
    ok.type = "button"; ok.className = "small primary"; ok.textContent = TL.t("condInsert");
    ok.addEventListener("click", () => {
      const spec = TL.buildCondition({ name: nameIn.value, equals: rEq.checked ? valIn.value : undefined });
      if (!spec) { nameIn.classList.add("invalid"); nameIn.focus(); return; }
      if (rEq.checked && !valIn.value.replace(/[{}|]+/g, "").trim()) { valIn.classList.add("invalid"); valIn.focus(); return; }
      if (insertCondition(i, wrap, spec, elseCb.checked, cap)) close();
    });
    actions.append(cancel, ok);
    panel.appendChild(actions);

    // Assigned, not added: the panel element is reused on every open.
    panel.onkeydown = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key === "Enter" && /** @type {any} */ (e.target).tagName === "INPUT" && /** @type {any} */ (e.target).type === "text") {
        e.preventDefault(); ok.click();
      }
    };
    nameIn.focus();
  }

  /** @returns {boolean} true when the markers were written */
  function insertCondition(i, wrap, spec, withElse, cap) {
    if (!templates[i]) return false;
    const mid = withElse ? spec.otherwise : "";
    const added = spec.open.length + mid.length + spec.close.length;
    if ((templates[i].body || "").length + added > TL.LIMITS.MAX_BODY) { showStatus(TL.t("condTooLong")); return false; }

    const editor = /** @type {HTMLElement|null} */ (wrap.querySelector("[data-rich-editor]"));
    if (editor) {
      let r = cap && cap.range;
      if (!r || !editor.contains(r.commonAncestorContainer)) {
        r = document.createRange();
        r.selectNodeContents(editor);
        r.collapse(false);
      }
      // Two text nodes at the range's ends: formatting inside the selection
      // (bold, lists, links) stays exactly as it was.
      const startR = r.cloneRange(); startR.collapse(true);
      const endR = r.cloneRange(); endR.collapse(false);
      const hadText = !r.collapsed;
      const head = document.createTextNode(spec.open);
      const tail = document.createTextNode(mid + spec.close);
      endR.insertNode(tail);   // end first: inserting at the start would shift it
      startR.insertNode(head);
      editor.focus();
      const caret = document.createRange();
      if (!hadText) caret.setStartAfter(head);
      else if (withElse) caret.setStart(tail, mid.length);
      else caret.setStartAfter(tail);
      caret.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(caret);
      storeRichBody(i, editor);
    } else {
      const ta = /** @type {HTMLTextAreaElement|null} */ (wrap.querySelector('textarea[data-field="body"]'));
      if (!ta) return false;
      const v = ta.value;
      const s0 = cap && typeof cap.start === "number" ? cap.start : v.length;
      const e0 = cap && typeof cap.end === "number" ? cap.end : v.length;
      const inner = v.slice(s0, e0);
      const text = spec.open + inner + mid + spec.close;
      ta.value = v.slice(0, s0) + text + v.slice(e0);
      templates[i].body = ta.value;
      repaintPlain(ta);
      const caretPos = !inner ? s0 + spec.open.length
        : withElse ? s0 + spec.open.length + inner.length + mid.length
        : s0 + text.length;
      ta.focus();
      ta.setSelectionRange(caretPos, caretPos);
      const count = wrap.querySelector(".char-count");
      if (count) count.textContent = ta.value.length + " / " + TL.LIMITS.MAX_BODY;
      updateCondWarn(wrap, ta.value);
      save();
    }
    // A new {{#if name}} can create a checkbox field — keep the Fields panel honest.
    const fp = /** @type {HTMLElement|null} */ (wrap.querySelector(".fields-panel.open"));
    if (fp) renderFieldsPanel(fp, i);
    return true;
  }

  function buildRichToolbar(i) {
    const bar = document.createElement("div");
    bar.className = "rt-toolbar";
    const persist = () => {
      const editor = bar.parentElement.querySelector("[data-rich-editor]");
      if (editor) storeRichBody(i, editor);
    };
    const groups = [
      [
        { label: "B", key: "tbBold", style: "font-weight:700", run: () => TL.editorAdapter.exec("bold") },
        { label: "I", key: "tbItalic", style: "font-style:italic", run: () => TL.editorAdapter.exec("italic") },
        { label: "U", key: "tbUnderline", style: "text-decoration:underline", run: () => TL.editorAdapter.exec("underline") },
        { label: "S", key: "tbStrike", style: "text-decoration:line-through", run: () => TL.editorAdapter.exec("strikeThrough") },
      ],
      [
        { label: "H2", key: "tbH2", style: "", run: () => toggleBlock("h2") },
        { label: "H3", key: "tbH3", style: "", run: () => toggleBlock("h3") },
        { label: "\u2630", key: "tbList", style: "", run: () => TL.editorAdapter.exec("insertUnorderedList") },
        { label: "1.", key: "tbOList", style: "", run: () => TL.editorAdapter.exec("insertOrderedList") },
      ],
      [
        { label: "</>", key: "tbCode", style: "font-family:ui-monospace,monospace", run: () => wrapInlineCode() },
        { label: "\u00b6", key: "tbPre", style: "font-family:ui-monospace,monospace", run: () => toggleBlock("pre") },
        { label: "\u229e", key: "tbTable", style: "", run: (btn) => openTablePopover(btn, persist) },
        { label: "\u{1F517}", key: "tbLink", style: "", run: (btn) => openLinkPopover(btn, persist) },
      ],
    ];
    groups.forEach((group, gi) => {
      if (gi > 0) { const sep = document.createElement("span"); sep.className = "rt-sep"; bar.appendChild(sep); }
      for (const c of group) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = c.label;
        if (c.style) btn.style.cssText = c.style;
        btn.title = TL.t(c.key);
        btn.setAttribute("aria-label", TL.t(c.key));
        btn.addEventListener("mousedown", (e) => e.preventDefault()); // keep editor selection
        btn.addEventListener("click", () => {
          const r = c.run(btn);
          if (r !== false) persist(); // popovers persist on their own confirm
        });
        bar.appendChild(btn);
      }
    });
    return bar;
  }

  // --- Rich editor helpers (selection-based; all go through TL.editorAdapter) ---
  function currentBlockTag() {
    const sel = window.getSelection();
    const n = sel && sel.anchorNode;
    const el = n && (n.nodeType === 1 ? /** @type {Element} */ (n) : n.parentElement);
    const block = el && el.closest("[data-rich-editor]") && el.closest("h2,h3,pre,p,li");
    return block ? block.tagName.toLowerCase() : "";
  }
  /** Toggle a block format: apply it, or revert to <p> if already active. */
  function toggleBlock(tag) {
    const next = currentBlockTag() === tag ? "p" : tag;
    TL.editorAdapter.exec("formatBlock", "<" + next + ">");
  }
  /** Wrap the selected text in <code>. Collapsed selection → no-op. */
  function wrapInlineCode() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    const text = sel.toString();
    if (!text) return;
    TL.editorAdapter.insertHtml("<code>" + TL.escapeHtml(text) + "</code>");
  }

  // --- Popovers (link / table) — one at a time, anchored to the toolbar button.
  let popover = null;
  let savedRange = null;
  function closePopover() { if (popover) { popover.remove(); popover = null; } savedRange = null; }
  function saveSelection() {
    const sel = window.getSelection();
    savedRange = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  }
  function restoreSelection() {
    if (!savedRange) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
  function openPopover(anchorBtn, build) {
    closePopover();
    saveSelection();
    popover = document.createElement("div");
    popover.className = "rt-popover";
    popover.setAttribute("role", "dialog");
    popover.addEventListener("mousedown", (e) => e.stopPropagation());
    build(popover);
    anchorBtn.closest(".rt-toolbar").appendChild(popover);
    const first = popover.querySelector("input");
    if (first) first.focus();
    popover.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); closePopover(); }
      if (e.key === "Enter" && /** @type {any} */ (e.target).tagName === "INPUT") {
        e.preventDefault();
        popover.querySelector("button.primary")?.click();
      }
    });
    return false; // tell the toolbar not to persist yet
  }
  document.addEventListener("mousedown", (e) => {
    if (popover && !popover.contains(/** @type {any} */ (e.target))) closePopover();
  });

  function popoverRow(labelKey, input) {
    const l = document.createElement("label");
    l.textContent = TL.t(labelKey);
    l.appendChild(input);
    return l;
  }
  function popoverActions(onOk, extra) {
    const row = document.createElement("div");
    row.className = "rt-popover-actions";
    if (extra) row.appendChild(extra);
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.className = "small"; cancel.textContent = TL.t("importCancel");
    cancel.addEventListener("click", closePopover);
    const ok = document.createElement("button");
    ok.type = "button"; ok.className = "small primary"; ok.textContent = TL.t("popoverApply");
    ok.addEventListener("click", onOk);
    row.append(cancel, ok);
    return row;
  }

  function openLinkPopover(btn, persist) {
    return openPopover(btn, (pop) => {
      // Existing link under the caret → edit mode (href + text prefilled).
      const sel = window.getSelection();
      const n = sel && sel.anchorNode;
      const el = n && (n.nodeType === 1 ? /** @type {Element} */ (n) : n.parentElement);
      const inEditor = el && el.closest("[data-rich-editor]");
      const existing = /** @type {HTMLAnchorElement|null} */ (inEditor ? el.closest("a") : null);
      const url = mkInput(existing ? existing.getAttribute("href") : "https://", "https://");
      url.type = "url";
      const text = mkInput(existing ? existing.textContent : (sel ? sel.toString() : ""), TL.t("linkText"));
      pop.append(popoverRow("linkUrl", url), popoverRow("linkText", text));

      let remove = null;
      if (existing) {
        remove = document.createElement("button");
        remove.type = "button"; remove.className = "small danger"; remove.textContent = TL.t("linkRemove");
        remove.addEventListener("click", () => {
          existing.replaceWith(document.createTextNode(existing.textContent));
          closePopover(); persist();
        });
      }
      pop.appendChild(popoverActions(() => {
        const safe = TL.cleanHref(url.value);
        if (!safe) { url.classList.add("invalid"); url.focus(); return; }
        const label = text.value.trim();
        if (existing) {
          existing.setAttribute("href", safe);
          existing.setAttribute("rel", "noopener noreferrer nofollow");
          if (label) existing.textContent = label;
        } else {
          restoreSelection();
          if (savedRange && !savedRange.collapsed && !label) TL.editorAdapter.createLink(safe);
          else TL.editorAdapter.insertHtml(
            '<a href="' + TL.escapeHtml(safe) + '" rel="noopener noreferrer nofollow">' + TL.escapeHtml(label || safe) + "</a>"
          );
        }
        closePopover(); persist();
      }, remove));
    });
  }

  function openTablePopover(btn, persist) {
    return openPopover(btn, (pop) => {
      const rows = mkInput("3", "3"); rows.type = "number"; rows.min = "1"; rows.max = "20";
      const cols = mkInput("3", "3"); cols.type = "number"; cols.min = "1"; cols.max = "10";
      const header = document.createElement("input"); header.type = "checkbox"; header.checked = true;
      const headerLabel = document.createElement("label");
      headerLabel.className = "rem";
      headerLabel.append(header, document.createTextNode(TL.t("tableHeader")));
      pop.append(popoverRow("tableRows", rows), popoverRow("tableCols", cols), headerLabel);
      pop.appendChild(popoverActions(() => {
        const r = Math.min(20, Math.max(1, Number(rows.value) || 1));
        const c = Math.min(10, Math.max(1, Number(cols.value) || 1));
        let html = "<table>";
        if (header.checked) html += "<thead><tr>" + "<th>&nbsp;</th>".repeat(c) + "</tr></thead>";
        html += "<tbody>";
        for (let k = 0; k < r; k++) html += "<tr>" + "<td>&nbsp;</td>".repeat(c) + "</tr>";
        html += "</tbody></table><p><br></p>";
        restoreSelection();
        TL.editorAdapter.insertHtml(html);
        closePopover(); persist();
      }));
    });
  }

  // Switch a template between plain and rich; convert content safely.
  async function setFormat(i, fmt) {
    if (!templates[i]) return;
    const cur = templates[i].format === "html" ? "html" : "text";
    if ((fmt === "html" ? "html" : "text") === cur) return;
    if (fmt === "text") {
      if (!(await tlConfirm(TL.t("confirmToPlain"), true))) return;
      await TL.pushBackup();
      templates[i].body = TL.htmlToPlainText(templates[i].body || "");
      delete templates[i].format;
    } else {
      templates[i].format = "html";
      // Existing plain text is valid HTML content; escape it so '<' etc. survive.
      templates[i].body = TL.sanitizeHtml(TL.escapeHtml(templates[i].body || "").replace(/\n/g, "<br>"));
    }
    await saveNow();
    render();
  }

  // --- Field-builder panel ---
  function renderFieldsPanel(panel, i) {
    panel.replaceChildren();
    const fields = TL.parseFields(templates[i].body || "");
    const slots = TL.placeholderSlots(templates[i].body || "");
    if (fields.length === 0) {
      const empty = document.createElement("div");
      empty.className = "fields-empty";
      empty.textContent = TL.t("fieldsEmpty");
      panel.appendChild(empty);
    }
    for (const f of fields) panel.appendChild(buildFieldRow(f, i, slots));

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "small";
    addBtn.textContent = TL.t("fbAdd");
    addBtn.addEventListener("click", async () => {
      const raw = await tlPrompt(TL.t("fbAddPrompt"), "customer_name");
      if (!raw) return;
      const name = raw.replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
      if (!name) return;
      appendToBody(i, "{{" + name + "}}");
      renderFieldsPanel(panel, i);
    });
    panel.appendChild(addBtn);
  }

  function buildFieldRow(field, i, slots) {
    const row = document.createElement("div");
    row.className = "field-row";

    const name = document.createElement("span");
    name.className = "fname";
    name.textContent = field.name;
    if (slots && slots.has(field.name)) name.dataset.ph = String(slots.get(field.name));
    row.appendChild(name);

    const label = mkInput(field.label === field.name ? "" : field.label, TL.t("fbLabel"));
    const type = document.createElement("select");
    for (const [val, key] of [["text", "typeText"], ["multiline", "typeMultiline"], ["dropdown", "typeDropdown"], ["date", "typeDate"], ["checkbox", "typeCheckbox"]]) {
      const o = document.createElement("option");
      o.value = val; o.textContent = TL.t(key);
      if (field.type === val) o.selected = true;
      type.appendChild(o);
    }
    const def = mkInput(field.def, TL.t("fbDefault"));
    const opts = mkInput((field.options || []).join(", "), TL.t("fbOptions"));
    // Date fields: options slot holds the output format.
    const fmt = document.createElement("select");
    for (const f of TL.DATE_FORMATS) {
      const o = document.createElement("option");
      o.value = f; o.textContent = f;
      if ((field.options || [])[0] === f) o.selected = true;
      fmt.appendChild(o);
    }
    const syncVisibility = () => {
      const tv = type.value;
      opts.style.display = tv === "dropdown" ? "" : "none";
      fmt.style.display = tv === "date" ? "" : "none";
      def.placeholder = tv === "date" ? TL.t("fbDateDefault") : (tv === "checkbox" ? "true / false" : TL.t("fbDefault"));
      opts.placeholder = TL.t("fbOptions");
    };

    const mkFlag = (key, checked) => {
      const l = document.createElement("label");
      l.className = "rem";
      const c = document.createElement("input");
      c.type = "checkbox";
      c.checked = checked;
      l.append(c, document.createTextNode(TL.t(key)));
      return { l, c };
    };
    const { l: remLabel, c: rem } = mkFlag("fbRemember", !!field.remember);
    // The deny-list decides what we REFUSE to remember; it cannot decide what
    // the user considers a secret, and a name-based rule never will. So the
    // warning is unconditional and permanent, not a consequence of the rule
    // firing — a field called "deneme" holding a password looks like any
    // other field to isSecretName.
    remLabel.title = TL.t("fbRememberHint");
    if (TL.isSecretName(field.name)) { rem.disabled = true; rem.checked = false; rem.title = field.name; }
    const { l: reqLabel, c: req } = mkFlag("fbRequired", !!field.required);

    row.append(label, type, def, opts, fmt, remLabel, reqLabel);
    syncVisibility();

    const warn = document.createElement("div");
    warn.className = "field-warn";
    row.appendChild(warn);

    const apply = () => {
      syncVisibility();
      const hadMeta = /[|{}]/.test(label.value + def.value + opts.value) || /,/.test(label.value + def.value);
      const tv = type.value;
      const newField = {
        name: field.name,
        label: label.value || field.name,
        type: /** @type {TLField["type"]} */ (tv),
        def: def.value,
        options: tv === "dropdown" ? opts.value.split(",").map((s) => s.trim()).filter(Boolean)
          : (tv === "date" ? [fmt.value] : []),
        remember: rem.checked,
        required: req.checked,
      };
      warn.textContent = hadMeta ? TL.t("metacharWarn") : "";
      rewriteFieldToken(i, field.name, TL.buildFieldToken(newField));
      refreshForgetBtn(cardAt(i), templates[i]);
    };
    for (const el of [label, def, opts]) el.addEventListener("input", apply);
    for (const el of [type, fmt, rem, req]) el.addEventListener("change", apply);
    return row;
  }

  function mkInput(value, placeholder) {
    const el = document.createElement("input");
    el.type = "text";
    el.value = value || "";
    el.placeholder = placeholder;
    return el;
  }

  // Replace the {{name...}} token in the body with a freshly-built token.
  function rewriteFieldToken(i, name, newToken) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Global: a field can appear more than once in the body; keep every
    // occurrence in sync (parseFields dedups to one row but the token may repeat).
    const re = new RegExp("\\{\\{\\s*" + esc + "(\\|[^{}]*)?\\}\\}", "g");
    templates[i].body = (templates[i].body || "").replace(re, newToken);
    syncBodyControl(i);
    save();
  }

  function appendToBody(i, token) {
    const cur = templates[i].body || "";
    templates[i].body = cur + (cur && !cur.endsWith("\n") ? " " : "") + token;
    syncBodyControl(i);
    saveNow();
  }

  // Reflect a programmatic body change back into the visible editor/textarea.
  function syncBodyControl(i) {
    const card = refs.templates.querySelector('.template[data-idx="' + i + '"]');
    if (!card) return;
    updateCondWarn(card, templates[i].body || "");
    const editor = card.querySelector('[data-rich-editor]');
    if (editor) { editor.replaceChildren(TL.htmlToFragment(sanitizedBody(templates[i].body))); highlightPlaceholders(editor); return; }
    const ta = card.querySelector('textarea[data-field="body"]');
    if (ta) { ta.value = templates[i].body || ""; repaintPlain(ta); }
    const count = card.querySelector(".char-count");
    if (count) count.textContent = (templates[i].body || "").length + " / " + TL.LIMITS.MAX_BODY;
  }

  // --- Render ---
  // render() is structural: it rebuilds every card and runs only on real list
  // changes (add/delete/reorder/import/restore/language). The search filter is
  // applied as pure show/hide on the existing cards — rebuilding ~MAX_TEMPLATES
  // heavy cards on every search keystroke was the options page's biggest cost.
  function render() {
    // Every card (and its rich editor) is about to be replaced. Ranges left
    // in the Highlight registry would keep the detached editor subtrees alive,
    // and a pending-edit entry would keep a detached editor out of GC (its
    // content was already stored on blur, which is what precedes every render).
    clearAllHighlights();
    pendingRichEdits.clear();
    const frag = document.createDocumentFragment();
    templates.forEach((tpl, i) => {
      frag.appendChild(buildTemplateCard(tpl, i, templates.length));
    });
    if (templates.length === 0) {
      // First-run / empty state: one clear call to action instead of a blank page.
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const p = document.createElement("p");
      p.textContent = TL.t("emptyState");
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "primary";
      btn.textContent = TL.t("btnAdd");
      btn.addEventListener("click", () => refs.btnAdd.click());
      empty.append(p, btn);
      frag.appendChild(empty);
    }
    refs.templates.replaceChildren(frag);
    refs.templates.querySelectorAll("[data-rich-editor]").forEach((ed) => highlightPlaceholders(ed));
    renderNav();
    applySearchFilter();
  }

  // Derived folder views, memoized on the `folders` array itself. Both are
  // rebuilt per call otherwise, and updateCardChips/fillFolderSelect run once
  // per card: at MAX_TEMPLATES × MAX_FOLDERS that was ~30ms of pure JS on top
  // of every render(). `folders` is only ever REPLACED (never mutated in
  // place), so the identity check can't hand back a stale view.
  /** @type {{src: TLFolder[]|null, ids: Set<string>, slots: Map<string, number>}} */
  let folderView = { src: null, ids: new Set(), slots: new Map() };
  function folderDerived() {
    if (folderView.src !== folders) {
      folderView = { src: folders, ids: new Set(folders.map((f) => f.id)), slots: TL.folderSlots(folders) };
    }
    return folderView;
  }
  /** Read-only — callers never mutate it. */
  const folderIdSet = () => folderDerived().ids;

  /** Does a template belong to the current sidebar view? */
  function inView(tpl, ids) {
    if (view === "*") return !!tpl.favorite;
    if (view === "~") return !TL.folderOf(tpl, ids);
    if (view) return TL.folderOf(tpl, ids) === view;
    return true;
  }

  // Show/hide over existing cards. A search covers EVERY template (same rule
  // as the popup); the sidebar view only narrows browsing.
  function applySearchFilter() {
    const cards = /** @type {HTMLElement[]} */ (Array.from(refs.templates.querySelectorAll(".template")));
    const ids = folderIdSet();
    const matchIds = searchTerm ? new Set(TL.searchTemplates(searchTerm, templates).map((t) => t.id)) : null;
    const visible = [];
    for (const c of cards) {
      const tpl = templates[Number(c.dataset.idx)];
      const on = !!tpl && (matchIds ? matchIds.has(tpl.id) : inView(tpl, ids));
      c.style.display = on ? "" : "none";
      if (on) visible.push(c);
    }
    // Up/Down move within what is on screen, so the ends are the visible ends.
    visible.forEach((c, k) => {
      const up = /** @type {HTMLButtonElement|null} */ (c.querySelector('button[data-action="up"]'));
      const down = /** @type {HTMLButtonElement|null} */ (c.querySelector('button[data-action="down"]'));
      if (up) up.disabled = k === 0;
      if (down) down.disabled = k === visible.length - 1;
    });
    refs.folderNav.classList.toggle("dimmed", !!searchTerm);
    updateToggleAllLabel();

    let hint = refs.templates.querySelector(".search-empty-hint");
    if (visible.length === 0 && templates.length > 0) {
      if (!hint) {
        hint = document.createElement("div");
        hint.className = "hint search-empty-hint";
        refs.templates.appendChild(hint);
      }
      hint.textContent = TL.t(searchTerm ? "searchNoResults" : "folderEmpty");
    } else if (hint) {
      hint.remove();
    }
  }

  /** Indices (into templates[]) of the cards currently on screen, in order. */
  function visibleIndices() {
    return Array.from(refs.templates.querySelectorAll(".template"))
      .filter((c) => /** @type {any} */ (c).style.display !== "none")
      .map((c) => Number(/** @type {any} */ (c).dataset.idx));
  }

  // --- Sidebar ---
  function renderNav() {
    const hasFav = templates.some((t) => t.favorite);
    const show = folders.length > 0 || hasFav;
    refs.folderNav.hidden = !show;
    document.body.classList.toggle("has-nav", show);
    refs.btnNewFolder.hidden = show; // the sidebar carries its own "New folder"
    if (view === "*" && !hasFav) view = "";
    if (view && view !== "*" && view !== "~" && !folders.some((f) => f.id === view)) view = "";
    if (!show) { view = ""; refs.folderNav.replaceChildren(); return; }

    const ids = folderIdSet();
    const counts = new Map();
    let none = 0;
    for (const t of templates) {
      const f = TL.folderOf(t, ids);
      if (f) counts.set(f, (counts.get(f) || 0) + 1); else none++;
    }
    const row = (key, name, count, extra) => {
      const r = document.createElement("div");
      r.className = "nav-row" + (view === key ? " active" : "");
      r.dataset.view = key;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "nav-item";
      b.dataset.view = key;
      if (view === key) b.setAttribute("aria-current", "true");
      if (extra) b.appendChild(extra);
      const n = document.createElement("span"); n.className = "nav-name"; n.textContent = name;
      const c = document.createElement("span"); c.className = "nav-count"; c.textContent = String(count);
      b.append(n, c);
      r.appendChild(b);
      return r;
    };
    const frag = document.createDocumentFragment();
    frag.appendChild(row("", TL.t("folderAll"), templates.length));
    if (hasFav) {
      const icon = document.createElement("span"); icon.className = "nav-fav-icon"; icon.textContent = "★";
      frag.appendChild(row("*", TL.t("folderFavorites"), templates.filter((t) => t.favorite).length, icon));
    }
    if (folders.length) {
      const sep = document.createElement("div"); sep.className = "nav-sep"; frag.appendChild(sep);
      const fslots = folderDerived().slots;
      for (const f of folders) {
        const dot = document.createElement("span");
        dot.className = "nav-dot";
        dot.dataset.fc = String(fslots.get(f.id) ?? 0);
        const r = row(f.id, f.name, counts.get(f.id) || 0, dot);
        r.dataset.folder = f.id; // drop target
        const act = (kind, text, key) => {
          const a = document.createElement("button");
          a.type = "button";
          a.className = "nav-act" + (kind === "delete" ? " del" : "");
          a.dataset.folderAct = kind;
          a.dataset.folderId = f.id;
          a.textContent = text;
          a.title = TL.t(key);
          a.setAttribute("aria-label", `${TL.t(key)}: ${f.name}`);
          return a;
        };
        r.append(act("rename", "✎", "folderRename"), act("delete", "×", "folderDelete"));
        frag.appendChild(r);
      }
      const r = row("~", TL.t("folderNone"), none);
      r.dataset.folder = ""; // dropping here clears the folder
      frag.appendChild(r);
    }
    if (folders.length < TL.LIMITS.MAX_FOLDERS) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "small nav-new";
      add.dataset.folderAct = "new";
      add.textContent = "+ " + TL.t("folderNew");
      frag.appendChild(add);
    }
    refs.folderNav.replaceChildren(frag);
  }

  // --- Folder operations ---
  async function persistFolders(next) {
    try {
      folders = await TL.setFolders(next);
      lastFoldersSig = sig(folders);
      return true;
    } catch (err) {
      console.error("[YAZIT] Folder save failed:", err);
      showStatus(TL.t("statusError"));
      return false;
    }
  }

  /** Prompt for a name and create the folder. Resolves with its id or null. */
  async function createFolder() {
    if (folders.length >= TL.LIMITS.MAX_FOLDERS) {
      showStatus(TL.t("folderCap", [String(TL.LIMITS.MAX_FOLDERS)]));
      return null;
    }
    const name = await askFolderName(TL.t("folderPrompt"), "");
    if (!name) return null;
    const id = TL.makeFolderId();
    if (!(await persistFolders([...folders, { id, name, order: folders.length }]))) return null;
    return id;
  }

  /** Prompt until the name is non-empty and unique (or the user cancels). */
  async function askFolderName(message, current, selfId = "") {
    let value = current;
    for (;;) {
      const raw = await tlPrompt(message, TL.t("folderPrompt"), value);
      if (raw === null) return null;
      const name = TL.cleanFolderName(raw);
      if (!name) return null;
      const clash = folders.some((f) => f.id !== selfId && f.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      if (!clash) return name;
      await tlAlert(TL.t("folderExists"));
      value = name;
    }
  }

  async function renameFolder(id) {
    const f = folders.find((x) => x.id === id);
    if (!f) return;
    const name = await askFolderName(TL.t("folderRenamePrompt", [f.name]), f.name, id);
    if (!name || name === f.name) return;
    if (!(await persistFolders(folders.map((x) => (x.id === id ? { ...x, name } : x))))) return;
    refreshFolderSelects();
    renderNav();
  }

  async function deleteFolder(id) {
    const f = folders.find((x) => x.id === id);
    if (!f) return;
    const members = templates.filter((t) => t.folderId === id);
    if (!(await tlConfirm(TL.t("folderDeleteConfirm", [f.name, String(members.length)]), true))) return;
    // Templates first: if the folders write then fails, the ids merely
    // dangle, which already reads as uncategorized — nothing is lost.
    if (members.length) {
      for (const t of members) delete t.folderId;
      await saveNow();
    }
    if (!(await persistFolders(folders.filter((x) => x.id !== id)))) return;
    if (view === id) view = "";
    render();
  }

  /** Move one template into a folder ("" = uncategorized). */
  async function moveToFolder(idx, folderId) {
    const tpl = templates[idx];
    if (!tpl) return;
    if (folderId) tpl.folderId = folderId; else delete tpl.folderId;
    const sel = /** @type {HTMLSelectElement|null} */ (refs.templates.querySelector(`select[data-folder-select][data-idx="${idx}"]`));
    if (sel) sel.value = folderId;
    updateCardChips(cardAt(idx), tpl);
    await saveNow();
    renderNav();
    applySearchFilter();
    const f = folders.find((x) => x.id === folderId);
    showStatus(TL.t("folderMoved", [f ? f.name : TL.t("folderNone")]));
  }

  refs.btnNewFolder.addEventListener("click", async () => {
    if (await createFolder()) { refreshFolderSelects(); renderNav(); applySearchFilter(); }
  });

  refs.folderNav.addEventListener("click", async (e) => {
    const t = /** @type {any} */ (e.target);
    const act = t.closest("[data-folder-act]");
    if (act) {
      const kind = act.dataset.folderAct;
      if (kind === "new") {
        const id = await createFolder();
        if (id) { view = id; refreshFolderSelects(); renderNav(); applySearchFilter(); }
      } else if (kind === "rename") await renameFolder(act.dataset.folderId);
      else if (kind === "delete") await deleteFolder(act.dataset.folderId);
      return;
    }
    const item = t.closest(".nav-item");
    if (!item) return;
    view = item.dataset.view;
    if (searchTerm) { searchTerm = ""; refs.search.value = ""; } // picking a view ends the global search
    renderNav();
    applySearchFilter();
    window.scrollTo({ top: 0, behavior: scrollBehavior() });
  });

  // Drag a card's handle onto a folder (or "Uncategorized") to move it.
  // Same reason as markDragOver below: dragover fires continuously, so the
  // highlighted row is remembered instead of re-scanned out of the sidebar.
  /** @type {any} */ let dropTargetRow = null;
  function markDropTarget(row) {
    if (row === dropTargetRow) return;
    if (dropTargetRow) dropTargetRow.classList.remove("drop-target");
    dropTargetRow = row;
    if (row) row.classList.add("drop-target");
  }
  refs.folderNav.addEventListener("dragover", (e) => {
    const r = /** @type {any} */ (e.target).closest(".nav-row");
    const on = dragId && r && r.dataset.folder !== undefined ? r : null;
    markDropTarget(on);
    if (!on) return;
    e.preventDefault();
  });
  refs.folderNav.addEventListener("dragleave", (e) => {
    if (!refs.folderNav.contains(/** @type {any} */ (e.relatedTarget))) markDropTarget(null);
  });
  refs.folderNav.addEventListener("drop", async (e) => {
    const r = /** @type {any} */ (e.target).closest(".nav-row");
    if (!dragId || !r || r.dataset.folder === undefined) return;
    e.preventDefault();
    const idx = templates.findIndex((t) => t.id === dragId);
    if (idx >= 0) await moveToFolder(idx, r.dataset.folder);
  });

  // --- Live text edits ---
  refs.templates.addEventListener("input", (e) => {
    const el = /** @type {any} */ (e.target);
    const field = el.dataset?.field;
    if (!field) return;
    const idx = Number(el.dataset.idx);
    if (!templates[idx]) return;

    let value = el.value;
    if (field === "shortcut") {
      value = value.replace(TL.SHORTCUT_STRIP_RE, "");
      if (value !== el.value) el.value = value;
      templates[idx].shortcut = value;
      updateCardChips(el.closest(".template"), templates[idx]);
    } else if (field === "tags") {
      templates[idx].tags = TL.normalizeTags(value.split(","));
    } else {
      templates[idx][field] = value;
      if (field === "name") {
        const header = el.closest(".template").querySelector(".template-name-inline");
        if (header) header.textContent = value;
      }
    }
    save();
  });

  // --- Checkbox selection (id-based) ---
  refs.templates.addEventListener("change", async (e) => {
    const el = /** @type {any} */ (e.target);
    if (el.matches("select[data-folder-select]")) {
      const idx = Number(el.dataset.idx);
      if (!templates[idx]) return;
      let target = el.value;
      if (target === NEW_FOLDER) {
        target = await createFolder();
        if (!target) { el.value = TL.folderOf(templates[idx], folderIdSet()); return; }
        refreshFolderSelects();
      }
      await moveToFolder(idx, target);
      return;
    }
    if (el.matches('input[type="checkbox"][data-select]')) {
      const id = el.dataset.select;
      if (el.checked) selectedIds.add(id);
      else selectedIds.delete(id);
      el.closest(".template").classList.toggle("selected", el.checked);
      updateSelectionBar();
    }
  });

  // --- Action buttons ---
  refs.templates.addEventListener("click", async (e) => {
    const target = /** @type {any} */ (e.target);
    const btn = target.closest("button[data-action]");
    if (!btn) {
      // Clicking the header row itself (not one of its controls) toggles too.
      const header = target.closest(".template-header");
      if (header && !target.closest("input,label,select,.drag-handle")) {
        const card = header.closest(".template");
        setExpanded(card, card.classList.contains("collapsed"));
      }
      return;
    }
    const idx = Number(btn.dataset.idx);
    const action = btn.dataset.action;
    if (action === "toggle") {
      const card = btn.closest(".template");
      setExpanded(card, card.classList.contains("collapsed"));
      return;
    }

    if (action === "delete") {
      if (!(await tlConfirm(TL.t("confirmDelete"), true))) return;
      await TL.pushBackup(); // safety net before a destructive op
      const [removed] = templates.splice(idx, 1);
      if (removed) {
        selectedIds.delete(removed.id);
        expanded.delete(removed.id);
        await TL.clearLastValues(removed.id); // GC the deleted template's remembered values
      }
    } else if (action === "up" || action === "down") {
      // Swap with the neighbour ON SCREEN — in a folder view the adjacent
      // array entry may be a hidden template from another folder.
      const vis = visibleIndices();
      const k = vis.indexOf(idx);
      const j = vis[action === "up" ? k - 1 : k + 1];
      if (k < 0 || j === undefined) return;
      [templates[j], templates[idx]] = [templates[idx], templates[j]];
    } else if (action === "favorite") {
      const tpl = templates[idx];
      if (!tpl) return;
      if (tpl.favorite) delete tpl.favorite; else tpl.favorite = true;
      setStar(btn, !!tpl.favorite);
      await saveNow();
      renderNav();
      applySearchFilter();
      return;
    } else if (action === "export-one") {
      const tpl = templates[idx];
      exportTemplates([tpl], TL.sanitizeFilename(tpl.name));
      return;
    } else if (action === "forget") {
      const tpl = templates[idx];
      if (!tpl) return;
      // No confirmation: this DELETES a copy of something sensitive, so the
      // safe direction is to let it happen easily. Nothing of the template
      // itself is lost — only the cached last-used values.
      await TL.clearLastValues(tpl.id);
      showStatus(TL.t("forgetRememberedDone"));
      return;
    } else {
      return;
    }
    await saveNow();
    render();
    updateSelectionBar();
  });

  // --- Drag-drop reorder (plan step 17) ---
  let dragId = null;
  refs.templates.addEventListener("dragstart", (e) => {
    // Drag is only initiated from the handle (the only draggable element).
    const el = /** @type {any} */ (e.target);
    if (!el.classList || !el.classList.contains("drag-handle")) { e.preventDefault(); return; }
    const card = el.closest(".template");
    if (!card) return;
    dragId = card.dataset.id;
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    // Use the whole card as the drag image instead of the tiny handle.
    try { e.dataTransfer.setDragImage(card, 12, 12); } catch (_) {}
  });
  // dragover fires continuously while the pointer moves. Remember which card
  // carries the marker instead of re-scanning the whole list (up to
  // MAX_TEMPLATES cards) on every one of those events.
  /** @type {any} */ let dragOverCard = null;
  function markDragOver(card) {
    if (card === dragOverCard) return;
    if (dragOverCard) dragOverCard.classList.remove("drag-over");
    dragOverCard = card;
    if (card) card.classList.add("drag-over");
  }
  refs.templates.addEventListener("dragover", (e) => {
    e.preventDefault();
    const card = /** @type {any} */ (e.target).closest(".template");
    markDragOver(card && card.dataset.id !== dragId ? card : null);
  });
  refs.templates.addEventListener("drop", async (e) => {
    e.preventDefault();
    const card = /** @type {any} */ (e.target).closest(".template");
    if (!card || !dragId) return;
    const fromIdx = templates.findIndex((t) => t.id === dragId);
    const toIdx = templates.findIndex((t) => t.id === card.dataset.id);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
    const [moved] = templates.splice(fromIdx, 1);
    templates.splice(toIdx, 0, moved);
    await saveNow();
    render();
  });
  refs.templates.addEventListener("dragend", () => {
    dragId = null;
    // Both rows may already be gone (drop → render), so drop the references
    // before the sweep rather than relying on them to clear the classes.
    dragOverCard = null;
    dropTargetRow = null;
    refs.templates.querySelectorAll(".dragging,.drag-over").forEach((c) => c.classList.remove("dragging", "drag-over"));
    refs.folderNav.querySelectorAll(".drop-target").forEach((c) => c.classList.remove("drop-target"));
  });

  // --- Export helpers ---
  function exportTemplates(items, filename) {
    const json = JSON.stringify(TL.toExportable(items, folders), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // --- Top-level actions ---
  refs.btnAdd.addEventListener("click", async () => {
    if (templates.length >= TL.LIMITS.MAX_TEMPLATES) {
      showStatus(TL.t("capReached", [String(TL.LIMITS.MAX_TEMPLATES)]));
      return;
    }
    const tpl = { name: TL.t("newTplName", [String(templates.length + 1)]), shortcut: "", body: "" };
    // Born where the user is looking, so it doesn't vanish from the view.
    if (view === "*") tpl.favorite = true;
    else if (view && view !== "~") tpl.folderId = view;
    templates.push(tpl);
    await saveNow();
    const born = templates[templates.length - 1];
    if (born && born.id) expanded.add(born.id); // a new template opens ready to edit
    render();
    const cards = refs.templates.querySelectorAll(".template");
    const last = /** @type {HTMLElement|null} */ (cards[cards.length - 1] || null);
    last?.scrollIntoView({ behavior: scrollBehavior(), block: "end" });
    /** @type {HTMLInputElement|null} */ (last?.querySelector('input[data-field="name"]'))?.select();
  });

  refs.btnExportAll.addEventListener("click", () => {
    if (templates.length === 0) return;
    exportTemplates(templates, `yazit-templates-${stamp()}`);
  });

  refs.btnExportClip.addEventListener("click", async () => {
    if (templates.length === 0) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(TL.toExportable(templates, folders), null, 2));
      showStatus(TL.t("clipCopied"));
    } catch (_) {
      showStatus(TL.t("statusError"));
    }
  });

  refs.btnExportSelected.addEventListener("click", () => {
    const selected = templates.filter((t) => selectedIds.has(t.id));
    if (selected.length === 0) return;
    exportTemplates(selected, `yazit-selected-${stamp()}`);
  });

  refs.btnDeselectAll.addEventListener("click", () => {
    selectedIds.clear();
    render();
    updateSelectionBar();
  });

  function stamp() {
    return new Date().toISOString().slice(0, 10);
  }

  // --- Search (debounced: pure show/hide over existing cards) ---
  refs.search.addEventListener("input", TL.debounce(() => {
    searchTerm = refs.search.value.trim();
    applySearchFilter();
  }, 150));

  // --- Variable insert menu ---
  const VARS = [
    { token: "{{cursor}}", key: "varCursor" },
    { token: "{{date}}", key: "varDate" },
    { token: "{{date+3d}}", key: "varDateOffset" },
    { token: "{{date|dd.MM.yyyy}}", key: "varDateFormat" },
    { token: "{{time}}", key: "varTime" },
    { token: "{{datetime}}", key: "varDatetime" },
    { token: "{{name|Label|text|default}}", key: "varField" },
    { token: "{{#if flag}}…{{else}}…{{/if}}", key: "varIf" },
  ];
  function buildVarMenu() {
    refs.varList.replaceChildren();
    for (const v of VARS) {
      const btn = document.createElement("button");
      btn.type = "button";
      const code = document.createElement("code");
      code.textContent = v.token;
      btn.appendChild(code);
      btn.appendChild(document.createTextNode(" — " + TL.t(v.key)));
      btn.addEventListener("click", () => { insertVariable(v.token); refs.varList.classList.remove("open"); });
      refs.varList.appendChild(btn);
    }
  }
  refs.varBtn.addEventListener("click", () => refs.varList.classList.toggle("open"));

  // --- Toolbar dropdowns (Import/Export, Settings) ---
  // Menu items are the old top-level buttons, moved inside — their ids and
  // click handlers are unchanged. A button inside closes the menu; the
  // Settings selects don't, so both can be changed in one visit.
  const dropdowns = /** @type {HTMLElement[]} */ (Array.from(document.querySelectorAll(".dd")));
  function setDropdown(dd, open) {
    dd.querySelector(".dd-list").classList.toggle("open", open);
    dd.querySelector(".dd-btn").setAttribute("aria-expanded", String(open));
  }
  for (const dd of dropdowns) {
    const btn = dd.querySelector(".dd-btn");
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");
    btn.addEventListener("click", () => {
      const open = !dd.querySelector(".dd-list").classList.contains("open");
      for (const other of dropdowns) setDropdown(other, other === dd && open);
    });
    dd.querySelector(".dd-list").addEventListener("click", (e) => {
      if (/** @type {any} */ (e.target).closest("button")) setDropdown(dd, false);
    });
  }
  document.addEventListener("click", (e) => {
    for (const dd of dropdowns) if (!dd.contains(/** @type {any} */ (e.target))) setDropdown(dd, false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    for (const dd of dropdowns) {
      if (dd.querySelector(".dd-list.open")) { setDropdown(dd, false); /** @type {any} */ (dd.querySelector(".dd-btn")).focus(); }
    }
  });
  document.addEventListener("click", (e) => {
    if (!/** @type {any} */ (e.target).closest(".var-menu")) refs.varList.classList.remove("open");
  });
  function insertVariable(token) {
    // render() replaces every card, but lastFocusedBody kept pointing at the
    // DETACHED editor of whichever template was focused before. Its data-idx
    // is a position in the OLD list, so after a reorder/delete this wrote one
    // template's body over another's and saved it — silently. A detached node
    // is never a valid insertion target.
    // A body inside a folded card is connected but not on screen — focusing it
    // fails and execCommand would write wherever focus happens to be.
    const ta = lastFocusedBody && lastFocusedBody.isConnected && !lastFocusedBody.closest(".collapsed")
      ? lastFocusedBody : null;
    if (!ta) { lastFocusedBody = null; showStatus(TL.t("varNeedField")); return; }
    const idx = Number(ta.dataset.idx);
    if (ta.dataset.richEditor) {
      ta.focus();
      TL.editorAdapter.insertText(token);
      if (templates[idx]) storeRichBody(idx, ta);
      return;
    }
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, start) + token + ta.value.slice(end);
    if (templates[idx]) templates[idx].body = ta.value;
    repaintPlain(ta);
    ta.focus();
    const pos = start + token.length;
    ta.setSelectionRange(pos, pos);
    save();
  }

  // --- Backups panel ---
  refs.btnBackups.addEventListener("click", async () => {
    const open = refs.backupsPanel.classList.toggle("visible");
    if (open) { await renderBackups(); refs.backupsPanel.scrollIntoView({ behavior: scrollBehavior(), block: "nearest" }); }
  });

  async function renderBackups() {
    const backups = await TL.getBackups();
    refs.backupsList.replaceChildren();
    if (backups.length === 0) {
      const empty = document.createElement("div");
      empty.className = "backup-meta";
      empty.textContent = TL.t("backupEmpty");
      refs.backupsList.appendChild(empty);
      return;
    }
    for (const b of backups) {
      const item = document.createElement("div");
      item.className = "backup-item";
      const meta = document.createElement("span");
      meta.className = "backup-meta";
      meta.textContent = `${new Date(b.ts).toLocaleString()} · ${TL.t("backupCount", [String(b.count || (b.templates || []).length)])}`;
      const btn = document.createElement("button");
      btn.className = "small";
      btn.textContent = TL.t("backupRestore");
      btn.addEventListener("click", async () => {
        if (!(await tlConfirm(TL.t("confirmRestore"), true))) return;
        await TL.pushBackup(); // snapshot current before overwriting
        await TL.restoreBackup(b.ts);
        templates = await TL.getTemplates();
        folders = await TL.getFolders();
        lastFoldersSig = sig(folders);
        lastWriteSig = sig(templates); // migrate() output has the stored key order — echo is ours
        TL.gcLastValues(templates.map((t) => t.id)); // drop values of templates the backup doesn't have
        selectedIds.clear();
        render();
        updateSelectionBar();
        await renderBackups();
        showStatus(TL.t("backupRestored"));
      });
      item.append(meta, btn);
      refs.backupsList.appendChild(item);
    }
  }

  // ============================================================
  // Import flow — size guard, competitor auto-detect, conflicts
  // ============================================================
  refs.btnImport.addEventListener("click", () => refs.importFile.click());

  refs.importFile.addEventListener("change", async (e) => {
    const file = /** @type {any} */ (e.target).files?.[0];
    if (!file) return;
    try {
      if (file.size > TL.LIMITS.MAX_IMPORT_BYTES) {
        throw new Error(TL.t("importTooLarge", [String(Math.round(TL.LIMITS.MAX_IMPORT_BYTES / 1024 / 1024))]));
      }
      const text = await file.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { throw new Error(TL.t("importInvalid")); }

      // Competitor auto-detect (Text Blaze / Magical) → adapt, else native.
      const adapted = TL.detectAndAdapt(parsed);
      pendingSource = adapted ? adapted.source : null;
      const raw = adapted ? adapted.items : parsed;

      const summary = TL.validateTemplates(raw);
      if (summary.accepted.length === 0) throw new Error(TL.t("importInvalid"));
      pendingImport = summary.accepted;

      // Build preview text + summary
      let preview = TL.t("importPreview", [String(summary.accepted.length)]);
      if (summary.rejected || summary.truncated) {
        preview += " " + TL.t("importSummary", [String(summary.rejected), String(summary.truncated)]);
      }
      refs.importPreview.textContent = preview;

      refs.importSource.textContent = pendingSource
        ? TL.t("importSourceDetected", [pendingSource === "textblaze" ? "Text Blaze" : "Magical"])
        : "";

      // Conflicts (case-insensitive duplicate shortcuts vs existing)
      const existing = new Set(templates.map((t) => (t.shortcut || "").toLowerCase()).filter(Boolean));
      pendingConflicts = pendingImport
        .map((t) => (t.shortcut || "").toLowerCase())
        .filter((s) => s && existing.has(s));
      if (pendingConflicts.length) {
        refs.conflictText.textContent = TL.t("conflictText", [String(pendingConflicts.length)]);
        refs.conflictNote.classList.add("visible");
      } else {
        refs.conflictNote.classList.remove("visible");
      }

      refs.importModal.classList.add("visible");
    } catch (err) {
      await tlAlert(TL.t("importError", [err.message]));
    } finally {
      /** @type {any} */ (e.target).value = "";
    }
  });

  function closeImportModal() {
    refs.importModal.classList.remove("visible");
    refs.conflictNote.classList.remove("visible");
    pendingImport = null;
    pendingConflicts = [];
    pendingSource = null;
  }
  refs.importCancel.addEventListener("click", closeImportModal);
  refs.importModal.addEventListener("click", (e) => {
    if (e.target === refs.importModal) closeImportModal();
  });

  refs.importConfirm.addEventListener("click", async () => {
    if (!pendingImport) return;
    const mode = /** @type {any} */ (document.querySelector('input[name="import-mode"]:checked'))?.value;
    const conflictMode = /** @type {any} */ (document.querySelector('input[name="conflict-mode"]:checked'))?.value || "keepboth";
    const count = pendingImport.length;

    await TL.pushBackup(); // safety net before import

    // Folder names in the file → local ids (creating what's missing).
    const resolved = TL.resolveImportFolders(pendingImport, folders, mode === "replace" ? "replace" : "merge");
    await persistFolders(resolved.folders);
    if (mode === "replace") {
      templates = resolved.templates.slice();
      selectedIds.clear();
    } else {
      templates = TL.mergeImport(templates, resolved.templates, conflictMode);
    }
    if (templates.length > TL.LIMITS.MAX_TEMPLATES) templates = templates.slice(0, TL.LIMITS.MAX_TEMPLATES);

    await saveNow();
    if (mode === "replace") TL.gcLastValues(templates.map((t) => t.id)); // nothing references the old ids now
    closeImportModal();
    render();
    updateSelectionBar();
    showStatus(TL.t("importSuccess", [String(count)]));
  });

  // ESC closes whichever modal is open
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (refs.dlg.classList.contains("visible")) closeDialog(null);
    else if (refs.importModal.classList.contains("visible")) closeImportModal();
  });

  // --- Dismissible hints (persisted) ---
  refs.hintsClose.addEventListener("click", async () => {
    refs.hints.hidden = true;
    try { await chrome.storage.local.set({ hideHints: true }); } catch (_) {}
  });

  // --- Language switcher ---
  refs.langSelect.addEventListener("change", async (e) => {
    userLang = /** @type {any} */ (e.target).value;
    await TL.setLang(userLang);
    document.documentElement.lang = await TL.loadLocale(userLang);
    applyUIStrings();
    render();
  });

  // --- Clear every remembered value ---
  // gcLastValues keeps the keys of templates that still exist; passing an
  // empty list makes it drop all of them, which is exactly "forget
  // everything". No template is touched.
  refs.btnForgetAll.addEventListener("click", async () => {
    if (!(await tlConfirm(TL.t("forgetAllConfirm"), true))) return;
    await TL.gcLastValues([]);
    showStatus(TL.t("forgetRememberedDone"));
  });

  // --- Theme switcher ---
  // Only writes the preference: theme.js repaints this page (and any open
  // popup / other options tab) from the storage change.
  refs.themeSelect.addEventListener("change", (e) => {
    TL.setTheme(/** @type {any} */ (e.target).value);
  });

  // --- React to external storage changes ---
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.uiTheme) refs.themeSelect.value = TL.normalizeTheme(changes.uiTheme.newValue);
    if (changes.folders) {
      const nextFolders = TL.normalizeFolders(changes.folders.newValue);
      if (sig(nextFolders) !== lastFoldersSig) {
        folders = nextFolders;
        lastFoldersSig = sig(folders);
        refreshFolderSelects();
        renderNav();
        applySearchFilter();
      }
    }
    if (!changes.templates) return;
    const next = /** @type {any[]} */ (changes.templates.newValue || []);
    if (sig(next) === lastWriteSig) return; // our own debounced-save echo — ignore
    templates = next.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    render();
    updateSelectionBar();
  });

  // --- Flush pending edits on page-hide (closes the debounce data-loss window) ---
  // Synchronously store the rich editors that still hold unsaved keystrokes,
  // then force the debounced persist to run now instead of being dropped on
  // unload. Only pendingRichEdits can hold such keystrokes — every other write
  // path (blur, toolbar, condition/variable insert) stores synchronously — and
  // this runs on every tab switch, so walking all cards would pay a DOMParser
  // pass plus a highlight rebuild per template just to re-store unchanged text.
  function flushPendingEdits() {
    for (const editor of Array.from(pendingRichEdits)) {
      const i = Number(/** @type {any} */ (editor).dataset.idx);
      if (templates[i]) storeRichBody(i, /** @type {any} */ (editor));
      else pendingRichEdits.delete(editor);
    }
    save.flush(); // persist immediately rather than after the 400ms debounce
  }
  // visibilitychange (hidden) is the reliable persistence hook; beforeunload is
  // a best-effort backstop for hard tab closes.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flushPendingEdits();
  });
  window.addEventListener("beforeunload", flushPendingEdits);

  // --- Initial load ---
  applyUIStrings();
  const [{ hideHints = false }, list, folderList, theme] = await Promise.all([
    chrome.storage.local.get("hideHints"),
    TL.getTemplates(),
    TL.getFolders(),
    TL.getTheme(),
  ]);
  refs.hints.hidden = hideHints === true;
  refs.themeSelect.value = theme;
  templates = list;
  folders = folderList;
  lastFoldersSig = sig(folders);
  render();
})();
