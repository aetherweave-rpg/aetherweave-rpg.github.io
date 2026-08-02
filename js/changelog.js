// ============================================================================
// Changelog page (changelog-content.html / changelog-rules.html). Which data
// this renders is picked by <body data-changelog="content|rules">, so both
// pages share one script.
// ============================================================================

(function () {
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function render() {
    var kind = document.body.getAttribute("data-changelog");
    var data = (kind === "rules" ? window.CHANGELOG_RULES : window.CHANGELOG_CONTENT) || [];
    var host = document.getElementById("changelog");
    host.innerHTML = "";

    if (!data.length) {
      host.appendChild(el("p", "changelog-empty", "No changes recorded yet."));
      return;
    }

    data.forEach(function (group) {
      var section = el("section", "changelog-entry");
      section.appendChild(el("h2", "changelog-date", group.date));
      var ul = el("ul", "changelog-list");
      (group.entries || []).forEach(function (line) { ul.appendChild(el("li", null, line)); });
      section.appendChild(ul);
      host.appendChild(section);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    UI.renderHeader("changelog");
    UI.renderFooter();
    render();
  });
})();
