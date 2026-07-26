// ============================================================================
// Character Creation wizard (create.html)
// ----------------------------------------------------------------------------
// Six prompted steps, run before anything else on a new character. Everything
// chosen here is FREE: it is written into state.granted, which the engine
// subtracts when computing spent exp. All numbers come from js/data/creation.js.
// ============================================================================

(function () {
  var Engine = window.Engine, State = window.State, UI = window.UI, el = UI.el;
  var CONFIG = window.CONFIG, CREATION = window.CREATION;

  // Working copy — nothing touches the saved character until Finish.
  var draft = null;

  function freshDraft() {
    return {
      step: 0,
      chars: {},              // characteristic key -> assigned value
      ancestry: null,
      ancestralTalents: [],   // picked talent ids
      source: null,
      combatSkills: {},       // name -> tier
      combatProfs: [],        // [{ name, kind, tier }]
      ncSkills: {},
      ncProfs: [],
    };
  }

  var STEPS = [
    { key: "chars",     title: "Characteristics", short: "Characteristics" },
    { key: "ancestry",  title: "Ancestry",        short: "Ancestry" },
    { key: "source",    title: "Source of Power", short: "Power" },
    { key: "combat",    title: "Combat Training", short: "Combat" },
    { key: "noncombat", title: "Background",      short: "Background" },
    { key: "review",    title: "Review",          short: "Review" },
  ];

  function init() {
    draft = freshDraft();
    UI.renderHeader("create", { minimal: true });
    UI.renderStorageWarning();
    // ?random=1 (from the gate's "Random character" button) rolls everything
    // and drops you on Review, so a playable character is one click away.
    if (/[?&]random=1\b/.test(window.location.search)) randomizeAll();
    render();
  }

  // ---- shell --------------------------------------------------------------
  function render() {
    var host = document.getElementById("wizard");
    host.innerHTML = "";

    host.appendChild(intro());
    host.appendChild(stepBar());

    var body = el("div", "wizard-body");
    var step = STEPS[draft.step];

    var head = el("div", "wizard-head");
    head.appendChild(el("h2", "wizard-title", (draft.step + 1) + ". " + step.title));
    var isReview = step.key === "review";
    var rnd = el("button", "btn btn-random",
      isReview ? "🎲 Reroll everything" : "🎲 Randomize this step");
    rnd.type = "button";
    rnd.onclick = function () {
      if (isReview) randomizeAll(); else RANDOMIZERS[step.key]();
      render();
    };
    head.appendChild(rnd);
    body.appendChild(head);

    var builders = {
      chars: stepChars, ancestry: stepAncestry, source: stepSource,
      combat: stepCombat, noncombat: stepNoncombat, review: stepReview,
    };
    body.appendChild(builders[step.key]());
    host.appendChild(body);

    host.appendChild(footer());
  }

  function intro() {
    var box = el("div", "wizard-intro");
    box.appendChild(el("span", "wizard-intro-icon", "❖"));
    var t = el("div");
    t.appendChild(el("div", "wizard-intro-title", "Create your character"));
    t.appendChild(el("div", "wizard-intro-sub",
      "Nothing chosen here costs experience. Afterwards you keep " +
      CREATION.freeExp.combat + " combat and " + CREATION.freeExp.noncombat +
      " non-combat exp to spend freely."));
    box.appendChild(t);

    var rand = el("button", "btn btn-random btn-random-lg", "🎲 Random character");
    rand.type = "button";
    rand.title = "Roll every step at once and jump to the review";
    rand.onclick = function () { randomizeAll(); render(); };
    box.appendChild(rand);
    return box;
  }

  function stepBar() {
    var bar = el("div", "step-bar");
    STEPS.forEach(function (s, i) {
      var done = i < draft.step, active = i === draft.step;
      var chip = el("button", "step-chip" + (active ? " active" : done ? " done" : ""));
      chip.type = "button";
      chip.appendChild(el("span", "step-num", done ? "✓" : String(i + 1)));
      chip.appendChild(el("span", "step-label", s.short));
      chip.disabled = i > draft.step;      // can go back, not skip ahead
      chip.onclick = function () { draft.step = i; render(); };
      bar.appendChild(chip);
    });
    return bar;
  }

  function footer() {
    var f = el("div", "wizard-footer");
    var problem = validateStep(draft.step);

    var back = el("button", "btn", "← Back"); back.type = "button";
    back.disabled = draft.step === 0;
    back.onclick = function () { draft.step--; render(); };
    f.appendChild(back);

    var note = el("div", "wizard-note" + (problem ? " warn" : ""));
    note.textContent = problem || "";
    f.appendChild(note);

    if (draft.step < STEPS.length - 1) {
      var next = el("button", "btn btn-primary", "Next →"); next.type = "button";
      next.disabled = !!problem;
      next.onclick = function () { draft.step++; render(); };
      f.appendChild(next);
    } else {
      var done = el("button", "btn btn-primary", "✓ Create character"); done.type = "button";
      done.disabled = !!problem;
      done.onclick = finish;
      f.appendChild(done);
    }
    return f;
  }

  // ---- step 1: characteristics -------------------------------------------
  function stepChars() {
    var wrap = el("div");
    var arr = CREATION.characteristicArray;
    var values = arr.slice().sort(function (a, b) { return b - a; });
    var distinct = values.filter(function (v, i, a) { return a.indexOf(v) === i; });

    wrap.appendChild(el("p", "step-lead",
      "Assign " + values.join(", ") + " across the five characteristics — one value each."));

    // How many of each value remain unassigned.
    var used = {};
    Object.keys(draft.chars).forEach(function (k) {
      var v = draft.chars[k];
      if (v != null) used[v] = (used[v] || 0) + 1;
    });
    var available = {};
    distinct.forEach(function (v) {
      available[v] = values.filter(function (x) { return x === v; }).length - (used[v] || 0);
    });

    var pool = el("div", "value-pool");
    pool.appendChild(el("span", "value-pool-label", "Remaining"));
    distinct.forEach(function (v) {
      var chip = el("span", "value-chip" + (available[v] > 0 ? "" : " spent"));
      chip.textContent = v + " ×" + available[v];
      pool.appendChild(chip);
    });
    wrap.appendChild(pool);

    var grid = el("div", "char-assign-grid");
    CONFIG.CHARACTERISTICS.forEach(function (c) {
      var row = el("div", "char-assign-row");
      var name = el("div", "char-assign-name");
      name.appendChild(el("span", "char-assign-label", c.label));
      name.appendChild(el("span", "char-assign-abbr", c.abbr));
      row.appendChild(name);

      var opts = el("div", "value-options");
      distinct.forEach(function (v) {
        var mine = draft.chars[c.key] === v;
        var b = el("button", "value-btn" + (mine ? " chosen" : ""), String(v));
        b.type = "button";
        b.disabled = !mine && available[v] <= 0;
        b.onclick = function () {
          draft.chars[c.key] = mine ? null : v;
          if (draft.chars[c.key] == null) delete draft.chars[c.key];
          render();
        };
        opts.appendChild(b);
      });
      row.appendChild(opts);
      grid.appendChild(row);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  // ---- step 2: ancestry ---------------------------------------------------
  function ancestryChildren(parentId) {
    return (window.ANCESTRIES || []).filter(function (a) { return (a.parent || null) === (parentId || null); });
  }

  function stepAncestry() {
    var wrap = el("div");
    var picks = CREATION.ancestralTalentPicks;
    wrap.appendChild(el("p", "step-lead",
      "Choose an ancestry — including a sub-ancestry, where one exists — then take " + picks +
      " ancestral talent" + (picks === 1 ? "" : "s") + " for free. A sub-ancestry also has access to all of " +
      "its parent ancestries' talents. Ancestral trees never count toward the tree-access cost."));

    // Ancestries render as an indented hierarchy; click any node (top-level,
    // sub, or sub-sub) to become that ancestry.
    var listWrap = el("div", "ancestry-tree");
    (function renderLevel(parentId, depth) {
      ancestryChildren(parentId).forEach(function (a) {
        var pickable = Engine.ancestryPickable(a);
        var selected = draft.ancestry === a.id;
        // Pickable ancestries are buttons; grouping-only ones are inert rows
        // (still shown so their sub-ancestries make sense) that can't be chosen.
        var row = el(pickable ? "button" : "div",
          "ancestry-row" + (selected ? " chosen" : "") + (pickable ? "" : " category"));
        if (pickable) row.type = "button";
        row.style.setProperty("--accent", a.accent);
        row.style.paddingLeft = (12 + depth * 22) + "px";
        if (depth > 0) row.appendChild(el("span", "ancestry-branch", "↳"));
        row.appendChild(el("span", "ancestry-row-icon", a.icon || a.name.charAt(0)));
        var txt = el("div", "ancestry-row-text");
        var nameLine = el("div", "ancestry-row-name", a.name);
        if (depth === 1) nameLine.appendChild(el("span", "ancestry-tag", "sub"));
        else if (depth >= 2) nameLine.appendChild(el("span", "ancestry-tag", "sub-sub"));
        if (!pickable) nameLine.appendChild(el("span", "ancestry-tag", "pick a sub-ancestry"));
        txt.appendChild(nameLine);
        if (a.description) txt.appendChild(el("div", "ancestry-row-desc", a.description));
        row.appendChild(txt);
        if (pickable) row.onclick = function () {
          if (draft.ancestry !== a.id) { draft.ancestry = a.id; draft.ancestralTalents = []; }
          render();
        };
        listWrap.appendChild(row);
        renderLevel(a.id, depth + 1);       // recurse into sub-ancestries
      });
    })(null, 0);
    wrap.appendChild(listWrap);

    if (draft.ancestry) {
      var chain = Engine.ancestryChain(draft.ancestry);
      var selfTree = (Engine.ancestryById(draft.ancestry) || {}).treeId;
      if (chain.length > 1) {
        var names = chain.map(function (aid) { return (Engine.ancestryById(aid) || {}).name; });
        wrap.appendChild(el("div", "sheet-hint", "Accessible ancestral trees: " + names.join(" → ")));
      }

      var options = Engine.creationPicksForChain(draft.ancestry);
      var sub = el("div", "sub-section");
      sub.appendChild(el("h3", "sub-title",
        "Ancestral talent — pick " + picks + " (" + draft.ancestralTalents.length + "/" + picks + " chosen)"));
      if (!options.length) sub.appendChild(el("div", "sheet-hint", "This ancestry has no base talents to pick from yet."));
      var list = el("div", "pick-grid");
      options.forEach(function (t) {
        var chosen = draft.ancestralTalents.indexOf(t.id) >= 0;
        var card = el("button", "pick-card" + (chosen ? " chosen" : ""));
        card.type = "button";
        var head = el("div", "pick-head");
        head.appendChild(el("span", "pick-icon", t.icon || t.name.charAt(0)));
        head.appendChild(el("span", "pick-name", t.name));
        if (t.domain && t.domain !== selfTree) {
          var pt = Engine.treeById(t.domain);
          head.appendChild(el("span", "ancestry-tag", pt ? pt.name : "parent"));
        }
        card.appendChild(head);
        card.appendChild(el("span", "pick-desc", t.description));
        card.onclick = function () {
          var i = draft.ancestralTalents.indexOf(t.id);
          if (i >= 0) draft.ancestralTalents.splice(i, 1);
          else if (draft.ancestralTalents.length < picks) draft.ancestralTalents.push(t.id);
          else { draft.ancestralTalents = [t.id]; }   // picks==1 → clicking swaps
          render();
        };
        list.appendChild(card);
      });
      sub.appendChild(list);
      wrap.appendChild(sub);
    }
    return wrap;
  }

  // ---- step 3: source of power -------------------------------------------
  function stepSource() {
    var wrap = el("div");
    wrap.appendChild(el("p", "step-lead",
      "Choose where your power comes from. A source of power explains why your " +
      "character can do extraordinary things — it does not grant skills or talents."));

    var cards = el("div", "card-grid");
    (window.SOURCES || []).forEach(function (s) {
      var card = el("button", "choice-card" + (draft.source === s.id ? " chosen" : ""));
      card.type = "button";
      card.style.setProperty("--accent", s.accent);
      card.appendChild(el("span", "choice-icon", s.icon));
      card.appendChild(el("span", "choice-name", s.name));
      card.appendChild(el("span", "choice-desc", s.description));
      if (s.benefit && s.benefit !== "—") card.appendChild(el("span", "choice-benefit", s.benefit));
      card.onclick = function () { draft.source = s.id; render(); };
      cards.appendChild(card);
    });
    wrap.appendChild(cards);
    return wrap;
  }

  // At creation the character is at tier of play 1, so skills and proficiencies
  // can only be taken as high as tier 1 allows.
  function creationLevelCap() {
    return Math.min(CONFIG.MAX_SKILL_TIER, 1 + CONFIG.LEVEL_CAPS.skillOffset);
  }

  // ---- steps 4 & 5: spending points --------------------------------------
  function costsForSkill(pool) { return CONFIG.SKILL_COSTS[pool]; }
  function costsForProf(kindId) {
    var k = Engine.findKind(kindId);
    return k ? CONFIG.SKILL_COSTS[k.costKey] : [0, 0, 0, 0];
  }

  function pointsSpent(skills, profs, pool) {
    var total = 0;
    Object.keys(skills).forEach(function (n) { total += Engine.sumSteps(costsForSkill(pool), skills[n]); });
    profs.forEach(function (p) { total += Engine.sumSteps(costsForProf(p.kind), p.tier || 0); });
    return total;
  }

  function stepCombat() {
    return spender({
      lead: "Spend " + CREATION.combatPoints + " points on combat skills and weapon proficiencies. " +
            "These use the normal advancement costs, but cost no exp.",
      budget: CREATION.combatPoints,
      pool: "combat",
      skills: window.SKILLS.combat,
      skillStore: draft.combatSkills,
      profStore: draft.combatProfs,
      kinds: (window.PROFICIENCY_KINDS || []).filter(function (k) { return k.pool === "combat"; }),
    });
  }

  function stepNoncombat() {
    var req = CREATION.requiredProficiencies || {};
    var reqText = Object.keys(req).map(function (k) { return req[k] + " " + k; }).join(" and ");
    return spender({
      lead: "Spend " + CREATION.noncombatPoints + " points on non-combat skills and proficiencies — " +
            "including at least " + reqText + ".",
      budget: CREATION.noncombatPoints,
      pool: "noncombat",
      skills: window.SKILLS.noncombat,
      skillStore: draft.ncSkills,
      profStore: draft.ncProfs,
      kinds: (window.PROFICIENCY_KINDS || []).filter(function (k) { return k.pool === "noncombat"; }),
    });
  }

  function spender(opts) {
    var wrap = el("div");
    wrap.appendChild(el("p", "step-lead", opts.lead));

    var spent = pointsSpent(opts.skillStore, opts.profStore, opts.pool);
    var left = opts.budget - spent;

    var meter = el("div", "budget-meter" + (left < 0 ? " over" : left === 0 ? " done" : ""));
    meter.appendChild(el("span", "budget-label", "Points"));
    meter.appendChild(el("span", "budget-value", spent + " / " + opts.budget));
    meter.appendChild(el("span", "budget-left", left === 0 ? "all spent" : left > 0 ? left + " left" : Math.abs(left) + " over"));
    wrap.appendChild(meter);

    // Skills
    var cap = creationLevelCap();
    wrap.appendChild(el("div", "sheet-hint",
      "At tier of play 1 nothing can be taken above level " + cap + "."));

    var grid = el("div", "skill-grid");
    var costs = costsForSkill(opts.pool);
    opts.skills.forEach(function (sk) {
      var tier = opts.skillStore[sk.name] || 0;
      var row = el("div", "skill-row");
      var name = el("div", "skill-name");
      name.appendChild(el("span", "skill-name-text", sk.name));
      name.appendChild(el("span", "skill-char", abbr(sk.char)));
      row.appendChild(name);
      row.appendChild(dots(tier, CONFIG.MAX_SKILL_TIER, costs, left, function (v) {
        if (v > 0) opts.skillStore[sk.name] = v; else delete opts.skillStore[sk.name];
        render();
      }, cap));
      row.appendChild(el("div", "skill-hint",
        tier >= cap ? (tier >= CONFIG.MAX_SKILL_TIER ? "max" : "tier cap") : "next " + costs[tier]));
      grid.appendChild(row);
    });
    wrap.appendChild(grid);

    // Proficiencies
    opts.kinds.forEach(function (kind) {
      var pcosts = CONFIG.SKILL_COSTS[kind.costKey];
      var sec = el("div", "sub-section");
      var h = el("h3", "sub-title", kind.label + " proficiencies");
      h.appendChild(el("span", "group-note", "(" + pcosts.join(", ") + " pts)"));
      sec.appendChild(h);

      var dl = el("datalist"); dl.id = "cw-suggest-" + kind.id;
      (kind.suggestions || []).forEach(function (n) { var o = el("option"); o.value = n; dl.appendChild(o); });
      sec.appendChild(dl);

      opts.profStore.forEach(function (p, idx) {
        if (p.kind !== kind.id) return;
        var row = el("div", "prof-row");
        var input = el("input", "prof-name");
        input.value = p.name; input.placeholder = "name…";
        input.setAttribute("list", "cw-suggest-" + kind.id);
        input.oninput = function () { opts.profStore[idx].name = input.value; };
        input.onchange = function () { render(); };
        row.appendChild(input);
        row.appendChild(dots(p.tier || 0, CONFIG.MAX_SKILL_TIER, pcosts, left, function (v) {
          opts.profStore[idx].tier = v; render();
        }, cap));
        var del = el("button", "icon-btn", "✕"); del.type = "button"; del.title = "Remove";
        del.onclick = function () { opts.profStore.splice(idx, 1); render(); };
        row.appendChild(del);
        sec.appendChild(row);
      });

      var add = el("button", "prof-add", "+ Add " + kind.label); add.type = "button";
      add.onclick = function () { opts.profStore.push({ name: "", kind: kind.id, tier: 1 }); render(); };
      sec.appendChild(add);
      wrap.appendChild(sec);
    });

    return wrap;
  }

  // Dots that refuse to push you over budget, or past the tier's level cap.
  function dots(value, max, costs, pointsLeft, onSet, cap) {
    cap = cap == null ? max : cap;
    var row = el("div", "dots");
    for (var i = 0; i < max; i++) {
      (function (i) {
        var target = value === i + 1 ? i : i + 1;
        var delta = Engine.stepCost(costs, Math.min(value, target), Math.max(value, target));
        var raising = target > value;
        var beyondCap = i + 1 > cap;
        var allowed = !raising || (delta <= pointsLeft && !beyondCap);
        var dot = el("button", "dot" + (i < value ? " filled" : "") +
          (allowed ? "" : " disabled") + (beyondCap ? " capped" : ""));
        dot.type = "button";
        dot.title = beyondCap ? "Beyond the tier of play cap"
          : raising ? ("+" + delta + " pts") : "refund";
        dot.disabled = !allowed;
        dot.onclick = function () { onSet(target); };
        row.appendChild(dot);
      })(i);
    }
    return row;
  }

  // ---- step 6: review -----------------------------------------------------
  function stepReview() {
    var wrap = el("div");
    wrap.appendChild(el("p", "step-lead",
      "Everything below is granted free. After creating, you will have " +
      CREATION.freeExp.combat + " combat and " + CREATION.freeExp.noncombat +
      " non-combat exp to spend as you like."));

    var anc = Engine.ancestryById(draft.ancestry);
    var src = Engine.sourceById(draft.source);

    wrap.appendChild(reviewBlock("Characteristics", CONFIG.CHARACTERISTICS.map(function (c) {
      return c.label + " " + (draft.chars[c.key] || 0);
    })));

    var ancLines = [anc ? anc.name : "—"];
    draft.ancestralTalents.forEach(function (id) {
      var t = Engine.talentById(id);
      if (t) ancLines.push("Talent: " + t.name);
    });
    wrap.appendChild(reviewBlock("Ancestry", ancLines));

    var srcLines = [src ? src.name : "—"];
    if (src && src.benefit && src.benefit !== "—") srcLines.push(src.benefit);
    wrap.appendChild(reviewBlock("Source of Power", srcLines));

    var combatLines = Object.keys(draft.combatSkills).map(function (n) { return n + " " + draft.combatSkills[n]; })
      .concat(draft.combatProfs.filter(function (p) { return p.name; })
        .map(function (p) { return p.name + " " + p.tier; }));
    wrap.appendChild(reviewBlock("Combat Training", combatLines.length ? combatLines : ["—"]));

    var ncLines = Object.keys(draft.ncSkills).map(function (n) { return n + " " + draft.ncSkills[n]; })
      .concat(draft.ncProfs.filter(function (p) { return p.name; })
        .map(function (p) { return p.name + " " + p.tier + " (" + p.kind + ")"; }));
    wrap.appendChild(reviewBlock("Background", ncLines.length ? ncLines : ["—"]));

    return wrap;
  }

  function reviewBlock(title, lines) {
    var b = el("div", "review-block");
    b.appendChild(el("h3", "review-title", title));
    var ul = el("ul", "review-list");
    lines.forEach(function (l) { ul.appendChild(el("li", null, l)); });
    b.appendChild(ul);
    return b;
  }

  // ---- randomization ------------------------------------------------------
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  function shuffle(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function randomChars() {
    var values = shuffle(CREATION.characteristicArray);
    draft.chars = {};
    CONFIG.CHARACTERISTICS.forEach(function (c, i) { draft.chars[c.key] = values[i]; });
  }

  function randomAncestry() {
    var picks = CREATION.ancestralTalentPicks;
    // Only ancestries a player could actually pick (grouping-only ones excluded).
    var all = (window.ANCESTRIES || []).filter(function (a) { return Engine.ancestryPickable(a); });
    // Prefer those that can offer the required picks (own tree or an ancestor's);
    // fall back to any pickable so a sparse database still rolls.
    var viable = all.filter(function (a) { return Engine.creationPicksForChain(a.id).length >= picks; });
    var a = pick(viable.length ? viable : all);
    if (!a) return;
    draft.ancestry = a.id;
    draft.ancestralTalents = shuffle(Engine.creationPicksForChain(a.id))
      .slice(0, picks)
      .map(function (t) { return t.id; });
  }

  function randomSource() {
    var s = pick(window.SOURCES || []);
    if (s) draft.source = s.id;
  }

  // Pick a proficiency name this list isn't already using.
  function freshProfName(kind, store) {
    var taken = store.map(function (p) { return (p.name || "").toLowerCase(); });
    var free = (kind.suggestions || []).filter(function (n) { return taken.indexOf(n.toLowerCase()) < 0; });
    return free.length ? pick(free) : pick(kind.suggestions || ["Unnamed"]);
  }

  // Spend exactly `budget` by repeatedly applying a random affordable advance.
  // Raising an untouched skill to tier 1 always costs the cheapest step on the
  // curve, so while any skill remains untouched there is always a 1-point move
  // available — which is what lets the budget land exactly on zero rather than
  // stranding a point. Required proficiency kinds are bought first so a run of
  // unlucky picks can never crowd them out.
  function randomSpend(opts) {
    Object.keys(opts.skillStore).forEach(function (k) { delete opts.skillStore[k]; });
    opts.profStore.length = 0;
    var spent = 0;

    Object.keys(opts.required || {}).forEach(function (kindId) {
      var kind = Engine.findKind(kindId);
      if (!kind) return;
      var costs = CONFIG.SKILL_COSTS[kind.costKey];
      for (var n = 0; n < opts.required[kindId]; n++) {
        if (spent + costs[0] > opts.budget) return;
        opts.profStore.push({ name: freshProfName(kind, opts.profStore), kind: kindId, tier: 1 });
        spent += costs[0];
      }
    });

    var cap = creationLevelCap();
    var guard = 0;
    while (spent < opts.budget && guard++ < 500) {
      var left = opts.budget - spent;
      var moves = [];

      opts.skills.forEach(function (sk) {
        var t = opts.skillStore[sk.name] || 0;
        if (t >= cap) return;
        var c = CONFIG.SKILL_COSTS[opts.pool][t];
        if (c <= left) moves.push({ cost: c, apply: function () { opts.skillStore[sk.name] = t + 1; } });
      });

      opts.profStore.forEach(function (p) {
        var kind = Engine.findKind(p.kind);
        if (!kind) return;
        var t = p.tier || 0;
        if (t >= cap) return;
        var c = CONFIG.SKILL_COSTS[kind.costKey][t];
        if (c <= left) moves.push({ cost: c, apply: function () { p.tier = t + 1; } });
      });

      opts.kinds.forEach(function (kind) {
        var c = CONFIG.SKILL_COSTS[kind.costKey][0];
        var have = opts.profStore.filter(function (p) { return p.kind === kind.id; }).length;
        if (c <= left && have < 3) {         // keep the roster readable
          moves.push({ cost: c, apply: function () {
            opts.profStore.push({ name: freshProfName(kind, opts.profStore), kind: kind.id, tier: 1 });
          } });
        }
      });

      if (!moves.length) break;
      var m = pick(moves);
      m.apply();
      spent += m.cost;
    }
    return spent;
  }

  function randomCombat() {
    randomSpend({
      budget: CREATION.combatPoints, pool: "combat",
      skills: window.SKILLS.combat,
      skillStore: draft.combatSkills, profStore: draft.combatProfs,
      kinds: (window.PROFICIENCY_KINDS || []).filter(function (k) { return k.pool === "combat"; }),
    });
  }

  function randomNoncombat() {
    randomSpend({
      budget: CREATION.noncombatPoints, pool: "noncombat",
      skills: window.SKILLS.noncombat,
      skillStore: draft.ncSkills, profStore: draft.ncProfs,
      kinds: (window.PROFICIENCY_KINDS || []).filter(function (k) { return k.pool === "noncombat"; }),
      required: CREATION.requiredProficiencies,
    });
  }

  var RANDOMIZERS = {
    chars: randomChars, ancestry: randomAncestry, source: randomSource,
    combat: randomCombat, noncombat: randomNoncombat,
  };

  function randomizeAll() {
    randomChars(); randomAncestry(); randomSource(); randomCombat(); randomNoncombat();
    draft.step = STEPS.length - 1;      // land on Review, ready to confirm
  }

  // ---- validation ---------------------------------------------------------
  function validateStep(i) {
    var key = STEPS[i].key;

    if (key === "chars") {
      var want = CREATION.characteristicArray.slice().sort().join(",");
      var got = CONFIG.CHARACTERISTICS
        .map(function (c) { return draft.chars[c.key]; })
        .filter(function (v) { return v != null; }).sort().join(",");
      if (got !== want) return "Assign every value: " + CREATION.characteristicArray.join(", ");
      return null;
    }

    if (key === "ancestry") {
      if (!draft.ancestry) return "Choose an ancestry.";
      if (!Engine.ancestryPickable(draft.ancestry)) return "That ancestry can't be chosen — pick a sub-ancestry.";
      var picks = CREATION.ancestralTalentPicks;
      if (draft.ancestralTalents.length !== picks)
        return "Pick " + picks + " ancestral talent" + (picks === 1 ? "" : "s") + ".";
      return null;
    }

    if (key === "source") return draft.source ? null : "Choose a source of power.";

    if (key === "combat") {
      var spent = pointsSpent(draft.combatSkills, draft.combatProfs, "combat");
      if (spent !== CREATION.combatPoints) return "Spend exactly " + CREATION.combatPoints + " points (" + spent + " spent).";
      var unnamed = draft.combatProfs.filter(function (p) { return !p.name.trim(); }).length;
      if (unnamed) return "Name every proficiency you added.";
      return null;
    }

    if (key === "noncombat") {
      var s2 = pointsSpent(draft.ncSkills, draft.ncProfs, "noncombat");
      if (s2 !== CREATION.noncombatPoints) return "Spend exactly " + CREATION.noncombatPoints + " points (" + s2 + " spent).";
      var un2 = draft.ncProfs.filter(function (p) { return !p.name.trim(); }).length;
      if (un2) return "Name every proficiency you added.";
      var req = CREATION.requiredProficiencies || {};
      var missing = Object.keys(req).filter(function (kindId) {
        var have = draft.ncProfs.filter(function (p) {
          return p.kind === kindId && p.name.trim() && (p.tier || 0) >= 1;
        }).length;
        return have < req[kindId];
      });
      if (missing.length) return "You still need at least " +
        missing.map(function (k) { return req[k] + " " + k; }).join(" and ") + ".";
      return null;
    }

    if (key === "review") {
      for (var j = 0; j < STEPS.length - 1; j++) {
        var p = validateStep(j);
        if (p) return "Step " + (j + 1) + ": " + p;
      }
      return null;
    }
    return null;
  }

  // ---- commit -------------------------------------------------------------
  function finish() {
    var src = Engine.sourceById(draft.source);

    // Sources of power and ancestries never grant skills, proficiencies or
    // talents, so the free baseline is purely what the player spent their
    // creation points on, plus the ancestral talent they picked.
    var gSkills = {};
    function addSkill(name, tier) { gSkills[name] = Math.max(gSkills[name] || 0, tier || 0); }
    Object.keys(draft.combatSkills).forEach(function (n) { addSkill(n, draft.combatSkills[n]); });
    Object.keys(draft.ncSkills).forEach(function (n) { addSkill(n, draft.ncSkills[n]); });

    // Granted proficiencies, merged by name+kind.
    var profList = [];
    function addProf(p) {
      if (!p || !p.name || !p.name.trim()) return;
      var name = p.name.trim();
      var hit = profList.filter(function (x) {
        return x.name.toLowerCase() === name.toLowerCase() && x.kind === p.kind;
      })[0];
      if (hit) hit.tier = Math.max(hit.tier, p.tier || 0);
      else profList.push({ name: name, kind: p.kind, tier: p.tier || 0 });
    }
    draft.combatProfs.forEach(addProf);
    draft.ncProfs.forEach(addProf);

    var gProfs = {};
    profList.forEach(function (p) { gProfs[p.name] = Math.max(gProfs[p.name] || 0, p.tier); });

    // The only free talent is the ancestral one the player chose.
    var gTalents = draft.ancestralTalents
      .filter(function (v, i, a) { return a.indexOf(v) === i; });

    // The assigned array becomes the fixed characteristic baseline; from here on
    // characteristics only move via tier-of-play advancement.
    var baseChars = {};
    CONFIG.CHARACTERISTICS.forEach(function (c) { baseChars[c.key] = draft.chars[c.key] || 0; });

    var ancestry = Engine.ancestryById(draft.ancestry);

    State.update(function (s) {
      Object.keys(s.skills).forEach(function (n) { s.skills[n] = 0; });
      Object.keys(gSkills).forEach(function (n) { s.skills[n] = gSkills[n]; });

      s.proficiencies = profList.map(function (p) { return { name: p.name, kind: p.kind, tier: p.tier }; });
      s.talents = gTalents.slice();
      s.charAdvances = {};
      s.granted = {
        talents: gTalents.slice(), skills: gSkills, proficiencies: gProfs,
        characteristics: baseChars,
      };

      s.creation = { completed: true, skipped: false, ancestry: draft.ancestry, source: draft.source };
      s.identity.ancestry = ancestry ? ancestry.name : "";
      s.identity.sourceOfPower = src ? src.name : "";
      s.expEarned = { combat: CREATION.freeExp.combat, noncombat: CREATION.freeExp.noncombat };
    });

    window.location.href = "sheet.html";
  }

  function abbr(key) {
    var c = (CONFIG.CHARACTERISTICS || []).filter(function (x) { return x.key === key; })[0];
    return c ? c.abbr : key;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
