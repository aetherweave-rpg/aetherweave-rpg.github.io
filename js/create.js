// ============================================================================
// Character Creation wizard (create.html)
// ----------------------------------------------------------------------------
// Eight prompted steps, run before anything else on a new character. The
// defining trait and background are free (state.granted); the training in steps
// 6 and 7 is bought with the starting skill exp, like any later purchase, and
// must reach creation's minimums. All numbers come from js/data/creation.js.
// ============================================================================

(function () {
  var Engine = window.Engine, State = window.State, UI = window.UI, el = UI.el;
  var CONFIG = window.CONFIG, CREATION = window.CREATION;

  // Weapon and Spellcasting proficiency names are drawn from a fixed, exhaustive
  // set (weapon categories; magical domain names) — a dropdown, never free text.
  // Crafting and Instrument stay open-ended (autocomplete over suggestions).
  var EXHAUSTIVE_PROF_KINDS = ["weapon", "spellcasting"];
  function profOptionsForKind(kind) {
    if (kind.id === "spellcasting")
      return Engine.magicalDomains().map(function (d) { return d.name; });
    return kind.suggestions || [];
  }
  function selectInput(options, val, onChange) {
    var s = el("select", "prof-name");
    options.forEach(function (name) {
      var op = el("option", null, name);
      op.value = name;
      if (name === val) op.selected = true;
      s.appendChild(op);
    });
    s.onchange = function () { onChange(s.value); };
    return s;
  }

  // Working copy — nothing touches the saved character until Finish.
  var draft = null;

  function freshDraft() {
    return {
      step: 0,
      chars: {},              // characteristic key -> assigned value
      ancestry: null,
      expandedAncestors: [],  // grouping-only ancestry ids manually expanded
      source: null,
      traits: [],             // picked defining-trait ids
      backgrounds: [],        // picked background ids (exactly one)
      grantChoices: {},       // talent id -> [option key] for the ones that grant a choice
      combatSkills: {},       // name -> level set in step 6
      combatProfs: [],        // [{ name, kind, tier }]
      ncSkills: {},
      ncProfs: [],
    };
  }

  var STEPS = [
    { key: "chars",      title: "Characteristics",     short: "Characteristics" },
    { key: "ancestry",   title: "Ancestry",            short: "Ancestry" },
    { key: "source",     title: "Source of Power",     short: "Power" },
    { key: "trait",      title: "Defining Trait",      short: "Trait" },
    { key: "background", title: "Background",          short: "Background" },
    { key: "combat",     title: "Combat Training",     short: "Combat" },
    { key: "noncombat",  title: "Non-combat Training", short: "Non-combat" },
    { key: "review",     title: "Review",              short: "Review" },
  ];

  function startingExp() {
    var s = CREATION.startingExp || {};
    return { skill: s.skill || 0, talent: s.talent || 0 };
  }
  function trainingMinimum(category) {
    return (CREATION.trainingMinimum || {})[category] || 0;
  }
  function otherCategory(category) { return category === "combat" ? "noncombat" : "combat"; }

  function init() {
    draft = freshDraft();
    UI.renderHeader("create", { minimal: true });
    UI.renderFooter();
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
      trait: stepTrait, background: stepBackground,
      combat: stepCombat, noncombat: stepNoncombat, review: stepReview,
    };
    body.appendChild(builders[step.key]());
    host.appendChild(body);

    host.appendChild(footer());
  }

  // Re-gates the Next / Create button without rebuilding the step. A full
  // render() would recurse: the grant chooser reports its state while it is
  // being built, which happens inside render() itself.
  function refreshFooter() {
    var host = document.getElementById("wizard");
    var old = host && host.querySelector(".wizard-footer");
    if (old) host.replaceChild(footer(), old);
  }

  function intro() {
    var box = el("div", "wizard-intro");
    box.appendChild(el("span", "wizard-intro-icon", "❖"));
    var t = el("div");
    var exp = startingExp();
    t.appendChild(el("div", "wizard-intro-title", "Create your character"));
    t.appendChild(el("div", "wizard-intro-sub",
      "You start with " + exp.skill + " skill exp and " + exp.talent + " talent exp. " +
      "Your training in steps 6 and 7 is paid from the skill exp. Whatever is left, you spend after creation."));
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
      "Assign " + values.join(", ") + " across the five characteristics."));

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
    return (window.ANCESTRIES || []).filter(function (a) { return (a.parent || null) === (parentId || null) && !a.hidden; });
  }

  function stepAncestry() {
    var wrap = el("div");
    wrap.appendChild(el("p", "step-lead",
      "Choose an ancestry. It says who your people are, and grants nothing."));

    // Ancestries render as an indented hierarchy; click a pickable node to
    // become that ancestry, or a grouping-only ("category") node to expand it
    // and reveal its sub-ancestries. Selecting an ancestry also keeps its own
    // chain expanded (e.g. so randomizing straight to a sub-ancestry still
    // shows the path that got you there).
    var expanded = draft.ancestry ? Engine.ancestryChain(draft.ancestry) : [];
    expanded = expanded.concat(draft.expandedAncestors);
    var listWrap = el("div", "ancestry-tree");
    // Once a category's subtree is unrolled, it stays unrolled all the way
    // down — a pickable node partway down (e.g. Wood Elf) has no toggle of
    // its own, so its children must inherit the ancestor's expansion rather
    // than needing to be separately expanded (which would make them
    // unreachable).
    (function renderLevel(parentId, depth, unrolled) {
      ancestryChildren(parentId).forEach(function (a) {
        if (depth > 0 && !unrolled) return;
        var pickable = Engine.ancestryPickable(a);
        var selected = draft.ancestry === a.id;
        // Pickable ancestries are buttons that select them; grouping-only ones
        // are buttons that just toggle their children open.
        var row = el("button",
          "ancestry-row" + (selected ? " chosen" : "") + (pickable ? "" : " category"));
        row.type = "button";
        row.style.setProperty("--accent", a.accent);
        row.style.paddingLeft = (12 + depth * 22) + "px";
        if (depth > 0) row.appendChild(el("span", "ancestry-branch", "↳"));
        row.appendChild(el("span", "ancestry-row-icon", a.icon || a.name.charAt(0)));
        var txt = el("div", "ancestry-row-text");
        var nameLine = el("div", "ancestry-row-name", a.name);
        if (depth === 1) nameLine.appendChild(el("span", "ancestry-tag", "sub"));
        else if (depth >= 2) nameLine.appendChild(el("span", "ancestry-tag", "sub-sub"));
        if (!pickable) nameLine.appendChild(el("span", "ancestry-tag",
          expanded.indexOf(a.id) >= 0 ? "▾ sub-ancestries" : "▸ sub-ancestries"));
        txt.appendChild(nameLine);
        if (a.description) txt.appendChild(el("div", "ancestry-row-desc", a.description));
        row.appendChild(txt);
        if (pickable) row.onclick = function () {
          draft.ancestry = a.id;
          render();
        };
        else row.onclick = function () {
          var i = draft.expandedAncestors.indexOf(a.id);
          if (i >= 0) draft.expandedAncestors.splice(i, 1);
          else draft.expandedAncestors.push(a.id);
          render();
        };
        listWrap.appendChild(row);
        renderLevel(a.id, depth + 1, unrolled || expanded.indexOf(a.id) >= 0);
      });
    })(null, 0, false);
    wrap.appendChild(listWrap);

    return wrap;
  }

  // ---- steps 4 & 5: the two catalogues ------------------------------------
  // A defining trait and a background are the same thing mechanically: a free
  // talent, exactly one, sitting in no tree. So they get the same step — the
  // wording and which list it draws from are the only differences.
  function catalogueStep(opts) {
    var wrap = el("div");
    var picked = opts.picked, picks = opts.picks;
    wrap.appendChild(el("p", "step-lead",
      opts.lead + " Pick " + picks + " (" + picked.length + "/" + picks + " chosen)."));

    if (!opts.options.length) wrap.appendChild(el("div", "sheet-hint", opts.emptyHint));

    var list = el("div", "pick-grid");
    opts.options.forEach(function (t) {
      var chosen = picked.indexOf(t.id) >= 0;
      var card = el("button", "pick-card" + (chosen ? " chosen" : ""));
      card.type = "button";
      var head = el("div", "pick-head");
      head.appendChild(el("span", "pick-icon", t.icon || t.name.charAt(0)));
      head.appendChild(el("span", "pick-name", t.name));
      if (t.ability && t.ability !== "passive")
        head.appendChild(el("span", "ancestry-tag", Engine.entryKindName(t)));
      UI.tagChips(t).forEach(function (chip) { head.appendChild(chip); });
      card.appendChild(head);
      // Hooks resolve against the picks made so far — nothing is owned yet,
      // so a card normally reads as its un-modified base text (§4.7).
      var cardState = { talents: pickedTalents() };
      card.appendChild(el("span", "pick-desc", Engine.resolveText(t.description, cardState)));
      var cardTest = UI.renderTest(t, cardState, { cls: "pick-test" });
      if (cardTest) card.appendChild(cardTest);
      card.onclick = function () {
        var i = picked.indexOf(t.id);
        if (i >= 0) picked.splice(i, 1);
        else if (picked.length < picks) picked.push(t.id);
        else { picked.length = 0; picked.push(t.id); }   // picks==1 → clicking swaps
        pruneGrantChoices();
        render();
      };
      list.appendChild(card);
    });
    wrap.appendChild(list);

    // A pick that hands out a choice (Jack of all trades) resolves it here,
    // inline, rather than in the learn-time modal the trees page uses: the
    // wizard is a step flow, and this reads like every other pick grid in it.
    // Same UI.grantChooser underneath, so the rules match.
    picked.forEach(function (id) {
      var t = Engine.talentById(id);
      if (!t || !Engine.grantNeedsChoice(t)) return;
      var gs = el("div", "sub-section");
      gs.appendChild(el("h3", "sub-title", t.name + ": " + UI.grantLede(t).replace(/\.$/, "")));
      // Seeded, not restored afterwards: the chooser reports its state once
      // during setup, and an empty report would clobber choices the step
      // randomizer had already rolled.
      var chooser = UI.grantChooser(gs, t, draftState(), function (ok, keys) {
        draft.grantChoices[id] = keys;
        refreshFooter();              // the Next button follows the selection
      }, draft.grantChoices[id] || []);
      gs.appendChild(chooser.tally);
      wrap.appendChild(gs);
    });
    return wrap;
  }

  // The one thing that sets the character apart before play begins.
  function stepTrait() {
    return catalogueStep({
      lead: "Choose what sets you apart.",
      emptyHint: "No defining traits authored yet.",
      options: Engine.traits(),
      picked: draft.traits,
      picks: CREATION.definingTraitPicks,
    });
  }

  // Where they came from. Exactly one, and it grants its ability outright.
  function stepBackground() {
    return catalogueStep({
      lead: "Choose where you come from.",
      emptyHint: "No backgrounds authored yet.",
      options: Engine.backgrounds(),
      picked: draft.backgrounds,
      picks: 1,
    });
  }

  // Everything picked from either catalogue: one flat list, because that is
  // what the character will own and what a grant is qualified against.
  function pickedTalents() {
    return draft.traits.concat(draft.backgrounds)
      .filter(function (v, i, a) { return a.indexOf(v) === i; });
  }

  // Drop choices belonging to picks that have since been deselected.
  function pruneGrantChoices() {
    var picked = pickedTalents();
    Object.keys(draft.grantChoices).forEach(function (id) {
      if (picked.indexOf(id) < 0) delete draft.grantChoices[id];
    });
  }

  // The training set in steps 6 and 7: skills by name, proficiencies merged by
  // name and kind. A row not named yet stays a row of its own: it already
  // costs its exp, and the step will not pass until it has a name.
  function draftTraining() {
    var skills = {};
    function addSkill(name, tier) { if (tier > 0) skills[name] = Math.max(skills[name] || 0, tier); }
    Object.keys(draft.combatSkills).forEach(function (n) { addSkill(n, draft.combatSkills[n]); });
    Object.keys(draft.ncSkills).forEach(function (n) { addSkill(n, draft.ncSkills[n]); });

    var profs = [];
    draft.combatProfs.concat(draft.ncProfs).forEach(function (p) {
      var name = (p.name || "").trim();
      var hit = name && profs.filter(function (x) {
        return x.name.toLowerCase() === name.toLowerCase() && x.kind === p.kind;
      })[0];
      if (hit) hit.tier = Math.max(hit.tier, p.tier || 0);
      else profs.push({ name: name, kind: p.kind, tier: p.tier || 0 });
    });
    return { skills: skills, proficiencies: profs };
  }

  // A character-shaped object for the grant chooser: the picks and the training
  // so far, with NO grant applied yet. The chooser is deciding what a grant
  // hands out, so it has to see the character without it; that is also what
  // flags a pick the training already paid for. Skills and proficiencies are
  // set in steps 6 and 7, after step 4, so they are usually empty here, but
  // coming back to step 4 later still shows them.
  function draftState() {
    var training = draftTraining();
    return {
      talents: pickedTalents(),
      skills: training.skills,
      proficiencies: training.proficiencies,
      characteristics: draft.chars || {},
      granted: { talents: [], skills: {}, proficiencies: {} },
      creation: {
        completed: false, ancestry: draft.ancestry, source: draft.source,
        trait: draft.traits[0] || null, background: draft.backgrounds[0] || null,
      },
    };
  }

  // The character exactly as Finish will write it: the picks granted, the
  // training bought with the starting skill exp, and whatever a pick's grant
  // hands out applied on top. Every exp figure the wizard shows (the meters,
  // the price on a dot, what is left) is read off this, so none of them can
  // disagree with the sheet the player lands on. A grant that covers a level
  // the training bought makes that level free, which is the refund rule of
  // §4.9 working here exactly as it does later.
  function candidate() {
    var training = draftTraining();
    var picks = pickedTalents();
    var baseChars = {};
    CONFIG.CHARACTERISTICS.forEach(function (c) { baseChars[c.key] = draft.chars[c.key] || 0; });
    var s = {
      characteristics: Object.assign({}, baseChars),
      skills: training.skills,
      proficiencies: training.proficiencies,
      talents: picks.slice(),
      expEarned: startingExp(),
      granted: { talents: picks.slice(), skills: {}, proficiencies: {}, characteristics: baseChars },
      grantChoices: {},
      charAdvances: {},
      creation: {
        completed: false, ancestry: draft.ancestry, source: draft.source,
        trait: draft.traits[0] || null, background: draft.backgrounds[0] || null,
      },
    };
    picks.forEach(function (id) {
      var t = Engine.talentById(id);
      if (t && Engine.grantsOf(t)) Engine.applyGrants(s, id, draft.grantChoices[id] || []);
    });
    return s;
  }

  // True once every pick's grant has a legal selection.
  function grantChoicesResolved() {
    return pickedTalents().every(function (id) {
      var t = Engine.talentById(id);
      if (!t || !Engine.grantNeedsChoice(t)) return true;
      return Engine.grantSelectionValid(t, draftState(), draft.grantChoices[id] || []).ok;
    });
  }

  // ---- step 3: source of power -------------------------------------------
  function stepSource() {
    var wrap = el("div");
    wrap.appendChild(el("p", "step-lead",
      "Choose where your power comes from. On its own it does not grant skills or talents " +
      "directly, but may grant a unique talent each tier of play."));

    var cards = el("div", "card-grid");
    (window.SOURCES || []).filter(function (s) { return !s.hidden; }).forEach(function (s) {
      var card = el("button", "choice-card" + (draft.source === s.id ? " chosen" : ""));
      card.type = "button";
      card.style.setProperty("--accent", s.accent);
      card.appendChild(el("span", "choice-icon", s.icon));
      card.appendChild(el("span", "choice-name", s.name));
      card.appendChild(el("span", "choice-desc", s.description));
      card.onclick = function () { draft.source = s.id; render(); };
      cards.appendChild(card);
    });
    wrap.appendChild(cards);

    var src = Engine.sourceById(draft.source);
    if (src) {
      var sub = el("div", "sub-section");
      sub.appendChild(el("h3", "sub-title", src.name + " benefits"));
      sub.appendChild(el("div", "sheet-hint",
        "Spellcasting attribute: " + Engine.charLabel(src.characteristic)));
      var list = el("div", "pick-grid");
      (src.talents || []).slice().sort(function (a, b) { return (a.tier || 1) - (b.tier || 1); })
        .forEach(function (t) {
          var card2 = el("div", "pick-card");
          var head = el("div", "pick-head");
          head.appendChild(el("span", "pick-icon", t.icon || t.name.charAt(0)));
          head.appendChild(el("span", "pick-name", "Tier " + (t.tier || 1) + ": " + t.name));
          UI.tagChips(t).forEach(function (chip) { head.appendChild(chip); });
          card2.appendChild(head);
          var card2State = { talents: pickedTalents() };
          card2.appendChild(el("span", "pick-desc", Engine.resolveText(t.description, card2State)));
          var card2Test = UI.renderTest(t, card2State, { cls: "pick-test" });
          if (card2Test) card2.appendChild(card2Test);
          list.appendChild(card2);
        });
      sub.appendChild(list);
      wrap.appendChild(sub);
    }
    return wrap;
  }

  // A new character is at tier of play 1 (its starting exp is nowhere near the
  // tier 2 threshold), so training can only be taken as high as tier 1 allows.
  function creationLevelCap() {
    return Math.min(CONFIG.MAX_SKILL_TIER, 1 + CONFIG.LEVEL_CAPS.skillOffset);
  }

  // ---- steps 6 & 7: buying training ---------------------------------------
  function stepKinds(category) {
    return (window.PROFICIENCY_KINDS || []).filter(function (k) { return Engine.trainingCategory(k) === category; });
  }

  function stepCombat() {
    return trainingStep({
      category: "combat",
      lead: "Spend at least " + trainingMinimum("combat") + " skill exp on combat skills and combat proficiencies.",
      skills: window.SKILLS.combat,
      skillStore: draft.combatSkills,
      profStore: draft.combatProfs,
      kinds: stepKinds("combat"),
    });
  }

  function stepNoncombat() {
    var req = CREATION.requiredProficiencies || {};
    var reqText = Object.keys(req).map(function (k) { return req[k] + " " + k; }).join(" and ");
    return trainingStep({
      category: "noncombat",
      lead: "Spend at least " + trainingMinimum("noncombat") + " skill exp on non-combat skills and proficiencies." +
            (reqText ? " You need at least " + reqText + " proficiency." : ""),
      skills: window.SKILLS.noncombat,
      skillStore: draft.ncSkills,
      profStore: draft.ncProfs,
      kinds: stepKinds("noncombat"),
    });
  }

  // What the training steps are working against, read off the candidate once
  // per render. `available` is what a raise in this category may still cost:
  // the skill exp left, less whatever the OTHER category still needs to reach
  // its own minimum, so spending here can never strand the other step short.
  function trainingBudget(category) {
    var cand = candidate();
    var spent = Engine.computeSpent(cand);
    var start = startingExp().skill;
    var other = otherCategory(category);
    var reserve = Math.max(0, trainingMinimum(other) - spent.training[other]);
    return {
      cand: cand, spent: spent, start: start,
      left: start - spent.skill,
      available: start - spent.skill - reserve,
      need: trainingMinimum(category), have: spent.training[category],
    };
  }

  function meter(cls, label, value, note, state) {
    var m = el("div", "budget-meter " + cls + (state ? " " + state : ""));
    m.appendChild(el("span", "budget-label", label));
    m.appendChild(el("span", "budget-value", value));
    m.appendChild(el("span", "budget-left", note));
    return m;
  }

  function trainingStep(opts) {
    var wrap = el("div");
    wrap.appendChild(el("p", "step-lead", opts.lead));

    var b = trainingBudget(opts.category);
    var meters = el("div", "budget-row");
    var toGo = b.need - b.have;
    meters.appendChild(meter("training", opts.category === "combat" ? "Combat training" : "Non-combat training",
      b.have + " / " + b.need, toGo > 0 ? toGo + " to go" : "minimum met", toGo > 0 ? "" : "done"));
    meters.appendChild(meter("skill-exp", "Skill exp", b.spent.skill + " / " + b.start,
      b.left >= 0 ? b.left + " left" : Math.abs(b.left) + " over", b.left < 0 ? "over" : ""));
    wrap.appendChild(meters);

    var cap = creationLevelCap();
    if (cap < CONFIG.MAX_SKILL_TIER) {
      wrap.appendChild(el("div", "sheet-hint",
        "At tier of play 1 nothing can be taken above level " + cap + "."));
    }

    // Skills. A level a pick's grant covers is shown as granted: it is free,
    // and raising the skill costs only the steps above it.
    var grid = el("div", "skill-grid");
    var costs = CONFIG.SKILL_COSTS[opts.category];
    opts.skills.forEach(function (sk) {
      var floor = Engine.grantedSkillTier(b.cand, sk.name);
      var value = Math.max(opts.skillStore[sk.name] || 0, floor);
      var row = el("div", "skill-row");
      var name = el("div", "skill-name");
      name.appendChild(el("span", "skill-name-text", sk.name));
      name.appendChild(el("span", "skill-char", Engine.skillChars(sk).map(abbr).join("/")));
      row.appendChild(name);
      row.appendChild(dots(value, CONFIG.MAX_SKILL_TIER, costs, b.available, function (v) {
        if (v > floor) opts.skillStore[sk.name] = v; else delete opts.skillStore[sk.name];
        render();
      }, cap, floor, floor ? grantedBy(b.cand, "skill", sk.name) : null));
      grid.appendChild(row);
    });
    wrap.appendChild(grid);

    // Proficiencies a pick already grants in this category don't have a row
    // here, but they are already the character's, and they count toward a
    // required kind. Naming one in a row below raises it from where the grant
    // left it.
    var grantedHere = b.cand.proficiencies.filter(function (p) {
      var kind = Engine.findKind(p.kind);
      return kind && Engine.trainingCategory(kind) === opts.category && Engine.grantedProfTier(b.cand, p.name) > 0;
    });
    if (grantedHere.length) {
      wrap.appendChild(el("div", "sheet-hint",
        "Your picks already grant: " + grantedHere.map(function (p) {
          return p.name + " " + Engine.grantedProfTier(b.cand, p.name) + " (" + p.kind + ")";
        }).join(", ") + "."));
    }

    opts.kinds.forEach(function (kind) {
      var pcosts = CONFIG.SKILL_COSTS[kind.costKey];
      var exhaustive = EXHAUSTIVE_PROF_KINDS.indexOf(kind.id) >= 0;
      var kindOptions = profOptionsForKind(kind);
      var sec = el("div", "sub-section");
      var h = el("h3", "sub-title", kind.label + " proficiencies");
      sec.appendChild(h);

      var dl = null;
      if (!exhaustive) {
        dl = el("datalist"); dl.id = "cw-suggest-" + kind.id;
        kindOptions.forEach(function (n) { var o = el("option"); o.value = n; dl.appendChild(o); });
        sec.appendChild(dl);
      }

      opts.profStore.forEach(function (p, idx) {
        if (p.kind !== kind.id) return;
        var floor = (p.name || "").trim() ? Engine.grantedProfTier(b.cand, p.name.trim()) : 0;
        var row = el("div", "prof-row");
        var input;
        if (exhaustive) {
          input = selectInput(kindOptions, p.name, function (v) { opts.profStore[idx].name = v; render(); });
          if (!kindOptions.length) { input.disabled = true; input.title = "No " + kind.label.toLowerCase() + " options defined"; }
        } else {
          input = el("input", "prof-name");
          input.value = p.name; input.placeholder = "name…";
          input.setAttribute("list", "cw-suggest-" + kind.id);
          input.oninput = function () { opts.profStore[idx].name = input.value; };
          input.onchange = function () { render(); };
        }
        row.appendChild(input);
        row.appendChild(dots(Math.max(p.tier || 0, floor), CONFIG.MAX_SKILL_TIER, pcosts, b.available, function (v) {
          opts.profStore[idx].tier = v; render();
        }, cap, floor, floor ? grantedBy(b.cand, "proficiency", p.name.trim()) : null));
        var del = el("button", "icon-btn", "✕"); del.type = "button"; del.title = "Remove";
        del.onclick = function () { opts.profStore.splice(idx, 1); render(); };
        row.appendChild(del);
        sec.appendChild(row);
      });

      var add = el("button", "prof-add", "+ Add " + kind.label); add.type = "button";
      var firstCost = pcosts[0];
      if (exhaustive && !kindOptions.length) {
        add.disabled = true;
        add.title = "No " + kind.label.toLowerCase() + " options defined";
      } else if (firstCost > b.available) {
        add.disabled = true;
        add.title = "Not enough skill exp left";
      }
      add.onclick = function () {
        opts.profStore.push({ name: exhaustive ? (kindOptions[0] || "") : "", kind: kind.id, tier: 1 });
        render();
      };
      sec.appendChild(add);
      wrap.appendChild(sec);
    });

    return wrap;
  }

  function grantedBy(state, kind, name) {
    var src = Engine.grantSource(state, kind, name);
    return src ? "Granted by " + src.name : "Granted";
  }

  // Dots priced in skill exp from the level the row is at. They refuse a raise
  // that costs more than `available` or passes the tier's level cap, and never
  // go below `floor`, the level a grant covers for free.
  function dots(value, max, costs, available, onSet, cap, floor, grantedTitle) {
    cap = cap == null ? max : cap;
    floor = floor || 0;
    var row = el("div", "dots");
    for (var i = 0; i < max; i++) {
      (function (i) {
        var target = Math.max(value === i + 1 ? i : i + 1, floor);
        var delta = Engine.stepCost(costs, Math.min(value, target), Math.max(value, target));
        var raising = target > value;
        var isGranted = i < floor;
        var beyondCap = i + 1 > cap;
        var allowed = !raising || (delta <= available && !beyondCap);
        var dot = el("button", "dot" + (i < value ? " filled" : "") + (isGranted ? " granted" : "") +
          (allowed ? "" : " disabled") + (beyondCap ? " capped" : ""));
        dot.type = "button";
        dot.title = isGranted ? grantedTitle + ", free"
          : beyondCap ? "Beyond the tier of play cap"
          : raising ? ("+" + delta + " exp") : "refund";
        dot.disabled = !allowed;
        dot.onclick = function () { if (target !== value) onSet(target); };
        row.appendChild(dot);
      })(i);
    }
    return row;
  }

  // ---- step 8: review -----------------------------------------------------
  function stepReview() {
    var wrap = el("div");

    var anc = Engine.ancestryById(draft.ancestry);
    var src = Engine.sourceById(draft.source);

    wrap.appendChild(reviewBlock("Characteristics", CONFIG.CHARACTERISTICS.map(function (c) {
      return c.label + " " + (draft.chars[c.key] || 0);
    })));

    wrap.appendChild(reviewBlock("Ancestry", [anc ? anc.name : "—"]));

    var srcLines = [src ? src.name : "—"];
    if (src && src.benefit && src.benefit !== "—") srcLines.push(src.benefit);
    wrap.appendChild(reviewBlock("Source of Power", srcLines));

    // What a pick hands out is part of the character, so it belongs in the
    // review rather than appearing unannounced on the sheet.
    function catalogueLines(ids) {
      var lines = [];
      ids.forEach(function (id) {
        var t = Engine.talentById(id);
        if (!t) return;
        lines.push(t.name);
        var picked = draft.grantChoices[id] || [];
        if (!picked.length) return;
        var byKey = {};
        Engine.grantOptions(t, draftState()).forEach(function (o) { byKey[o.key] = o; });
        picked.forEach(function (k) {
          if (byKey[k]) lines.push("Granted: " + byKey[k].label);
        });
      });
      return lines.length ? lines : ["—"];
    }
    wrap.appendChild(reviewBlock("Defining Trait", catalogueLines(draft.traits)));
    wrap.appendChild(reviewBlock("Background", catalogueLines(draft.backgrounds)));

    var combatLines = Object.keys(draft.combatSkills).map(function (n) { return n + " " + draft.combatSkills[n]; })
      .concat(draft.combatProfs.filter(function (p) { return p.name; })
        .map(function (p) { return p.name + " " + p.tier; }));
    wrap.appendChild(reviewBlock("Combat Training", combatLines.length ? combatLines : ["—"]));

    var ncLines = Object.keys(draft.ncSkills).map(function (n) { return n + " " + draft.ncSkills[n]; })
      .concat(draft.ncProfs.filter(function (p) { return p.name; })
        .map(function (p) { return p.name + " " + p.tier + " (" + p.kind + ")"; }));
    wrap.appendChild(reviewBlock("Non-combat Training", ncLines.length ? ncLines : ["—"]));

    // What is left over is what the sheet will point at once this is created.
    var left = Engine.expRemaining(candidate());
    wrap.appendChild(reviewBlock("Exp left to spend", Engine.EXP_POOLS.map(function (p) {
      return p.label + " exp " + left[p.id];
    })));

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
    // Only ancestries a player could actually pick (grouping-only ones excluded).
    var a = pick((window.ANCESTRIES || []).filter(function (x) {
      return Engine.ancestryPickable(x) && !x.hidden;
    }));
    if (a) draft.ancestry = a.id;
  }

  function randomTrait() {
    draft.traits = shuffle(Engine.traits())
      .slice(0, CREATION.definingTraitPicks)
      .map(function (t) { return t.id; });
    randomizeGrantChoices();
  }

  function randomBackground() {
    draft.backgrounds = shuffle(Engine.backgrounds()).slice(0, 1)
      .map(function (t) { return t.id; });
    randomizeGrantChoices();
  }

  // A rolled character has to be complete, so anything the rolled traits
  // grant is rolled too. Blocked options are skipped: they would not validate.
  function randomizeGrantChoices() {
    draft.grantChoices = {};
    pickedTalents().forEach(function (id) {
      var t = Engine.talentById(id);
      if (!t || !Engine.grantNeedsChoice(t)) return;
      var g = Engine.grantsOf(t);
      var open = shuffle(Engine.grantOptions(t, draftState()).filter(function (o) { return o.available; }));
      var keys = [];
      if (g.mode === "budget") {
        var left = g.count;
        open.forEach(function (o) { if (o.cost <= left) { keys.push(o.key); left -= o.cost; } });
      } else {
        keys = open.slice(0, g.count).map(function (o) { return o.key; });
      }
      draft.grantChoices[id] = keys;
    });
  }

  function randomSource() {
    var s = pick((window.SOURCES || []).filter(function (s) { return !s.hidden; }));
    if (s) draft.source = s.id;
  }

  // A proficiency name of this kind the character does not hold yet, whether
  // bought or granted, or null when every option is taken. A name already held
  // would merge into the existing row and cost less than the move was priced at.
  function freshProfName(kind) {
    var held = candidate().proficiencies.map(function (p) { return p.name.toLowerCase(); })
      .concat(draft.combatProfs.concat(draft.ncProfs).map(function (p) { return (p.name || "").toLowerCase(); }));
    var free = profOptionsForKind(kind).filter(function (n) { return held.indexOf(n.toLowerCase()) < 0; });
    return free.length ? pick(free) : null;
  }

  // Spend exactly a step's minimum, one random affordable advance at a time,
  // priced on the character as it stands: a pick's grant may already cover a
  // level, and then only the next one costs. Raising an untouched skill to 1
  // costs the cheapest step on the curve, so while any skill is untouched there
  // is a 1-exp move, which is what lets the spend land on the minimum exactly.
  // Required proficiency kinds the character does not already hold are bought
  // first, so a run of unlucky picks can never crowd them out.
  function randomSpend(opts) {
    Object.keys(opts.skillStore).forEach(function (k) { delete opts.skillStore[k]; });
    opts.profStore.length = 0;
    var target = trainingMinimum(opts.category);
    function spentHere() { return Engine.computeSpent(candidate()).training[opts.category]; }

    Object.keys(opts.required || {}).forEach(function (kindId) {
      var kind = Engine.findKind(kindId);
      if (!kind) return;
      var creation = Engine.creationMinimums(candidate()).filter(function (m) { return m.id === kindId; })[0];
      var missing = creation ? creation.need - creation.have : 0;
      for (var n = 0; n < missing; n++) {
        var name = freshProfName(kind);
        if (!name || spentHere() + CONFIG.SKILL_COSTS[kind.costKey][0] > target) return;
        opts.profStore.push({ name: name, kind: kindId, tier: 1 });
      }
    });

    var cap = creationLevelCap();
    for (var guard = 0; guard < 500; guard++) {
      var cand = candidate();
      var left = target - Engine.computeSpent(cand).training[opts.category];
      if (left <= 0) break;
      var moves = [];

      opts.skills.forEach(function (sk) {
        var t = cand.skills[sk.name] || 0;
        if (t >= cap) return;
        var c = CONFIG.SKILL_COSTS[opts.category][t];
        if (c <= left) moves.push(function () { opts.skillStore[sk.name] = t + 1; });
      });

      opts.profStore.forEach(function (p) {
        var kind = Engine.findKind(p.kind);
        if (!kind) return;
        var t = Math.max(p.tier || 0, Engine.grantedProfTier(cand, p.name));
        if (t >= cap) return;
        var c = CONFIG.SKILL_COSTS[kind.costKey][t];
        if (c <= left) moves.push(function () { p.tier = t + 1; });
      });

      opts.kinds.forEach(function (kind) {
        var c = CONFIG.SKILL_COSTS[kind.costKey][0];
        var have = opts.profStore.filter(function (p) { return p.kind === kind.id; }).length;
        if (c > left || have >= 3) return;             // keep the roster readable
        var name = freshProfName(kind);
        if (name) moves.push(function () { opts.profStore.push({ name: name, kind: kind.id, tier: 1 }); });
      });

      if (!moves.length) break;
      pick(moves)();
    }
  }

  function randomCombat() {
    randomSpend({
      category: "combat",
      skills: window.SKILLS.combat,
      skillStore: draft.combatSkills, profStore: draft.combatProfs,
      kinds: stepKinds("combat"),
    });
  }

  function randomNoncombat() {
    randomSpend({
      category: "noncombat",
      skills: window.SKILLS.noncombat,
      skillStore: draft.ncSkills, profStore: draft.ncProfs,
      kinds: stepKinds("noncombat"),
      required: CREATION.requiredProficiencies,
    });
  }

  var RANDOMIZERS = {
    chars: randomChars, ancestry: randomAncestry, source: randomSource,
    trait: randomTrait, background: randomBackground,
    combat: randomCombat, noncombat: randomNoncombat,
  };

  function randomizeAll() {
    randomChars(); randomAncestry(); randomSource(); randomTrait(); randomBackground();
    randomCombat(); randomNoncombat();
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
      if (!Engine.ancestryPickable(draft.ancestry)) return "Not directly choosable; pick a sub-ancestry.";
      return null;
    }

    if (key === "source") return draft.source ? null : "Choose a source of power.";

    if (key === "trait") {
      var picks = CREATION.definingTraitPicks;
      if (draft.traits.length !== picks)
        return "Pick " + picks + " defining trait" + (picks === 1 ? "" : "s") + ".";
      if (!grantChoicesResolved()) return "Finish the choices your defining trait grants.";
      return null;
    }

    // Exactly one background — unless the database offers none at all, which is
    // an authoring gap the validator reports rather than a wall for the player.
    if (key === "background") {
      if (!Engine.backgrounds().length) return null;
      if (!draft.backgrounds.length) return "Choose a background.";
      if (!grantChoicesResolved()) return "Finish the choices your background grants.";
      return null;
    }

    if (key === "combat" || key === "noncombat") {
      var cand = candidate();
      var minimums = Engine.creationMinimums(cand);
      var training = minimums.filter(function (m) { return m.id === key; })[0];
      if (training && !training.met)
        return "Spend at least " + training.need + " skill exp here (" + training.have + " spent).";
      var store = key === "combat" ? draft.combatProfs : draft.ncProfs;
      if (store.some(function (p) { return !(p.name || "").trim(); })) return "Name every proficiency you added.";
      var spent = Engine.computeSpent(cand).skill, start = startingExp().skill;
      if (spent > start) return "Your training costs " + spent + " skill exp, but you start with " + start + ".";
      if (key === "noncombat") {
        var req = CREATION.requiredProficiencies || {};
        var missing = minimums.filter(function (m) { return req[m.id] && !m.met; });
        if (missing.length) return "You still need at least " +
          missing.map(function (m) { return m.need + " " + m.id; }).join(" and ") + ".";
      }
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
    var ancestry = Engine.ancestryById(draft.ancestry);
    // The same object every figure in the wizard was read from.
    var built = candidate();

    State.update(function (s) {
      Object.keys(s.skills).forEach(function (n) { s.skills[n] = 0; });
      Object.keys(built.skills).forEach(function (n) { s.skills[n] = built.skills[n]; });

      s.proficiencies = built.proficiencies;
      s.talents = built.talents;
      s.charAdvances = {};
      s.grantChoices = built.grantChoices;
      // Only the picks and their grants are free. The assigned array is the
      // fixed characteristic baseline; from here on characteristics only move
      // via tier-of-play advancement.
      s.granted = built.granted;

      s.creation = {
        completed: true, skipped: false,
        ancestry: draft.ancestry, source: draft.source,
        trait: draft.traits[0] || null, background: draft.backgrounds[0] || null,
      };
      s.identity.ancestry = ancestry ? ancestry.name : "";
      s.identity.sourceOfPower = src ? src.name : "";
      s.expEarned = startingExp();
    });

    // The sheet opens on what is left to spend, and where (UI.takeSpendReminder).
    UI.queueSpendReminder();
    window.location.href = "sheet.html";
  }

  function abbr(key) {
    var c = (CONFIG.CHARACTERISTICS || []).filter(function (x) { return x.key === key; })[0];
    return c ? c.abbr : key;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
