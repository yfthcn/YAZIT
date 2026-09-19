// @ts-check
// ==============================
// YAZIT — Popup
// ==============================

(async function () {
  "use strict";

  // Four independent reads, one round trip. Awaiting them in sequence made a
  // popup's open latency their SUM, and none of them needs another's answer:
  // only loadLocale does, and it waits for getLang alone.
  const [lang, slotKeys, templateList, folderList] = await Promise.all([
    TL.getLang(), TL.getSlotKeys(), TL.getTemplates(), TL.getFolders(),
  ]);
  // <html lang> carries the RESOLVED locale, not the "auto" preference, so a
  // screen reader announces Turkish UI with a Turkish voice.
  document.documentElement.lang = await TL.loadLocale(lang);

  // --- Static UI strings ---
  // The document title is what a screen reader announces when the popup opens;
  // manifest.action.default_title is the toolbar tooltip, not this.
  document.getElementById("page-title").textContent = TL.t("appName");
  document.getElementById("heading").textContent = TL.t("appName");
  document.getElementById("list").setAttribute("aria-label", TL.t("popupHeading"));
  document.getElementById("tagline").textContent = TL.t("tagline");
  document.getElementById("options-link").textContent = TL.t("popupEditLink");
  // Real slot shortcuts (⌘ on macOS / user remaps) instead of a hardcoded label.
  const hint = TL.slotKeysHint(slotKeys);
  document.getElementById("shortcut-hint").textContent = hint ? TL.t("popupShortcutHint", [hint]) : "";
  const version = "v" + chrome.runtime.getManifest().version;
  document.getElementById("version").textContent = version;
  document.getElementById("header-version").textContent = version;
  const searchEl = /** @type {HTMLInputElement} */ (document.getElementById("search"));
  searchEl.placeholder = TL.t("searchPlaceholder");

  const listEl = document.getElementById("list");
  const chipsEl = document.getElementById("chips");
  chipsEl.setAttribute("aria-label", TL.t("foldersHeading"));
  let allTemplates = [];
  let folders = [];
  /** "" = all, "*" = favorites, otherwise a folder id */
  let view = "";

  // Favorites float to the top; everything else keeps the user's order.
  // Slot badges still come from allTemplates' order (see slotByTpl below),
  // so Ctrl+Shift+1..3 never silently change meaning.
  const favFirst = (list) => [...list.filter((t) => t.favorite), ...list.filter((t) => !t.favorite)];

  function inView(list) {
    if (view === "*") return list.filter((t) => t.favorite);
    if (!view) return list;
    const ids = new Set(folders.map((f) => f.id));
    return list.filter((t) => TL.folderOf(t, ids) === view);
  }

  function renderChips() {
    const hasFav = allTemplates.some((t) => t.favorite);
    chipsEl.hidden = folders.length === 0 && !hasFav;
    if (chipsEl.hidden) { view = ""; return; }
    if (view === "*" && !hasFav) view = "";
    if (view && view !== "*" && !folders.some((f) => f.id === view)) view = "";
    const chip = (id, label) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (id === "*" ? " chip-fav" : "");
      b.dataset.view = id;
      b.textContent = label;
      b.setAttribute("aria-pressed", String(view === id));
      return b;
    };
    const frag = document.createDocumentFragment();
    frag.appendChild(chip("", TL.t("folderAll")));
    if (hasFav) frag.appendChild(chip("*", "★ " + TL.t("folderFavorites")));
    const fslots = TL.folderSlots(folders);
    for (const f of folders) {
      const c = chip(f.id, f.name);
      const dot = document.createElement("span");
      dot.className = "fc-dot";
      dot.dataset.fc = String(fslots.get(f.id) ?? 0);
      c.prepend(dot);
      frag.appendChild(c);
    }
    chipsEl.replaceChildren(frag);
    // Keep the selected chip on screen (e.g. a folder far to the right).
    const active = /** @type {HTMLElement|null} */ (chipsEl.querySelector('[aria-pressed="true"]'));
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
    updateChipEdges();
  }

  // --- Chip row scrolling ---
  // The row scrolls horizontally, but a mouse wheel only scrolls vertically
  // and a thin scrollbar is hard to hit — so map the wheel to sideways
  // scrolling and allow click-and-drag, with faded edges hinting at overflow.
  const updateChipEdges = () => {
    const max = chipsEl.scrollWidth - chipsEl.clientWidth;
    chipsEl.classList.toggle("more-l", chipsEl.scrollLeft > 1);
    chipsEl.classList.toggle("more-r", chipsEl.scrollLeft < max - 1);
  };
  chipsEl.addEventListener("scroll", updateChipEdges, { passive: true });
  chipsEl.addEventListener("wheel", (e) => {
    if (chipsEl.scrollWidth <= chipsEl.clientWidth) return;
    if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return; // trackpad already scrolls sideways
    e.preventDefault();
    chipsEl.scrollLeft += e.deltaY;
  }, { passive: false });

  let drag = null;        // { x, left, moved }
  let suppressClick = false;
  chipsEl.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return; // touch scrolls natively
    drag = { x: e.clientX, left: chipsEl.scrollLeft, moved: false };
  });
  chipsEl.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 5) return; // still a click
    if (!drag.moved) { drag.moved = true; chipsEl.setPointerCapture(e.pointerId); chipsEl.classList.add("dragging"); }
    chipsEl.scrollLeft = drag.left - dx;
  });
  const endDrag = () => {
    if (drag?.moved) suppressClick = true; // the release after a drag is not a chip click
    drag = null;
    chipsEl.classList.remove("dragging");
  };
  chipsEl.addEventListener("pointerup", endDrag);
  chipsEl.addEventListener("pointercancel", endDrag);

  chipsEl.addEventListener("click", (e) => {
    if (suppressClick) { suppressClick = false; return; }
    const b = /** @type {any} */ (e.target).closest(".chip");
    if (!b) return;
    view = b.dataset.view;
    renderChips();
    renderList(searchEl.value);
  });

  function renderList(filter = "") {
    // A search always covers every template; the chips only narrow browsing.
    const q = filter.trim();
    chipsEl.classList.toggle("dimmed", !!q);
    const templates = favFirst(q ? TL.searchTemplates(q, allTemplates) : inView(allTemplates));
    listEl.replaceChildren();

    if (allTemplates.length === 0) {
      const div = document.createElement("div");
      div.className = "empty";
      div.textContent = TL.t("popupEmpty");
      listEl.appendChild(div);
      return;
    }
    if (templates.length === 0) {
      const div = document.createElement("div");
      div.className = "empty";
      div.textContent = TL.t(q ? "searchNoResults" : "folderEmpty");
      listEl.appendChild(div);
      return;
    }

    // template→index Map once (O(n)) instead of an indexOf scan per row (O(n²)).
    const slotByTpl = new Map(allTemplates.map((t, idx) => [t, idx]));
    const frag = document.createDocumentFragment();
    templates.forEach((tpl) => {
      const item = document.createElement("div");
      item.className = "template-item";
      item.role = "listitem";
      item.tabIndex = 0;
      item.dataset.id = tpl.id;

      const name = document.createElement("span");
      name.className = "template-name";
      if (tpl.favorite) {
        const star = document.createElement("span");
        star.className = "star";
        star.setAttribute("aria-label", TL.t("folderFavorites"));
        star.textContent = "★";
        name.appendChild(star);
      }
      name.appendChild(document.createTextNode(tpl.name));

      const badge = document.createElement("span");
      badge.className = "template-shortcut";
      const slotIdx = slotByTpl.get(tpl) ?? -1;
      badge.textContent = tpl.shortcut
        ? "/" + tpl.shortcut
        : (slotIdx >= 0 && slotIdx < 3 ? slotKeys[slotIdx] : "");
      if (!badge.textContent) badge.hidden = true;

      item.append(name, badge);
      frag.appendChild(item);
    });
    listEl.appendChild(frag);
  }

  // --- Event delegation: click + Enter/Space ---
  listEl.addEventListener("click", (e) => {
    const item = /** @type {any} */ (e.target).closest(".template-item");
    if (item) pasteTemplateById(item.dataset.id);
  });
  listEl.addEventListener("keydown", (e) => {
    if (navKeys(e)) return;
    if (e.key === "Enter" || e.key === " ") {
      const item = /** @type {any} */ (e.target).closest(".template-item");
      if (!item) return;
      e.preventDefault();
      pasteTemplateById(item.dataset.id);
    }
  });

  // --- Keyboard: ↑/↓ move through the list from the search box or an item,
  //     Enter pastes (first match from the search box, focused item otherwise).
  const items = () => /** @type {HTMLElement[]} */ (Array.from(listEl.querySelectorAll(".template-item")));
  function moveFocus(delta) {
    const list = items();
    if (!list.length) return;
    const cur = list.indexOf(/** @type {any} */ (document.activeElement));
    const next = cur < 0 ? (delta > 0 ? 0 : list.length - 1) : (cur + delta + list.length) % list.length;
    list[next].focus();
    list[next].scrollIntoView({ block: "nearest" });
  }
  const navKeys = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveFocus(1); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); moveFocus(-1); return true; }
    return false;
  };

  // --- Search (debounced) ---
  searchEl.addEventListener("input", TL.debounce(() => renderList(searchEl.value), 120));
  searchEl.addEventListener("keydown", (e) => {
    if (navKeys(e)) return;
    if (e.key === "Enter") {
      const first = /** @type {any} */ (listEl.querySelector(".template-item"));
      if (first) { e.preventDefault(); pasteTemplateById(first.dataset.id); }
    }
  });

  async function pasteTemplateById(id) {
    const tpl = allTemplates.find((x) => x.id === id);
    if (!tpl) return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    if (TL.isSystemUrl(tab.url)) {
      showPopupError(TL.t("popupSystemPage"));
      return;
    }
    try {
      await TL.pasteToTab(tab.id, tpl, 200);
      window.close();
    } catch (err) {
      showPopupError(TL.t("popupNoAccess") + " (" + err.message + ")");
    }
  }

  function showPopupError(msg) {
    let errEl = document.getElementById("popup-error");
    if (!errEl) {
      errEl = document.createElement("div");
      errEl.id = "popup-error";
      const footer = document.querySelector(".footer");
      if (footer) document.body.insertBefore(errEl, footer);
      else document.body.appendChild(errEl);
    }
    errEl.textContent = msg;
  }

  document.getElementById("options-link").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  allTemplates = templateList;
  folders = folderList;
  renderChips();
  renderList();
  searchEl.focus();
})();
