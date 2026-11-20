(function () {
  // The address is written once, in index.html, so the page works without this script.
  var link = document.getElementById("email-link");
  var EMAIL = link.textContent;
  var root = document.documentElement;
  function setLang(l) {
    root.setAttribute("data-lang", l);
    root.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
    document.getElementById("lang-en").setAttribute("aria-pressed", String(l === "en"));
    document.getElementById("lang-zh").setAttribute("aria-pressed", String(l === "zh"));
    try { localStorage.setItem("ftm-lang", l); } catch { /* storage blocked: the choice lasts this visit */ }
  }
  var start = "";
  try { start = localStorage.getItem("ftm-lang") || ""; } catch { /* storage blocked: fall back to the browser's language */ }
  if (!start) start = (navigator.language || "").toLowerCase().indexOf("zh") === 0 ? "zh" : "en";
  setLang(start);
  document.querySelectorAll(".lang button").forEach(function (b) {
    b.addEventListener("click", function () { setLang(b.getAttribute("data-set")); });
  });
  document.getElementById("copy-email").addEventListener("click", function () {
    var s = document.getElementById("copy-status");
    var ok = root.getAttribute("data-lang") === "zh" ? "已复制" : "Copied";
    var no = root.getAttribute("data-lang") === "zh" ? "请手动复制上面的地址" : "Copy the address above by hand";
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(EMAIL).then(function () { s.textContent = ok; }, function () { s.textContent = no; });
    } else { s.textContent = no; }
  });
})();
