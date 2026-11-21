(function () {
  var root = document.documentElement;
  var TAGS = { en: "en", zh: "zh-CN", de: "de" };
  // <title> is the English one; data-title-zh / data-title-de on <html> hold the others.
  var EN_TITLE = document.title;
  // A page offers the languages it has buttons for; a choice a page lacks falls
  // back to English there. Every page has all three today.
  function offered(l) { return Boolean(document.getElementById("lang-" + l)); }
  function setLang(l) {
    if (!offered(l)) l = "en";
    root.setAttribute("data-lang", l);
    root.setAttribute("lang", TAGS[l]);
    document.title = l === "en" ? EN_TITLE : root.getAttribute("data-title-" + l) || EN_TITLE;
    document.querySelectorAll(".lang button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-set") === l));
    });
  }
  function choose(l) {
    setLang(l);
    try { localStorage.setItem("ftm-lang", l); } catch { /* storage blocked: the choice lasts this visit */ }
  }
  var start = "";
  try { start = localStorage.getItem("ftm-lang") || ""; } catch { /* storage blocked: fall back to the browser's language */ }
  if (!TAGS[start]) start = (navigator.language || "").toLowerCase().slice(0, 2);
  // setLang, not choose: a fallback to English on a page without the stored
  // language must not overwrite the choice for the pages that have it.
  setLang(start);
  document.querySelectorAll(".lang button").forEach(function (b) {
    b.addEventListener("click", function () { choose(b.getAttribute("data-set")); });
  });
  // The copy button is on the home page only. The address is written once, in
  // index.html, so the page works without this script.
  var copy = document.getElementById("copy-email");
  if (!copy) return;
  var EMAIL = document.getElementById("email-link").textContent;
  copy.addEventListener("click", function () {
    var s = document.getElementById("copy-status");
    var l = root.getAttribute("data-lang");
    var ok = { en: "Copied", zh: "已复制", de: "Kopiert" }[l];
    var no = { en: "Copy the address above by hand", zh: "请手动复制上面的地址", de: "Bitte kopieren Sie die Adresse oben von Hand" }[l];
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(EMAIL).then(function () { s.textContent = ok; }, function () { s.textContent = no; });
    } else { s.textContent = no; }
  });
})();
