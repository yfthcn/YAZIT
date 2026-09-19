// @ts-check
// ==============================
// YAZIT — Theme bootstrap for the extension pages (popup, options)
// ==============================
// Loaded from <head>, BEFORE the body is parsed, so the first paint already
// has the right palette. chrome.storage is async and would land after that
// paint (a light→dark flash on every popup open), so the choice is mirrored
// into this origin's localStorage and read synchronously here; storage.local
// ("uiTheme") stays the source of truth and corrects the mirror right after.
//
// The page CSS only knows two palettes: the light tokens on :root and the
// dark ones under :root[data-theme="dark"]. This script always sets
// data-theme to the RESOLVED theme, so "auto" is just "follow matchMedia" and
// the dark tokens exist once per page instead of twice (media query + override).
//
// Standalone on purpose: common.js is not loaded yet, so the normalisation
// rule is a copy of TL.normalizeTheme (kept in lockstep by the unit tests).
// ==============================

(function () {
  "use strict";

  const MIRROR_KEY = "yazit.uiTheme";
  const root = document.documentElement;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  /** @type {"auto"|"light"|"dark"} */
  let pref = "auto";

  /** @param {unknown} v @returns {"auto"|"light"|"dark"} */
  const norm = (v) => (v === "light" || v === "dark" ? v : "auto");

  function apply() {
    root.dataset.theme = pref === "auto" ? (mq.matches ? "dark" : "light") : pref;
  }

  /** @param {unknown} v */
  function use(v) {
    pref = norm(v);
    apply();
    try { localStorage.setItem(MIRROR_KEY, pref); } catch (_) { /* storage blocked → no mirror */ }
  }

  try { pref = norm(localStorage.getItem(MIRROR_KEY)); } catch (_) { /* first run / blocked */ }
  apply();

  // OS theme flips while the page is open (e.g. scheduled dark mode).
  mq.addEventListener("change", () => { if (pref === "auto") apply(); });

  try {
    chrome.storage.local.get("uiTheme").then(({ uiTheme }) => use(uiTheme), () => {});
    // Fires in every open extension page, including the one that wrote it —
    // so the options page, an open popup and other options tabs all follow.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.uiTheme) use(changes.uiTheme.newValue);
    });
  } catch (_) { /* no extension APIs (opened as a plain file) — mirror only */ }
})();
