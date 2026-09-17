// ============================================================================
// Shared UI: the sticky header (nav + live exp counters + tier badge),
// the DB-validation banner, small DOM helpers, toast notifications, modals, and
// the reminder of what is left to spend after character creation.
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
      a.dataset.page = l.key;
      // Talent exp is spent on the trees page, so that is where the reminder
      // after creation points (see "Spend reminder" below).
      if (l.key === "trees" && !opts.editor) {
        var arrow = reminderArrow(state, "talent", "below");
        if (arrow) a.appendChild(arrow);
      }
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
    Engine.EXP_POOLS.forEach(function (p) {
      var c = expCounter(p.icon, p.label + " exp", spent[p.id], (state.expEarned || {})[p.id]);
      c.dataset.pool = p.id;
      counters.appendChild(c);
    });
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
      "Aetherweave characters are built in eight prompted steps: characteristics, ancestry, " +
      "source of power, a defining trait, a background, and starting training. "));

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
  // `onClose` runs once, however it was closed.
  function modal(title, buildBody, onClose) {
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
    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      if (onClose) onClose();
    }
    buildBody(body, close);
    return { close: close, body: body };
  }

  // ---- Grant chooser ------------------------------------------------------
  // The option rows for a grant (DESIGN.md §4.9), rendered into `host`. Shared
  // by the learn-time modal below and the creation wizard's inline section, so
  // both offer and validate exactly the same thing.
  //
  // An option the character already has stays selectable on purpose. That is
  // the refund path: picking it moves it into the granted baseline, so
  // computeSpent stops charging for what they paid.
  //
  // `onState(ok, keys)` fires on every change, INCLUDING once during setup.
  // Pass `initialKeys` to seed the selection: a caller that re-renders (the
  // wizard does, constantly) would otherwise see that setup call report an
  // empty selection and overwrite the very keys it was about to restore.
  function grantChooser(host, entry, state, onState, initialKeys) {
    var g = Engine.grantsOf(entry);
    var options = Engine.grantOptions(entry, state);
    var chosen = {};
    (initialKeys || []).forEach(function (k) { chosen[k] = true; });

    var list = el("div", "grant-list");
    var tally = el("span", "grant-tally");

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
      tally.className = "grant-tally" + (check.ok ? " ok" : "");
      drawRows();
      if (onState) onState(check.ok, keys);
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

    host.appendChild(list);
    refresh();
    return {
      tally: tally,
      setKeys: function (keys) {
        chosen = {};
        (keys || []).forEach(function (k) { chosen[k] = true; });
        refresh();
      },
    };
  }

  function grantLede(entry) {
    var g = Engine.grantsOf(entry);
    return g.mode === "budget"
      ? "Spend up to " + g.count + " exp on the following. They cost you nothing."
      : "Choose " + g.count + ". They cost you nothing.";
  }

  // Opened when learning something that hands out a choice. The choice is part
  // of the purchase: `onConfirm(keys)` runs only for a complete, legal
  // selection, and dismissing cancels the purchase outright.
  function grantPicker(entry, state, onConfirm) {
    return modal(entry.name + " grants", function (body, close) {
      body.appendChild(el("p", "modal-lede", grantLede(entry)));

      var confirm = el("button", "btn btn-primary", "Confirm");
      confirm.type = "button";
      var cancel = el("button", "btn", "Cancel");
      cancel.type = "button";
      cancel.onclick = close;

      var picked = [];
      var chooser = grantChooser(body, entry, state, function (ok, keys) {
        confirm.disabled = !ok;
        picked = keys;
      });

      confirm.onclick = function () { close(); onConfirm(picked); };

      var footer = el("div", "modal-actions");
      footer.appendChild(chooser.tally);
      footer.appendChild(cancel);
      footer.appendChild(confirm);
      body.appendChild(footer);
    });
  }

  // ---- Spend reminder -----------------------------------------------------
  // Character creation ends with exp still unspent: whatever skill exp the
  // training minimums left over, and all of the talent exp. So the sheet opens
  // on a pop-up saying how much is left, and closing it leaves arrows on the
  // places each pool is spent: the Skills section for skill exp, the Talent
  // Trees link for talent exp. An arrow goes away when it is clicked or its
  // pool runs out. A checkbox in the pop-up turns the whole thing off for every
  // later character, which is why that choice lives in the browser rather than
  // on the character.
  //
  // create.js queues it on Finish and the sheet takes it on load, because the
  // wizard page has neither a nav nor a skills section to point at.
  var REMINDER_PENDING_KEY = "aetherweave.ui.spendReminderPending";
  var REMINDER_OFF_KEY = "aetherweave.ui.spendReminderOff";
  var reminderArrows = {};   // pool id -> true while its arrow is showing

  function queueSpendReminder() {
    window.SafeStorage.write(REMINDER_PENDING_KEY, "1");
  }
  function spendReminderOff() {
    return window.SafeStorage.read(REMINDER_OFF_KEY) === "1";
  }

  // The pools with exp left, in EXP_POOLS order: [{ pool, left }].
  function poolsWithExpLeft(state) {
    var left = Engine.expRemaining(state);
    return Engine.EXP_POOLS.filter(function (p) { return left[p.id] > 0; })
      .map(function (p) { return { pool: p, left: left[p.id] }; });
  }

  // Called once by the sheet on load. Opens the pop-up if Finish queued one,
  // the player has not turned it off, and there is something left to spend.
  // `rerender` redraws the page once the arrows are set. Returns the modal, or
  // null when nothing opened.
  function takeSpendReminder(rerender) {
    if (window.SafeStorage.read(REMINDER_PENDING_KEY) !== "1") return null;
    window.SafeStorage.write(REMINDER_PENDING_KEY, "0");
    var state = State.get();
    var pending = poolsWithExpLeft(state);
    if (spendReminderOff() || !pending.length) return null;

    return modal("Exp left to spend", function (body, close) {
      body.appendChild(el("p", "modal-lede", "Your character is ready. You still have:"));
      var list = el("div", "reminder-list");
      pending.forEach(function (row) {
        var line = el("div", "reminder-row");
        line.dataset.pool = row.pool.id;
        line.appendChild(el("span", "reminder-icon", row.pool.icon));
        var text = el("div", "reminder-text");
        text.appendChild(el("span", "reminder-amount", row.left + " " + row.pool.label.toLowerCase() + " exp"));
        text.appendChild(el("span", "reminder-where", row.pool.id === "skill"
          ? "Raise skills and proficiencies on this sheet."
          : "Learn talents on the Talent Trees page."));
        line.appendChild(text);
        list.appendChild(line);
      });
      body.appendChild(list);

      var footer = el("div", "modal-actions");
      var skip = el("label", "reminder-skip");
      var cb = el("input");
      cb.type = "checkbox";
      cb.onchange = function () { window.SafeStorage.write(REMINDER_OFF_KEY, cb.checked ? "1" : "0"); };
      skip.appendChild(cb);
      skip.appendChild(el("span", null, "Don't show this again"));
      footer.appendChild(skip);
      var go = el("button", "btn btn-primary", "Show me where");
      go.type = "button";
      go.onclick = close;
      footer.appendChild(go);
      body.appendChild(footer);
    }, function onClose() {
      // However it is closed, the arrows are the instruction it promised.
      pending.forEach(function (row) { reminderArrows[row.pool.id] = true; });
      if (rerender) rerender();
    });
  }

  // The arrow for one pool, or null when it is not showing. `side` says where
  // it sits relative to what it points at: "below" hangs under a nav link and
  // points up at it, "after" follows a heading and points back at it. An arrow
  // whose pool has run out removes itself.
  function reminderArrow(state, poolId, side) {
    if (!reminderArrows[poolId]) return null;
    var left = Engine.expRemaining(state)[poolId];
    if (!(left > 0)) { delete reminderArrows[poolId]; return null; }
    var pool = Engine.EXP_POOLS.filter(function (p) { return p.id === poolId; })[0];
    var arrow = el("span", "spend-arrow spend-arrow-" + side);
    arrow.dataset.pool = poolId;
    arrow.title = "Dismiss";
    arrow.appendChild(el("span", "spend-arrow-head", side === "below" ? "▲" : "◀"));
    arrow.appendChild(el("span", "spend-arrow-text", "Spend " + left + " " + pool.label.toLowerCase() + " exp here"));
    arrow.onclick = function (ev) {
      // Inside a nav link, a click on the arrow is a dismissal, not navigation.
      ev.preventDefault();
      ev.stopPropagation();
      delete reminderArrows[poolId];
      if (arrow.parentNode) arrow.parentNode.removeChild(arrow);
    };
    return arrow;
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

  // One chip per tag an ability carries (§4.6: "Magic"), for any surface that
  // lists an ability's tags. The class names the tag, so a tag can be styled.
  function tagChips(entry) {
    return Engine.entryTags(entry).map(function (id) {
      return el("span", "ability-tag tag-" + id, Engine.tagLabel(id));
    });
  }

  // The roll an ability is used with, and the ladder of effects read off it
  // (§4.10). One renderer for all the screen surfaces — the tree tooltip, the
  // sheet's expanded rows and the creation cards — so a tier can never read
  // one way in the tooltip and another on the sheet. The paper sheet builds its
  // own markup from the same Engine data.
  // Returns null when the entry has nothing to show.
  function renderTest(entry, state, opts) {
    opts = opts || {};
    var label = Engine.testLabel(entry, state);
    var tiers = Engine.testTiers(entry, state);
    var desc = Engine.testDescriptor(entry, state);
    var vsLabel = desc ? desc.vsLabel : "";
    if (!label && !tiers.length && !vsLabel) return null;

    var wrap = el("div", "ability-test" + (opts.cls ? " " + opts.cls : ""));
    var d = desc;
    // A weapon attack lists the weapons on the sheet it works with, each with
    // its own pool, so one summary number next to the roll would be a fourth
    // number nobody asked for. Everything else has exactly one pool.
    // An ability that only defers its DEFENSE to the weapon lists them too, but
    // without dice: it makes no roll of its own, so a pool would be a number
    // the player never actually rolls.
    var perWeapon = !!(d && (d.wielded || d.vsWielded) && d.weapons.length);
    var perWeaponPool = !!(d && d.wielded);
    var line = el("div", "ability-test-roll");
    if (label) {
      line.appendChild(el("span", "att-lede", "Test"));
      line.appendChild(el("span", "att-roll", label));
    } else if (tiers.length) {
      // A ladder with no roll of its own (a modifier's, or a talent reading the
      // successes of a roll its text names) still needs saying what the numbers
      // in the left column are.
      line.appendChild(el("span", "att-roll", "Successes"));
    } else {
      // Neither a roll nor a ladder, just a defense: there is no column of
      // numbers to head, so heading one would name something that isn't there.
      line.appendChild(el("span", "att-lede", "Test"));
    }
    // The defense is subtracted from the successes rolled, so it belongs next
    // to the roll and ahead of the ladder those successes are read against.
    if (vsLabel) line.appendChild(el("span", "att-vs", "vs " + vsLabel));
    if (label && !perWeapon && d && d.pool != null) line.appendChild(el("span", "att-pool", d.pool + " dice"));
    wrap.appendChild(line);
    if (perWeapon) {
      var wl = el("div", "ability-test-weapons");
      d.weapons.forEach(function (w) {
        var row = el("div", "ability-test-weapon");
        row.appendChild(el("span", "atw-name", w.name ? w.name + " (" + w.label + ")" : w.label));
        // Only when the ability defers to the weapon: otherwise the defense is
        // the same for every row and already sits on the roll line above.
        if (d.vsWielded && w.damageLabel) row.appendChild(el("span", "att-vs", "vs " + w.damageLabel));
        if (perWeaponPool) row.appendChild(el("span", "att-pool", w.pool + " dice"));
        wl.appendChild(row);
      });
      wrap.appendChild(wl);
    }
    if (tiers.length) {
      var list = el("div", "ability-test-tiers");
      tiers.forEach(function (row) {
        var r = el("div", "ability-test-tier");
        r.appendChild(el("span", "att-n", row.successes + "+"));
        r.appendChild(el("span", "att-effect", row.effect));
        list.appendChild(r);
      });
      wrap.appendChild(list);
    }
    return wrap;
  }

  window.UI = {
    el: el,
    renderTest: renderTest,
    tagChips: tagChips,
    bindPrint: bindPrint,
    renderHeader: renderHeader,
    renderFooter: renderFooter,
    renderValidation: renderValidation,
    renderStorageWarning: renderStorageWarning,
    renderCreationGate: renderCreationGate,
    toast: toast,
    modal: modal, grantPicker: grantPicker, grantChooser: grantChooser, grantLede: grantLede,
    // the reminder after character creation
    queueSpendReminder: queueSpendReminder, takeSpendReminder: takeSpendReminder,
    reminderArrow: reminderArrow, spendReminderOff: spendReminderOff,
  };
})();
