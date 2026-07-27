// ============================================================================
// Shared UI: the sticky header (nav + live exp counters + tier badge),
// the DB-validation banner, small DOM helpers, and toast notifications.
// ============================================================================

(function () {
  var Engine = window.Engine, State = window.State, CONFIG = window.CONFIG;

  // Tiny element builder: el("div", "cls", "text")
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderHeader(activePage, opts) {
    opts = opts || {};
    var host = document.getElementById("app-header");
    if (!host) return;
    var state = State.get();
    var spent = Engine.computeSpent(state);
    var tier = CONFIG.TIERS[Engine.currentTierIndex(state)];

    // Pages live in different folders (the editor sits outside the deployable
    // site), so nav links are resolved against a base. Public pages use "";
    // the editor passes "../public/" so its links point back into the site.
    var base = opts.linkBase || "";

    host.innerHTML = "";
    var bar = el("div", "header-bar");

    var brand = el("a", "brand");
    brand.href = base + "index.html";
    brand.appendChild(el("span", "brand-mark", "❖"));
    var bt = el("span", "brand-text");
    bt.appendChild(el("span", "brand-name", "Aetherweave"));
    bt.appendChild(el("span", "brand-sub", "Talent Calculator"));
    brand.appendChild(bt);
    bar.appendChild(brand);

    if (opts.minimal) {
      // Character creation: the saved character isn't meaningful yet, so show
      // a label instead of counters that would describe the previous character.
      bar.appendChild(el("div", "header-mode", "Character Creation"));
      host.appendChild(bar);
      return;
    }

    // The Editor is a dev-only tool and is not deployed, so the public pages
    // never link to it — only the editor's own header links back to the site.
    var nav = el("nav", "nav");
    [{ href: "index.html", label: "Talent Trees", key: "trees" },
     { href: "sheet.html", label: "Character Sheet", key: "sheet" }].forEach(function (l) {
      var a = el("a", "nav-link" + (l.key === activePage ? " active" : ""), l.label);
      a.href = base + l.href;
      nav.appendChild(a);
    });
    bar.appendChild(nav);

    // The editor has no character context: it shows the nav (linking back into
    // the site) plus a mode label, but no exp counters.
    if (opts.editor) {
      bar.appendChild(el("div", "header-mode", "Database Editor"));
      host.appendChild(bar);
      return;
    }

    var counters = el("div", "counters");
    counters.appendChild(expCounter("⚔", "Combat", spent.combat, state.expEarned.combat));
    counters.appendChild(expCounter("❖", "Non-combat", spent.noncombat, state.expEarned.noncombat));
    var badge = el("div", "tier-badge");
    badge.appendChild(el("span", "tier-badge-label", "Tier of play"));
    badge.appendChild(el("span", "tier-badge-value", tier ? tier.name : "—"));
    counters.appendChild(badge);
    bar.appendChild(counters);

    host.appendChild(bar);
  }

  // Character creation runs before anything else. Until it is completed (or
  // explicitly skipped for prototyping) both other pages sit behind this gate.
  function renderCreationGate() {
    var state = State.get();
    var c = state.creation || {};
    if (c.completed || c.skipped) return false;

    var overlay = el("div", "gate-overlay");
    var card = el("div", "gate-card");
    card.appendChild(el("div", "gate-icon", "❖"));
    card.appendChild(el("h2", "gate-title", "Create your character first"));
    card.appendChild(el("p", "gate-text",
      "Aetherweave characters are built in six prompted steps — characteristics, ancestry, " +
      "source of power, and starting training. None of it costs experience."));

    var row = el("div", "gate-actions");
    var go = el("a", "btn btn-primary", "Begin character creation");
    go.href = "create.html";
    row.appendChild(go);

    // Straight to a fully rolled character; the wizard reads ?random=1.
    var rand = el("a", "btn", "🎲 Random character");
    rand.href = "create.html?random=1";
    row.appendChild(rand);

    var skip = el("button", "btn", "Skip for now"); skip.type = "button";
    skip.onclick = function () {
      State.update(function (s) { s.creation.skipped = true; });
      overlay.remove();
    };
    row.appendChild(skip);
    card.appendChild(row);
    card.appendChild(el("div", "gate-note",
      "Skipping leaves the sheet blank so you can prototype trees directly."));

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    return true;
  }

  function expCounter(icon, label, spent, earned) {
    var remaining = (Number(earned) || 0) - spent;
    var c = el("div", "exp-counter");
    c.appendChild(el("span", "exp-icon", icon));
    var body = el("div", "exp-body");
    body.appendChild(el("div", "exp-label", label));
    var nums = el("div", "exp-nums");
    nums.appendChild(el("span", "exp-spent", spent));
    nums.appendChild(el("span", "exp-sep", "/"));
    nums.appendChild(el("span", "exp-earned", Number(earned) || 0));
    nums.appendChild(el("span", "exp-remaining" + (remaining < 0 ? " negative" : ""), "(" + remaining + ")"));
    body.appendChild(nums);
    c.appendChild(body);
    return c;
  }

  // Shown once when the browser refuses to persist anything — typically a page
  // opened straight from disk. The character still works for this tab (see the
  // window.name fallback in state.js), but it will not survive closing it.
  function renderStorageWarning() {
    if (window.SafeStorage.persistent) return;
    // Anchor on the header, which every page has (the DB-validation banner is
    // editor-only, so we can't rely on it being present).
    var header = document.getElementById("app-header");
    if (!header || document.getElementById("storage-warning")) return;

    var box = el("div", "storage-warning");
    box.id = "storage-warning";
    box.appendChild(el("div", "sw-head", "⚠ This browser won't save your character permanently"));
    var p = el("div", "sw-text");
    p.appendChild(document.createTextNode(
      "The page was opened directly from disk, so the browser blocks persistent storage. " +
      "Your character is kept for this browser tab only, and will be lost when you close it. " +
      "To save between sessions, serve the folder over http — run "));
    p.appendChild(el("code", null, "tools\\serve.ps1"));
    p.appendChild(document.createTextNode(" and open http://localhost:8777/ — or use Export JSON on the character sheet."));
    box.appendChild(p);
    header.parentNode.insertBefore(box, header.nextSibling);
  }

  function renderValidation() {
    var host = document.getElementById("validation-banner");
    if (!host) return;
    var problems = Engine.validateDB();
    host.innerHTML = "";
    if (!problems.length) { host.style.display = "none"; return; }
    host.style.display = "";
    host.appendChild(el("div", "vb-head", "⚠ Talent database has " + problems.length + " problem(s) — check your data files:"));
    var ul = el("ul", "vb-list");
    problems.slice(0, 25).forEach(function (p) { ul.appendChild(el("li", null, p)); });
    host.appendChild(ul);
    console.warn("Aetherweave DB validation:\n  - " + problems.join("\n  - "));
  }

  // ---- Toasts -------------------------------------------------------------
  var toastHost;
  function toast(msg, kind) {
    if (!toastHost) { toastHost = el("div", "toast-host"); document.body.appendChild(toastHost); }
    var t = el("div", "toast" + (kind ? " " + kind : ""), msg);
    toastHost.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("show"); });
    setTimeout(function () {
      t.classList.remove("show");
      setTimeout(function () { t.remove(); }, 300);
    }, 3000);
  }

  // ---- Modal --------------------------------------------------------------
  // A lightweight content modal for the play pages (the editor has its own,
  // richer `dialog`). `buildBody(body, close)` fills the content and may use
  // `close` to dismiss it; Escape and a click on the backdrop also close.
  function modal(title, buildBody) {
    var overlay = el("div", "modal-overlay");
    var card = el("div", "modal-card");
    var head = el("div", "modal-head");
    head.appendChild(el("h2", "modal-title", title));
    var x = el("button", "modal-close", "✕");
    x.type = "button"; x.setAttribute("aria-label", "Close"); x.onclick = close;
    head.appendChild(x);
    card.appendChild(head);
    var body = el("div", "modal-body");
    card.appendChild(body);
    overlay.appendChild(card);
    overlay.onclick = function (ev) { if (ev.target === overlay) close(); };
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    function onKey(ev) { if (ev.key === "Escape") close(); }
    function close() { document.removeEventListener("keydown", onKey); overlay.remove(); }
    buildBody(body, close);
    return { close: close, body: body };
  }

  // Wire an #export-pdf button to the browser's print → "Save as PDF". A print
  // stylesheet (css/style.css) reshapes the page for paper. `getTitle` sets the
  // document title so the saved file gets a sensible name.
  function bindPrint(getTitle) {
    var btn = document.getElementById("export-pdf");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var prev = document.title;
      if (getTitle) { try { var t = getTitle(); if (t) document.title = t; } catch (e) {} }
      var restore = function () { document.title = prev; window.removeEventListener("afterprint", restore); };
      window.addEventListener("afterprint", restore);
      setTimeout(restore, 2000);       // fallback if afterprint doesn't fire
      window.print();
    });
  }

  window.UI = {
    el: el,
    bindPrint: bindPrint,
    renderHeader: renderHeader,
    renderValidation: renderValidation,
    renderStorageWarning: renderStorageWarning,
    renderCreationGate: renderCreationGate,
    toast: toast,
    modal: modal,
  };
})();
