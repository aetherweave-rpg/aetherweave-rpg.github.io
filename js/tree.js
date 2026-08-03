// ============================================================================
// Talent Trees page (index.html): tree tabs (core / ancestral / combination),
// the tree grid, tier dividers, SVG prerequisite lines, node states,
// click-to-learn/refund, and tooltips. Spells have their own top-level page —
// see spells.html / js/spells.js.
// ============================================================================

(function () {
  var Engine = window.Engine, State = window.State, UI = window.UI, el = UI.el, CONFIG = window.CONFIG;
  var LAST_TREE_KEY = "aetherweave.lastTree";
  var SHOW_COMBOS_KEY = "aetherweave.showAllCombinations";

  // A character sees ONE ancestral tree: the trees of their ancestry chain
  // (self + parents) concatenated side by side. This sentinel selects that
  // combined view instead of a single real tree.
  var ANCESTRY_VIEW = "__ancestry__";

  var currentTree = window.SafeStorage.read(LAST_TREE_KEY) || null;
  var showAllCombos = window.SafeStorage.read(SHOW_COMBOS_KEY) === "1";

  var _svg = null, _nodeEls = {}, _view = null;

  function init() {
    UI.renderHeader("trees");
    UI.renderFooter();
    UI.renderStorageWarning();
    UI.renderCreationGate();
    renderTabs();
    render();
    State.subscribe(function () { UI.renderHeader("trees"); renderTabs(); render(); });
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

  // Trees currently on offer, falling back if the remembered one vanished
  // (e.g. the ancestry changed, or a combination re-locked).
  function available() { return Engine.visibleTrees(State.get(), showAllCombos); }
  function ancestryTreesVisible(state) {
    return available().filter(function (t) { return t.kind === "ancestry"; });
  }

  // Resolve the current selection to a renderable "view":
  //   { id, kind, name, icon, accent, flavour, cols, talents, colOf, blocks?, realTree? }
  // colOf(t) gives a talent's DISPLAY column (offset within the combined grid).
  function buildView(state) {
    var ancTrees = ancestryTreesVisible(state);

    // Redirect a stale saved selection that points at a single ancestry tree.
    if (currentTree && Engine.treeById(currentTree) && (Engine.treeById(currentTree).kind === "ancestry"))
      currentTree = ANCESTRY_VIEW;

    if (currentTree === ANCESTRY_VIEW && ancTrees.length) return ancestryView(state, ancTrees);

    var real = available().filter(function (t) { return t.id === currentTree; })[0];
    if (!real) {
      var core = available().filter(function (t) { return t.kind === "core"; })[0];
      if (core) { currentTree = core.id; real = core; }
      else if (ancTrees.length) { currentTree = ANCESTRY_VIEW; return ancestryView(state, ancTrees); }
      else return null;
    }
    var talents = Engine.talentsForDomain(real.id);
    return {
      id: real.id, kind: real.kind, name: real.name, icon: real.icon, accent: real.accent,
      flavour: real.flavour, cols: real.cols, realTree: real,
      talents: talents, colOf: function (t) { return t.col; },
    };
  }

  // The one ancestral tree: chain trees laid out left→right (root first), each
  // occupying its own block of columns. Talents keep their real id/domain; only
  // their display column is offset.
  function ancestryView(state, ancTrees) {
    var chainIds = Engine.accessibleAncestryTreeIds(state);   // [self, parent, grandparent]
    var ordered = chainIds.slice().reverse()                  // root → self, left to right
      .map(function (id) { return Engine.treeById(id); })
      .filter(function (t) { return t && ancTrees.indexOf(t) >= 0; });
    if (!ordered.length) ordered = ancTrees;

    var offset = {}, cur = 0, blocks = [], talents = [];
    ordered.forEach(function (tr) {
      offset[tr.id] = cur;
      blocks.push({ id: tr.id, name: tr.name, icon: tr.icon, accent: tr.accent, offset: cur, cols: tr.cols });
      Engine.talentsForDomain(tr.id).forEach(function (t) { talents.push(t); });
      cur += tr.cols;
    });
    var selfA = Engine.ancestryById(state.creation && state.creation.ancestry);
    return {
      id: ANCESTRY_VIEW, kind: "ancestry-combined",
      name: "Ancestry", icon: (selfA && selfA.icon) || (ordered[0] || {}).icon || "🧬",
      accent: (selfA && selfA.accent) || (ordered[ordered.length - 1] || {}).accent,
      flavour: ordered.length > 1 ? "Your ancestral line, joined into one tree." : ((ordered[0] || {}).flavour || ""),
      cols: Math.max(1, cur), talents: talents, blocks: blocks,
      colOf: function (t) { return (offset[t.domain] || 0) + (t.col || 0); },
    };
  }

  // ---- Tabs ---------------------------------------------------------------
  function renderTabs() {
    var host = document.getElementById("tree-tabs");
    host.innerHTML = "";
    var state = State.get();
    var list = available();
    var view = buildView(state);
    var activeId = view ? view.id : null;

    // Core domains and combination trees: one tab each. Ancestry: a SINGLE tab
    // for the combined ancestral tree.
    [{ kind: "core", label: "Domains" },
     { kind: "ancestry", label: "Ancestry" },
     { kind: "combination", label: "Combinations" }].forEach(function (group) {
      var inGroup = list.filter(function (t) { return t.kind === group.kind; });
      if (!inGroup.length) return;

      var section = el("div", "tab-group");
      section.appendChild(el("span", "tab-group-label", group.label));
      var row = el("div", "tab-row");

      if (group.kind === "ancestry") {
        var selfA = Engine.ancestryById(state.creation && state.creation.ancestry);
        var b = el("button", "domain-tab" + (activeId === ANCESTRY_VIEW ? " active" : ""));
        b.type = "button";
        b.style.setProperty("--accent", (selfA && selfA.accent) || inGroup[0].accent);
        b.appendChild(el("span", "domain-tab-icon", (selfA && selfA.icon) || inGroup[0].icon));
        b.appendChild(el("span", "domain-tab-name", (selfA && selfA.name) || "Ancestry"));
        b.title = inGroup.length > 1 ? ("Ancestral line: " + inGroup.map(function (t) { return t.name; }).join(" + ")) : inGroup[0].name;
        b.onclick = function () {
          currentTree = ANCESTRY_VIEW;
          window.SafeStorage.write(LAST_TREE_KEY, ANCESTRY_VIEW);
          renderTabs(); render();
        };
        row.appendChild(b);
        section.appendChild(row);
        host.appendChild(section);
        return;
      }

      inGroup.forEach(function (tree) {
        var unlocked = Engine.combinationUnlocked(tree, state);
        var b = el("button", "domain-tab" +
          (activeId === tree.id ? " active" : "") +
          (unlocked ? "" : " preview"));
        b.type = "button";
        b.style.setProperty("--accent", tree.accent);
        b.appendChild(el("span", "domain-tab-icon", tree.icon));
        b.appendChild(el("span", "domain-tab-name", tree.name));
        if (!unlocked) b.appendChild(el("span", "domain-tab-lock", "🔒"));
        b.title = tree.description || tree.name;
        b.onclick = function () {
          currentTree = tree.id;
          window.SafeStorage.write(LAST_TREE_KEY, tree.id);
          renderTabs();
          render();
        };
        row.appendChild(b);
      });

      section.appendChild(row);
      host.appendChild(section);
    });

    // Toggle: reveal every combination tree even without qualifying, so the
    // full space can be browsed while planning a character.
    var toggleWrap = el("label", "combo-toggle");
    var cb = el("input");
    cb.type = "checkbox";
    cb.checked = showAllCombos;
    cb.onchange = function () {
      showAllCombos = cb.checked;
      window.SafeStorage.write(SHOW_COMBOS_KEY, showAllCombos ? "1" : "0");
      renderTabs();
      render();
    };
    toggleWrap.appendChild(cb);
    toggleWrap.appendChild(el("span", null, "Show all combination trees (ignore requirements)"));
    host.appendChild(toggleWrap);
  }

  // ---- Tree ---------------------------------------------------------------
  function render() {
    var host = document.getElementById("tree");
    if (!host) return;
    hideTooltip();
    host.innerHTML = "";
    _nodeEls = {};

    var state = State.get();
    var view = _view = buildView(state);
    if (!view) {
      host.appendChild(el("div", "empty", "No trees available."));
      return;
    }
    host.style.setProperty("--accent", view.accent);
    host.style.setProperty("--cols", view.cols);

    host.appendChild(treeHeader(view, state));

    var talents = view.talents;
    if (!talents.length) {
      host.appendChild(el("div", "empty", "No talents defined for this tree yet."));
      return;
    }

    _svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    _svg.setAttribute("class", "tree-lines");
    host.appendChild(_svg);

    var grid = el("div", "tree-grid");
    host.appendChild(grid);

    // Column boundaries between concatenated blocks (combined ancestral view).
    var boundaries = {};
    if (view.blocks && view.blocks.length > 1) {
      view.blocks.forEach(function (bl) { if (bl.offset > 0) boundaries[bl.offset] = true; });
      grid.appendChild(blockHeaderRow(view));
    }

    var maxRow = talents.reduce(function (m, t) { return Math.max(m, t.row); }, 0);

    var prevTier = null;
    for (var row = maxRow; row >= 0; row--) {
      var rowTalents = talents.filter(function (t) { return t.row === row; });
      if (!rowTalents.length) continue;
      var rowTier = rowTalents[0].tier;

      if (prevTier !== null && rowTier !== prevTier) grid.appendChild(tierDivider(prevTier));
      prevTier = rowTier;

      var rowEl = el("div", "tree-row");
      rowEl.style.setProperty("--cols", view.cols);
      for (var c = 0; c < view.cols; c++) {
        var cell = el("div", "tree-cell" + (boundaries[c] ? " block-start" : ""));
        var t = matchAt(rowTalents, view, c);
        if (t) cell.appendChild(makeNode(t, state));
        rowEl.appendChild(cell);
      }
      grid.appendChild(rowEl);
    }

    scheduleDraw();
  }

  function matchAt(rowTalents, view, c) {
    for (var i = 0; i < rowTalents.length; i++) if (view.colOf(rowTalents[i]) === c) return rowTalents[i];
    return null;
  }

  // Labels spanning each ancestry's block of columns in the combined view.
  function blockHeaderRow(view) {
    var rowEl = el("div", "tree-row ancestry-headers");
    rowEl.style.setProperty("--cols", view.cols);
    view.blocks.forEach(function (bl) {
      var label = el("div", "ancestry-block-label");
      label.style.gridColumn = (bl.offset + 1) + " / span " + bl.cols;
      label.style.setProperty("--accent", bl.accent);
      label.appendChild(el("span", "abl-icon", bl.icon));
      label.appendChild(el("span", "abl-name", bl.name));
      rowEl.appendChild(label);
    });
    return rowEl;
  }

  // Banner above the tree: what it is, and what entering it will cost.
  function treeHeader(view, state) {
    var head = el("div", "tree-head");
    var title = el("div", "tree-head-main");
    title.appendChild(el("span", "tree-head-icon", view.icon));
    var txt = el("div");
    txt.appendChild(el("div", "tree-head-name", view.name));
    if (view.flavour) txt.appendChild(el("div", "tree-head-desc", view.flavour));
    title.appendChild(txt);
    head.appendChild(title);

    var tags = el("div", "tree-head-tags");

    // Combined ancestral view: no per-tree exp/access (ancestral trees are free).
    if (view.kind === "ancestry-combined") {
      tags.appendChild(el("span", "tree-tag ok", "Ancestral (free)"));
      if (view.blocks && view.blocks.length > 1)
        tags.appendChild(el("span", "tree-tag", "Line: " + view.blocks.map(function (b) { return b.name; }).join(" → ")));
      head.appendChild(tags);
      return head;
    }

    var tree = view.realTree || view;

    // Talent tiers are gated on exp spent inside this tree, so surface it.
    tags.appendChild(el("span", "tree-tag", Engine.treeSpent(state, tree.id) + " exp spent in this tree"));

    // Magical domains: the effective spell test pool (source characteristic + spine).
    if (Engine.isMagicalDomain(tree.id)) {
      var pool = Engine.spellPool(state, tree.id);
      tags.appendChild(el("span", "tree-tag caster-tag", pool.charKey
        ? "Spell test: " + Engine.charLabel(pool.charKey) + " (" + pool.charVal + ") + Spellcasting (" + pool.ladder + ") = " + pool.total + " dice"
        : "Spellcasting +" + pool.ladder + " · set a source characteristic in the editor"));
    }

    if (tree.kind === "combination") {
      var parents = (tree.parents || []).map(function (p) {
        var pt = Engine.treeById(p); return pt ? pt.name : p;
      });
      var unlocked = Engine.combinationUnlocked(tree, state);
      tags.appendChild(el("span", "tree-tag " + (unlocked ? "ok" : "locked"),
        (unlocked ? "✓ " : "🔒 ") + "Needs talents or spells in " + parents.join(" + ")));
      tags.appendChild(el("span", "tree-tag ok", "Combination (free)"));
    }

    // One-time surcharge for opening this tree, if it isn't open already.
    var charges = Engine.treeAccessCharges(state);
    var already = charges.some(function (c) { return c.treeId === tree.id; });
    var exempt = (CONFIG.TREE_ACCESS.exemptKinds || []).indexOf(tree.kind) >= 0;
    if (!exempt) {
      if (already) {
        var mine = charges.filter(function (c) { return c.treeId === tree.id; })[0];
        tags.appendChild(el("span", "tree-tag ok",
          mine.cost ? "Opened (" + mine.cost + " exp)" : "Opened (free)"));
      } else {
        var next = Engine.nextTreeCost(state);
        tags.appendChild(el("span", "tree-tag " + (next ? "cost" : "ok"),
          next ? "Opening this tree costs +" + next + " exp (tree " + (charges.length + 1) + ")"
               : "First tree, free"));
      }
    }
    head.appendChild(tags);
    return head;
  }

  function nodeOwned(t, state) {
    return (state.talents || []).indexOf(t.id) >= 0;
  }

  // Small badges reused by a maneuver talent's tooltip (§ showTooltip); the
  // mana badge isn't among them since maneuvers never cost mana.
  function spellCastingTimeTag(sp) {
    return el("span", "spell-casting-time-tag", Engine.castingTimeLabel(sp));
  }
  // Range/target/duration are always present; AOE tag is omitted for "none".
  function spellMetaTag(cls, label) { return label ? el("span", cls, label) : null; }

  // One requirement line, shared by talent and (via spells.js) spell tooltips.
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

  function makeNode(raw, state) {
    var t = Engine.effective(raw, state);   // name/icon may be modified
    var status = Engine.requirementStatus(t, state);
    var owned = status.owned, met = status.met, granted = status.granted;

    var cls = "node ";
    if (granted) cls += "owned granted";
    else if (owned && met) cls += "owned";
    else if (owned && !met) cls += "owned-invalid";
    else if (met) cls += "available";
    else cls += "locked";

    var node = el("div", cls);
    node.dataset.id = t.id;
    _nodeEls[t.id] = node;

    var box = el("div", "node-box");
    box.appendChild(el("span", "node-icon", t.icon || (t.name || "?").charAt(0)));
    if (owned) box.appendChild(el("span", "node-badge", granted ? "★" : met ? "✓" : "!"));
    node.appendChild(box);

    node.appendChild(el("div", "node-name", t.name));

    var cost = el("div", "node-cost " + (t.pool === "combat" ? "combat" : "noncombat"));
    if (granted) { cost.textContent = "free"; cost.className = "node-cost granted"; }
    else cost.textContent = t.cost + (t.pool === "combat" ? "C" : "NC");
    node.appendChild(cost);

    // Both take the AUTHORED talent, not `t`: Engine.effective is not
    // idempotent (a second pass would add the same bonus twice), and
    // learn/refund must act on what the database says this node costs.
    node.addEventListener("mouseenter", function () { showTooltip(raw, status, node); });
    node.addEventListener("mousemove", positionTooltip);
    node.addEventListener("mouseleave", hideTooltip);
    node.addEventListener("click", function () { onNodeClick(raw); });
    return node;
  }

  function onNodeClick(t) {
    hideTooltip();
    var state = State.get();
    var status = Engine.requirementStatus(t, state);

    if (status.owned) {
      var chk = Engine.canRefund(t.id, state);
      if (chk.granted) { UI.toast(t.name + " was granted at creation, can't be refunded.", "error"); return; }
      if (!chk.ok) {
        UI.toast("Can't refund " + t.name + ": needed by " + (chk.blockedBy || []).join(", "), "error");
        return;
      }
      State.update(function (s) {
        Engine.revokeGrants(s, t.id);              // takes back what it handed out
        s.talents = s.talents.filter(function (id) { return id !== t.id; });
      });
      UI.toast("Refunded " + t.name);
    } else {
      if (!status.met) { UI.toast("Requirements not met for " + t.name, "error"); return; }
      var lc = Engine.learnCost(t, state);
      var learned = function (keys) {
        State.update(function (s) {
          s.talents.push(t.id);
          if (Engine.grantsOf(t)) Engine.applyGrants(s, t.id, keys || []);
        });
        UI.toast(lc.opensTree && lc.surcharge
          ? "Learned " + t.name + " (+" + lc.surcharge + " exp to open this tree)"
          : "Learned " + t.name, "success");
      };
      // A grant with a choice is part of the purchase: dismissing the picker
      // cancels the whole thing rather than leaving an unresolved choice.
      if (Engine.grantNeedsChoice(t)) UI.grantPicker(t, state, learned);
      else learned([]);
    }
  }

  // ---- Prerequisite lines -------------------------------------------------
  function drawLines() {
    var host = document.getElementById("tree");
    if (!host || !_svg) return;
    var w = host.clientWidth, h = host.clientHeight;
    _svg.setAttribute("width", w);
    _svg.setAttribute("height", h);
    _svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    while (_svg.firstChild) _svg.removeChild(_svg.firstChild);

    var hostRect = host.getBoundingClientRect();
    var state = State.get();

    // A prerequisite may point at something not rendered in THIS view (a spell
    // — spells live on their own page now — or a cross-domain talent) —
    // resolve within the current view first, then fall back to the engine's
    // index; if neither has a DOM node for it, the requirement renders as
    // text instead.
    var viewById = {};
    (_view ? _view.talents : []).forEach(function (t) { viewById[t.id] = t; });

    (_view ? _view.talents : []).forEach(function (t) {
      var childEl = _nodeEls[t.id];
      if (!childEl) return;
      var reqs = t.requires || {};
      var links = [];
      (reqs.talents || []).forEach(function (pid) { links.push({ pid: pid, dashed: false }); });
      (reqs.anyTalents || []).forEach(function (pid) { links.push({ pid: pid, dashed: true }); });

      links.forEach(function (ln) {
        var pre = viewById[ln.pid] || Engine.talentById(ln.pid);
        if (!pre || pre.domain !== t.domain) return;   // cross-tree → shown as text
        var preEl = _nodeEls[ln.pid];
        if (!preEl) return;
        drawPath(hostRect, preEl, childEl, pre, t, state, ln.dashed);
      });
    });
  }

  function drawPath(hostRect, preEl, childEl, pre, child, state, dashed) {
    var pb = preEl.querySelector(".node-box").getBoundingClientRect();
    var cb = childEl.querySelector(".node-box").getBoundingClientRect();

    var d;
    if (pre.row === child.row) {
      // Side-by-side prerequisite (same row): draw a horizontal connector
      // between the facing edges of the two boxes.
      var leftToRight = (pre.col || 0) <= (child.col || 0);
      var hsx = (leftToRight ? pb.right : pb.left) - hostRect.left;
      var hex = (leftToRight ? cb.left : cb.right) - hostRect.left;
      var hsy = pb.top - hostRect.top + pb.height / 2;
      var hey = cb.top - hostRect.top + cb.height / 2;
      var midX = (hsx + hex) / 2;
      d = "M " + hsx + " " + hsy + " C " + midX + " " + hsy + " " + midX + " " + hey + " " + hex + " " + hey;
    } else {
      // Vertical prerequisite (prereq bottom-of-tree → dependent above it).
      var sx = pb.left - hostRect.left + pb.width / 2, sy = pb.top - hostRect.top;
      var ex = cb.left - hostRect.left + cb.width / 2, ey = cb.bottom - hostRect.top;
      var midY = (sy + ey) / 2;
      d = "M " + sx + " " + sy + " C " + sx + " " + midY + " " + ex + " " + midY + " " + ex + " " + ey;
    }

    var preOwned = nodeOwned(pre, state);
    var childOwned = nodeOwned(child, state);
    var cls = "link " + (preOwned && childOwned ? "link-active" : preOwned ? "link-ready" : "link-idle");
    if (dashed) cls += " link-any";

    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("class", cls);
    _svg.appendChild(path);
  }

  // ---- Tooltip ------------------------------------------------------------
  var _tooltip = null;
  function tooltipEl() {
    if (!_tooltip) { _tooltip = el("div", "tooltip"); document.body.appendChild(_tooltip); }
    return _tooltip;
  }

  function showTooltip(raw, status, node) {
    var state = State.get();
    // What the character would actually have: any owned modifier's field
    // changes already folded in (§4.8). Cost/pool/tier aren't modifiable, so
    // the price and gates below still read the authored values.
    var t = Engine.effective(raw, state);
    var tip = tooltipEl();
    tip.innerHTML = "";
    tip.appendChild(el("div", "tt-name", t.name));

    var meta = el("div", "tt-meta");
    var lc = Engine.learnCost(t, state);
    if (status.granted) {
      meta.appendChild(el("span", "tt-cost granted", "granted at creation"));
    } else {
      meta.appendChild(el("span", "tt-cost " + (t.pool === "combat" ? "combat" : "noncombat"),
        t.cost + " " + (t.pool === "combat" ? "combat" : "non-combat") + " exp"));
      if (!status.owned && lc.opensTree && lc.surcharge)
        meta.appendChild(el("span", "tt-cost surcharge", "+" + lc.surcharge + " tree access"));
    }
    meta.appendChild(el("span", "tt-tier", (CONFIG.TIERS[t.tier - 1] || {}).name || ("Tier " + t.tier)));
    if (t.ability === "maneuver")
      meta.appendChild(el("span", "tt-ability maneuver", "Maneuver" + (t.uses ? " · " + t.uses + "/" + (t.usesPer || "session") : "")));
    else if (Engine.isModifier(t))
      meta.appendChild(el("span", "tt-ability modifier", "Modifier"));
    else
      meta.appendChild(el("span", "tt-ability passive", "Passive"));
    if (t.ability === "maneuver" && t.castingTime != null) {
      meta.appendChild(spellCastingTimeTag(t));
      [spellMetaTag("spell-range-tag", Engine.rangeLabel(t)),
       spellMetaTag("spell-target-tag", Engine.targetLabel(t)),
       spellMetaTag("spell-duration-tag", Engine.durationLabel(t)),
       spellMetaTag("spell-aoe-tag", Engine.aoeLabel(t))]
        .forEach(function (tag) { if (tag) meta.appendChild(tag); });
    }
    tip.appendChild(meta);

    // Text hooks resolve against what the character owns, so a node modified
    // by an owned modifier talent reads as its final text (§4.7).
    var tipState = State.get();
    if (t.flavour) tip.appendChild(el("div", "tt-flavour", Engine.resolveText(t.flavour, tipState)));
    if (t.description) tip.appendChild(el("div", "tt-desc", Engine.resolveText(t.description, tipState)));

    // A modifier never gets its own row on the sheet, so the tree is the only
    // place naming what it changes.
    if (Engine.isModifier(t) && t.modifies) {
      var targets = Object.keys(t.modifies).map(function (id) {
        var target = Engine.talentById(id) || Engine.spellById(id);
        return target ? target.name : id;
      });
      tip.appendChild(el("div", "tt-modifies", "Modifies: " + targets.join(", ")));
    }

    if (status.reasons.length) {
      var reqs = el("div", "tt-reqs");
      reqs.appendChild(el("div", "tt-reqs-head", "Requirements"));
      status.reasons.forEach(function (r) { reqs.appendChild(reqLine(r)); });
      tip.appendChild(reqs);
    }

    var hint = el("div", "tt-hint");
    if (status.granted) {
      hint.textContent = "Granted at creation, free, can't be refunded";
      hint.classList.add("ok");
    } else if (status.owned) {
      var chk = Engine.canRefund(t.id, state);
      hint.textContent = chk.ok ? "Click to refund" : "Locked: needed by " + (chk.blockedBy || []).join(", ");
      hint.classList.add(chk.ok ? "ok" : "no");
    } else {
      hint.textContent = status.met
        ? "Click to learn (" + lc.total + " " + Engine.poolLabel(lc.pool) + " exp)"
        : "Requirements not met";
      hint.classList.add(status.met ? "ok" : "no");
    }
    tip.appendChild(hint);

    tip.classList.add("show");
    lastNodeRect = node.getBoundingClientRect();
    positionFromRect();
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
