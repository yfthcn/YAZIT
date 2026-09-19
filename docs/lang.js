// Shared EN/TR toggle for the YAZIT product + privacy pages.
// Elements carry data-en / data-tr; the switch buttons carry data-lang.
(function () {
  var els = document.querySelectorAll("[data-en]");
  function setLang(lang) {
    document.documentElement.lang = lang;
    els.forEach(function (el) {
      var v = el.getAttribute("data-" + lang);
      if (v != null) el.textContent = v;
    });
    document.querySelectorAll(".lang-switch button").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-lang") === lang);
    });
    try { localStorage.setItem("tl-lang", lang); } catch (e) {}
  }
  document.querySelectorAll(".lang-switch button").forEach(function (b) {
    b.addEventListener("click", function () { setLang(b.getAttribute("data-lang")); });
  });
  var saved = null;
  try { saved = localStorage.getItem("tl-lang"); } catch (e) {}
  var lang = saved || ((navigator.language || "en").toLowerCase().indexOf("tr") === 0 ? "tr" : "en");
  setLang(lang);
})();
