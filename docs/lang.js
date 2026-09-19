// Shared EN/TR switch for the YAZIT product site and privacy page.
// data-en / data-tr        → text content
// data-src-en / data-src-tr → <img> source (screenshots are localised)
// data-alt-en / data-alt-tr → <img> alt text
// The choice is remembered per browser; first visit follows navigator.language.
(function () {
  "use strict";
  var KEY = "yazit-site-lang";
  function setLang(lang) {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-en]").forEach(function (el) {
      var v = el.getAttribute("data-" + lang);
      if (v != null) el.textContent = v;
    });
    document.querySelectorAll("[data-src-en]").forEach(function (el) {
      var v = el.getAttribute("data-src-" + lang);
      if (v && el.getAttribute("src") !== v) el.setAttribute("src", v);
    });
    document.querySelectorAll("[data-alt-en]").forEach(function (el) {
      var v = el.getAttribute("data-alt-" + lang);
      if (v != null) el.setAttribute("alt", v);
    });
    document.querySelectorAll(".lang-switch button").forEach(function (b) {
      var on = b.getAttribute("data-lang") === lang;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    try { localStorage.setItem(KEY, lang); } catch (e) { /* private mode */ }
  }
  document.querySelectorAll(".lang-switch button").forEach(function (b) {
    b.addEventListener("click", function () { setLang(b.getAttribute("data-lang")); });
  });
  var saved = null;
  try { saved = localStorage.getItem(KEY) || localStorage.getItem("tl-lang"); } catch (e) { /* private mode */ }
  var auto = (navigator.language || "en").toLowerCase().indexOf("tr") === 0 ? "tr" : "en";
  setLang(saved === "tr" || saved === "en" ? saved : auto);
})();
