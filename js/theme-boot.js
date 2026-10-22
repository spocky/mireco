// Applies the saved theme before the first paint so the page doesn't flash
// in the wrong theme while the ES modules load. Classic script on purpose
// (runs synchronously in <head>); keep in sync with js/themes.js.
(function () {
  var root = document.documentElement;
  var theme = null;
  var bg = null;
  var bt = null;
  try {
    theme = localStorage.getItem("mireco.theme");
    bg = localStorage.getItem("mireco.bgColor");
    bt = localStorage.getItem("mireco.btColor");
    // Existing users without a saved theme keep the original look.
    if (!theme && (localStorage.getItem("mireco.deviceIP") !== null || /(^|;\s*)deviceIP=/.test(document.cookie))) {
      theme = "classic";
    }
  } catch (e) {
    // storage blocked: default theme
  }
  if (!/^(ember|leanback|frost|classic)$/.test(theme || "")) theme = "ember";
  root.setAttribute("data-theme", theme);
  if (bg) root.style.setProperty("--main-bg-color", bg);
  if (bt) root.style.setProperty("--main-color", bt);
})();
