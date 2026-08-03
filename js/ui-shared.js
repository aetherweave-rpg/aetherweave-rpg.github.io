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
     { href: "spells.html", label: "Spells", key: "spells" },
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

  // Small footnote-style links to the two changelogs, shown at the foot of
  // every public page. `base` mirrors renderHeader's link-base handling.
  function renderFooter(opts) {
    opts = opts || {};
    var host = document.getElementById("app-footer");
    if (!host) return;
    var base = opts.linkBase || "";

    host.innerHTML = "";
    var bar = el("div", "footer-bar");
    bar.appendChild(el("span", "footer-label", "Changelog:"));
    var content = el("a", "footer-link", "Content changes");
    content.href = base + "changelog-content.html";
    bar.appendChild(content);
    bar.appendChild(el("span", "footer-sep", "·"));
    var rules = el("a", "footer-link", "Rulebook changes");
    rules.href = base + "changelog-rules.html";
    bar.appendChild(rules);
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
      "Aetherweave characters are built in six prompted steps: characteristics, ancestry, " +
      "source of power, and starting training. "));

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
      "The page was opened from disk, so the browser blocks persistent storage. " +
      "Your character is kept for this tab only and lost when you close it. " +
      "To save between sessions, run "));
    p.appendChild(el("code", null, "tools\\serve.ps1"));
    p.appendChild(document.createTextNode(" and open http://localhost:8777/, or use Export JSON."));
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
    host.appendChild(el("div", "vb-head", "⚠ Talent database has " + problems.length + " problem(s):"));
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

  // ---- Grant picker -------------------------------------------------------
  // Opened when learning something that hands out a choice (DESIGN.md §4.9).
  // The choice is part of the purchase: `onConfirm(keys)` runs only for a
  // complete, legal selection, and dismissing cancels the purchase outright.
  // An option the character already has stays selectable on purpose. That is
  // the refund path: picking it moves it into the granted baseline, so
  // computeSpent stops charging for what they paid.
  function grantPicker(entry, state, onConfirm) {
    var g = Engine.grantsOf(entry);
    var options = Engine.grantOptions(entry, state);
    var chosen = {};

    return modal(entry.name + " grants", function (body, close) {
      body.appendChild(el("p", "modal-lede", g.mode === "budget"
        ? "Spend up to " + g.count + " exp on the following. They cost you nothing."
        : "Choose " + g.count + ". They cost you nothing."));

      var list = el("div", "grant-list");
      var footer = el("div", "modal-actions");
      var tally = el("span", "grant-tally");
      var confirm = el("button", "btn btn-primary", "Confirm");
      confirm.type = "button";
      var cancel = el("button", "btn", "Cancel");
      cancel.type = "button";
      cancel.onclick = close;

      function selectedKeys() {
        return options.filter(function (o) { return chosen[o.key]; }).map(function (o) { return o.key; });
      }
      function refresh() {
        var keys = selectedKeys();
        var used = options.filter(function (o) { return chosen[o.key]; })
          .reduce(function (n, o) { return n + o.cost; }, 0);
        tally.textContent = g.mode === "budget"
          ? used + " of " + g.count + " exp"
          : keys.length + " of " + g.count + " chosen";
        var check = Engine.grantSelectionValid(entry, state, keys);
        confirm.disabled = !check.ok;
        tally.className = "grant-tally" + (check.ok ? " ok" : "");
        drawRows();
      }

      function drawRows() {
        list.innerHTML = "";
        options.forEach(function (o) {
          var picked = !!chosen[o.key];
          var row = el("label", "grant-row" +
            (picked ? " picked" : "") + (o.available ? "" : " blocked") + (o.owned ? " owned" : ""));
          var cb = el("input");
          cb.type = "checkbox";
          cb.checked = picked;
          cb.disabled = !o.available;
          cb.onchange = function () {
            if (cb.checked) chosen[o.key] = true; else delete chosen[o.key];
            refresh();
          };
          row.appendChild(cb);

          var info = el("div", "grant-info");
          var line = el("span", "grant-name", o.label);
          if (o.note) line.appendChild(el("span", "grant-note", o.note));
          if (o.cost) line.appendChild(el("span", "grant-cost", o.cost + " exp"));
          info.appendChild(line);
          if (o.owned)
            info.appendChild(el("span", "grant-warn", "Already known. Picking it refunds the exp you spent."));
          else if (!o.available)
            info.appendChild(el("span", "grant-blocked", o.blocked || "You do not qualify yet."));
          row.appendChild(info);
          list.appendChild(row);
        });
      }

      confirm.onclick = function () {
        var keys = selectedKeys();
        if (!Engine.grantSelectionValid(entry, state, keys).ok) return;
        close();
        onConfirm(keys);
      };

      body.appendChild(list);
      footer.appendChild(tally);
      footer.appendChild(cancel);
      footer.appendChild(confirm);
      body.appendChild(footer);
      refresh();
    });
  }

  // Wire an #export-pdf button to the browser's print → "Save as PDF". The page
  // does not print itself: js/print-sheet.js builds a separate paper document
  // that the print stylesheet swaps in (css/style.css). `getTitle` sets the
  // document title so the saved file gets a sensible name, and `prepare` is the
  // page's chance to refresh that document first.
  //
  // `prepare` also runs on `beforeprint`, so Ctrl+P is as correct as the button.
  // It has to: the sheet saves some edits silently (typing a name must not
  // re-render under the cursor), so what is on screen can be one keystroke
  // ahead of what was last built for paper.
  function bindPrint(getTitle, prepare) {
    if (prepare) window.addEventListener("beforeprint", function () { safely(prepare); });
    var btn = document.getElementById("export-pdf");
    if (!btn) return;
    btn.addEventListener("click", function () {
      if (prepare) safely(prepare);
      var prev = document.title;
      if (getTitle) { try { var t = getTitle(); if (t) document.title = t; } catch (e) {} }
      var restore = function () { document.title = prev; window.removeEventListener("afterprint", restore); };
      window.addEventListener("afterprint", restore);
      setTimeout(restore, 2000);       // fallback if afterprint doesn't fire
      window.print();
    });
  }

  // A failure while preparing the paper copy must not cost the user the print
  // dialog — they would still rather have a stale sheet than none.
  function safely(fn) { try { fn(); } catch (e) { console.warn("Aetherweave print prepare failed:", e); } }

  window.UI = {
    el: el,
    bindPrint: bindPrint,
    renderHeader: renderHeader,
    renderFooter: renderFooter,
    renderValidation: renderValidation,
    renderStorageWarning: renderStorageWarning,
    renderCreationGate: renderCreationGate,
    toast: toast,
    modal: modal, grantPicker: grantPicker,
  };
})();
