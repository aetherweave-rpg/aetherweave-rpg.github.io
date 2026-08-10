// ============================================================================
// Spells page (spells.html): a domain-tab bar limited to magical domains,
// each showing that domain's spell grid — tier dividers, SVG prerequisite
// lines between spells, node states, click-to-learn/unlearn, and tooltips.
// Talent trees have their own page — see index.html / js/tree.js.
// ============================================================================

(function () {
  var Engine = window.Engine, State = window.State, UI = window.UI, el = UI.el, CONFIG = window.CONFIG;
  var LAST_DOMAIN_KEY = "aetherweave.lastSpellDomain";

  var currentDomain = window.SafeStorage.read(LAST_DOMAIN_KEY) || null;
  var _svg = null, _nodeEls = {}, _view = null, _rowEls = {};

  function init() {
    UI.renderHeader("spells");
    UI.renderFooter();
    UI.renderStorageWarning();
    UI.renderCreationGate();
    renderTabs();
    render();
    State.subscribe(function () { UI.renderHeader("spells"); renderTabs(); render(); });
    window.addEventListener("resize", debounce(drawLines, 80));
    // A tab restored from the background may have skipped its rAF redraw.
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) drawLines();
    });
  }

  // Lines are measured from laid-out nodes, so the redraw has to happen after
  // the browser has positioned them. requestAnimationFrame does that — but it
  // is never called while the tab is hidden, so pair it with a timeout that
  // fires regardless. Both paths are idempotent: drawLines clears and redraws.
  function scheduleDraw() {
    requestAnimationFrame(drawLines);
    setTimeout(drawLines, 0);
  }

  function available() { return Engine.magicalDomains(); }

  // Resolve the current selection to a renderable view of one domain's
  // spells, reshaped to look like grid nodes (id/name/row/col/requires) so
  // they're placed exactly like a talent tree's nodes.
  function buildView(state) {
    var list = available();
    var real = list.filter(function (d) { return d.id === currentDomain; })[0];
    if (!real) {
      real = list[0];
      if (!real) return null;
      currentDomain = real.id;
    }
    var spells = Engine.spellsForDomain(real.id).map(function (sp) {
      var o = {};
      Object.keys(sp).forEach(function (k) { o[k] = sp[k]; });
      o.domain = real.id;
      o.row = sp.row || 0; o.col = sp.col || 0;
      return o;
    });
    return {
      id: real.id, name: real.name, icon: real.icon, accent: real.accent,
      flavour: real.flavour, cols: real.cols, realTree: real,
      spells: spells, colOf: function (sp) { return sp.col || 0; },
    };
  }

  // ---- Tabs ---------------------------------------------------------------
  function renderTabs() {
    var host = document.getElementById("spell-tabs");
    if (!host) return;
    host.innerHTML = "";
    var list = available();
    var view = buildView(State.get());
    var activeId = view ? view.id : null;

    var section = el("div", "tab-group");
    section.appendChild(el("span", "tab-group-label", "Domains"));
    var row = el("div", "tab-row");
    list.forEach(function (d) {
      var b = el("button", "domain-tab" + (activeId === d.id ? " active" : ""));
      b.type = "button";
      b.style.setProperty("--accent", d.accent);
      b.appendChild(el("span", "domain-tab-icon", d.icon));
      b.appendChild(el("span", "domain-tab-name", d.name));
      b.title = d.name;
      b.onclick = function () {
        currentDomain = d.id;
        window.SafeStorage.write(LAST_DOMAIN_KEY, d.id);
        renderTabs();
        render();
      };
      row.appendChild(b);
    });
    section.appendChild(row);
    host.appendChild(section);

    if (!list.length) host.appendChild(el("div", "empty", "No magical domains defined yet."));
  }

  // ---- Grid -----------------------------------------------------------------
  function render() {
    var host = document.getElementById("spell-grid");
    if (!host) return;
    hideTooltip();
    host.innerHTML = "";
    _nodeEls = {};
    _rowEls = {};

    var state = State.get();
    var view = _view = buildView(state);
    if (!view) {
      host.appendChild(el("div", "empty", "No magical domains defined yet."));
      return;
    }
    host.style.setProperty("--accent", view.accent);
    host.style.setProperty("--cols", view.cols);

    host.appendChild(spellHeader(view, state));

    var spells = view.spells;
    if (!spells.length) {
      host.appendChild(el("div", "empty", "No spells defined for this domain yet."));
      return;
    }

    _svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    _svg.setAttribute("class", "tree-lines");
    host.appendChild(_svg);

    var grid = el("div", "tree-grid");
    host.appendChild(grid);

    var maxRow = spells.reduce(function (m, sp) { return Math.max(m, sp.row); }, 0);

    var prevTier = null;
    for (var row = maxRow; row >= 0; row--) {
      var rowSpells = spells.filter(function (sp) { return sp.row === row; });
      if (!rowSpells.length) continue;
      var rowTier = rowSpells[0].tier;

      if (prevTier !== null && rowTier !== prevTier) grid.appendChild(tierDivider(prevTier));
      prevTier = rowTier;

      var rowEl = el("div", "tree-row");
      rowEl.style.setProperty("--cols", view.cols);
      for (var c = 0; c < view.cols; c++) {
        var cell = el("div", "tree-cell");
        var sp = matchAt(rowSpells, view, c);
        if (sp) cell.appendChild(spellNode(sp, state));
        rowEl.appendChild(cell);
      }
      grid.appendChild(rowEl);
      _rowEls[row] = rowEl;   // drawLines widens these when a gap needs lanes
    }

    scheduleDraw();
  }

  function matchAt(rowSpells, view, c) {
    for (var i = 0; i < rowSpells.length; i++) if (view.colOf(rowSpells[i]) === c) return rowSpells[i];
    return null;
  }

  // Banner above the grid: what domain this is, and the effective spell test.
  function spellHeader(view, state) {
    var head = el("div", "tree-head");
    var title = el("div", "tree-head-main");
    title.appendChild(el("span", "tree-head-icon", view.icon));
    var txt = el("div");
    txt.appendChild(el("div", "tree-head-name", view.name));
    if (view.flavour) txt.appendChild(el("div", "tree-head-desc", view.flavour));
    title.appendChild(txt);
    head.appendChild(title);

    var tags = el("div", "tree-head-tags");
    var pool = Engine.spellPool(state, view.id);
    tags.appendChild(el("span", "tree-tag caster-tag", pool.charKey
      ? "Spell test: " + Engine.charLabel(pool.charKey) + " (" + pool.charVal + ") + Spellcasting (" + pool.ladder + ") = " + pool.total + " dice"
      : "Spellcasting +" + pool.ladder + " · set a source characteristic in the editor"));
    head.appendChild(tags);
    return head;
  }

  function nodeOwned(sp, state) { return Engine.spellOwned(state, sp.id); }

  // Small badges for a spell's tooltip.
  function spellManaTag(sp) {
    var m = Engine.spellManaCost(sp);
    return el("span", "spell-mana-tag" + (m ? "" : " cantrip"), m ? (m + " mana") : "cantrip");
  }
  function spellCastingTimeTag(sp) {
    return el("span", "spell-casting-time-tag", Engine.castingTimeLabel(sp));
  }
  // Range/target/duration are always present; AOE tag is omitted for "none".
  function spellMetaTag(cls, label) { return label ? el("span", cls, label) : null; }

  // Placed and learned exactly like a talent node: click to learn (if its
  // requirements — the automatic proficiency gate plus any authored requires
  // — are met) or click an owned one to unlearn (nothing depends on a spell,
  // so there's no refund-blocking simulation to run).
  function spellNode(raw, state) {
    var sp = Engine.effective(raw, state);   // name/icon may be modified
    var status = Engine.spellRequirementStatus(sp, state);
    var owned = status.owned, met = status.met;
    var cls = "node ";
    if (owned && met) cls += "owned";
    else if (owned && !met) cls += "owned-invalid";
    else if (met) cls += "available";
    else cls += "locked";

    var node = el("div", cls);
    node.dataset.id = sp.id;
    _nodeEls[sp.id] = node;

    var box = el("div", "node-box");
    box.appendChild(el("span", "node-icon", sp.icon || (sp.name || "?").charAt(0)));
    if (owned) box.appendChild(el("span", "node-badge", met ? "✓" : "!"));
    node.appendChild(box);
    node.appendChild(el("div", "node-name", sp.name));
    var cost = el("div", "node-cost " + (sp.pool === "combat" ? "combat" : "noncombat"),
      (sp.cost || 0) + (sp.pool === "combat" ? "C" : "NC"));
    node.appendChild(cost);

    // The authored spell, not `sp`: Engine.effective is not idempotent, and
    // learn/unlearn must act on the database entry.
    node.addEventListener("mouseenter", function () { showSpellTooltip(raw, status, node); });
    node.addEventListener("mousemove", positionTooltip);
    node.addEventListener("mouseleave", hideTooltip);
    node.addEventListener("click", function () { onSpellClick(raw); });
    return node;
  }

  function onSpellClick(sp) {
    hideTooltip();
    var state = State.get();
    var status = Engine.spellRequirementStatus(sp, state);
    if (status.owned) {
      State.update(function (s) {
        Engine.revokeGrants(s, sp.id);           // takes back what it handed out
        s.spells = (s.spells || []).filter(function (id) { return id !== sp.id; });
      });
      UI.toast("Unlearned " + sp.name);
    } else {
      if (!status.met) { UI.toast("Requirements not met for " + sp.name, "error"); return; }
      var learned = function (keys) {
        State.update(function (s) {
          s.spells = s.spells || [];
          s.spells.push(sp.id);
          if (Engine.grantsOf(sp)) Engine.applyGrants(s, sp.id, keys || []);
        });
        UI.toast("Learned " + sp.name + " (+" + (sp.cost || 0) + (sp.pool === "combat" ? "C" : "NC") + " exp)", "success");
      };
      if (Engine.grantNeedsChoice(sp)) UI.grantPicker(sp, state, learned);
      else learned([]);
    }
  }

  function showSpellTooltip(rawSpell, status, node) {
    // Folds in any owned modifier's field changes (§4.8); cost and tier are
    // not modifiable, so the price and the castable-tier gate are unaffected.
    var sp = Engine.effective(rawSpell, State.get());
    var tip = tooltipEl(); tip.innerHTML = "";
    tip.appendChild(el("div", "tt-name", sp.name));

    var meta = el("div", "tt-meta");
    meta.appendChild(el("span", "tt-cost " + (sp.pool === "combat" ? "combat" : "noncombat"),
      (sp.cost || 0) + " " + (sp.pool === "combat" ? "combat" : "non-combat") + " exp"));
    meta.appendChild(el("span", "tt-tier", "Tier " + (sp.tier || 1)));
    meta.appendChild(spellManaTag(sp));
    meta.appendChild(spellCastingTimeTag(sp));
    [spellMetaTag("spell-range-tag", Engine.rangeLabel(sp)),
     spellMetaTag("spell-target-tag", Engine.targetLabel(sp)),
     spellMetaTag("spell-duration-tag", Engine.durationLabel(sp)),
     spellMetaTag("spell-aoe-tag", Engine.aoeLabel(sp))]
      .forEach(function (tag) { if (tag) meta.appendChild(tag); });
    tip.appendChild(meta);

    var tipState = State.get();
    if (sp.flavour) tip.appendChild(el("div", "tt-flavour", Engine.resolveText(sp.flavour, tipState)));
    if (sp.description) tip.appendChild(el("div", "tt-desc", Engine.resolveText(sp.description, tipState)));

    if (status.reasons.length) {
      var reqs = el("div", "tt-reqs");
      reqs.appendChild(el("div", "tt-reqs-head", "Requirements"));
      status.reasons.forEach(function (r) { reqs.appendChild(reqLine(r)); });
      tip.appendChild(reqs);
    }

    var hint = el("div", "tt-hint");
    if (status.owned) { hint.textContent = "Click to unlearn"; hint.classList.add("ok"); }
    else {
      hint.textContent = status.met ? "Click to learn (" + (sp.cost || 0) + " " + Engine.poolLabel(sp.pool) + " exp)" : "Requirements not met";
      hint.classList.add(status.met ? "ok" : "no");
    }
    tip.appendChild(hint);

    tip.classList.add("show"); lastNodeRect = node.getBoundingClientRect(); positionFromRect();
  }

  // One requirement line — same rendering as a talent's tooltip on the trees
  // page, since spellRequirementStatus's reasons share that shape.
  function reqLine(r) {
    var ok = Engine.reasonMet(r);
    var line = el("div", "tt-req " + (ok ? "met" : "unmet"));
    var label = r.label;
    if (r.type === "talent" && r.mode === "any") label = "Any of: " + label;
    if (r.type === "talent" && r.crossDomain) label += " (" + (r.crossTreeName || "other tree") + ")";
    line.appendChild(el("span", "tt-req-mark", ok ? "✓" : "✗"));
    line.appendChild(el("span", "tt-req-text", label + (r.detail ? ": " + r.detail : "")));
    return line;
  }

  function tierDivider(tierNumber) {
    var conf = CONFIG.TIERS[tierNumber - 1] || { name: "Tier " + tierNumber, minSpent: 0 };
    var reached = (Engine.currentTierIndex(State.get()) + 1) >= tierNumber;
    var d = el("div", "tier-divider" + (reached ? " reached" : " locked"));
    d.appendChild(el("span", "tier-divider-line"));
    var lab = el("span", "tier-divider-label");
    lab.appendChild(el("span", "tdl-name", conf.name));
    lab.appendChild(el("span", "tdl-sub", conf.minSpent + " exp spent"));
    d.appendChild(lab);
    d.appendChild(el("span", "tier-divider-line"));
    return d;
  }

  // ---- Prerequisite lines ---------------------------------------------------
  // Only same-domain spell prerequisites are drawn — anything else (a talent,
  // or a spell in another domain) can't have a node in this view, so it
  // renders as text in the tooltip instead.
  var SVG_NS = "http://www.w3.org/2000/svg";

  function drawLines() {
    var host = document.getElementById("spell-grid");
    if (!host || !_svg) return;
    var state = State.get();

    // Measure demand against the stock row spacing, widen the gaps that need
    // more lanes than they can fit, then route again against the new layout
    // (§6b). Reset first, or a resize would keep stacking on last time's extra.
    // Bounded, and repeated: widening a gap can let a run that had collapsed
    // onto its neighbour take its own lane, which is a demand only the next
    // measurement can see.
    clearGapSpacing();
    var plan = routePlan(host);
    for (var pass = 0; pass < 3; pass++) {
      if (!plan || !applyGapSpacing(plan.gaps)) break;
      plan = routePlan(host);
    }

    var w = host.clientWidth, h = host.clientHeight;
    _svg.setAttribute("width", w);
    _svg.setAttribute("height", h);
    _svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    while (_svg.firstChild) _svg.removeChild(_svg.firstChild);

    (plan ? plan.routes : []).forEach(function (r) {
      var preOwned = nodeOwned(r.link.pre, state);
      var childOwned = nodeOwned(r.link.child, state);
      drawRoute(r, preOwned && childOwned ? "active" : preOwned ? "ready" : "idle");
    });
  }

  function clearGapSpacing() {
    Object.keys(_rowEls).forEach(function (row) { _rowEls[row].style.marginTop = ""; });
  }

  // A gap wanting more lanes than the CSS row spacing allows gets the room it
  // asked for. `gaps[i].row` is the row BELOW the gap, and the rows are laid
  // out top-down, so margin-top on that row's element is the space above it.
  function applyGapSpacing(gaps) {
    var changed = false;
    Object.keys(gaps || {}).forEach(function (i) {
      var g = gaps[i], elx = _rowEls[g.row];
      if (!elx || g.extra <= 0.5) return;
      var have = parseFloat(elx.style.marginTop) || 0;
      var want = Math.ceil(g.extra) + have;
      if (want <= have + 0.5) return;
      elx.style.marginTop = want + "px";
      changed = true;
    });
    return changed;
  }

  function routePlan(host) {
    var view = _view;
    if (!view) return null;
    var hostRect = host.getBoundingClientRect();

    var viewById = {};
    view.spells.forEach(function (sp) { viewById[sp.id] = sp; });

    var nodes = view.spells.map(function (sp) {
      var elx = _nodeEls[sp.id];
      if (!elx) return null;
      return {
        id: sp.id, row: sp.row, col: view.colOf(sp),
        box: relRect(elx.querySelector(".node-box"), hostRect),
        outer: relRect(elx, hostRect),
      };
    }).filter(Boolean);

    var links = [];
    view.spells.forEach(function (sp) {
      if (!_nodeEls[sp.id]) return;
      var reqs = sp.requires || {};
      var list = [];
      (reqs.talents || []).forEach(function (pid) { list.push({ pid: pid, dashed: false }); });
      (reqs.anyTalents || []).forEach(function (pid) { list.push({ pid: pid, dashed: true }); });
      list.forEach(function (ln) {
        var pre = viewById[ln.pid];
        if (!pre || !_nodeEls[ln.pid]) return;
        links.push({ from: ln.pid, to: sp.id, dashed: ln.dashed, pre: pre, child: sp });
      });
    });

    return LinkRouter.route(nodes, links, { bounds: { left: 0, right: host.clientWidth } });
  }

  function relRect(elx, hostRect) {
    var r = elx.getBoundingClientRect();
    return {
      left: r.left - hostRect.left, right: r.right - hostRect.left,
      top: r.top - hostRect.top, bottom: r.bottom - hostRect.top,
    };
  }

  function drawRoute(r, linkState) {
    var path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", "M " + r.points.map(function (p) { return p.x + " " + p.y; }).join(" L "));
    path.setAttribute("class", "link link-" + linkState + (r.link.dashed ? " link-any" : ""));
    _svg.appendChild(path);

    var chevron = document.createElementNS(SVG_NS, "path");
    chevron.setAttribute("d", "M -4 -4 L 3 0 L -4 4");
    chevron.setAttribute("class", "link-chevron link-" + linkState);
    chevron.setAttribute("transform",
      "translate(" + r.chevron.x + " " + r.chevron.y + ") rotate(" + r.chevron.angle + ")");
    _svg.appendChild(chevron);
  }

  // ---- Tooltip ------------------------------------------------------------
  var _tooltip = null;
  function tooltipEl() {
    if (!_tooltip) { _tooltip = el("div", "tooltip"); document.body.appendChild(_tooltip); }
    return _tooltip;
  }

  var lastNodeRect = null, lastMouse = null;
  function positionTooltip(e) { lastMouse = { x: e.clientX, y: e.clientY }; positionFromRect(); }
  function positionFromRect() {
    var tip = tooltipEl();
    if (!tip.classList.contains("show")) return;
    var pad = 14;
    var r = tip.getBoundingClientRect();
    var x, y;
    if (lastMouse) { x = lastMouse.x + pad; y = lastMouse.y + pad; }
    else if (lastNodeRect) { x = lastNodeRect.right + pad; y = lastNodeRect.top; }
    else { x = pad; y = pad; }
    if (x + r.width > window.innerWidth - 8) x = Math.max(8, (lastMouse ? lastMouse.x : lastNodeRect.left) - r.width - pad);
    if (y + r.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - r.height - 8);
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  function hideTooltip() { if (_tooltip) _tooltip.classList.remove("show"); lastMouse = null; }

  function debounce(fn, ms) {
    var h;
    return function () { clearTimeout(h); h = setTimeout(fn, ms); };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
