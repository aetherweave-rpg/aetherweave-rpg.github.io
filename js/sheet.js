// ============================================================================
// Character Sheet page (sheet.html): identity, HP, characteristics, exp totals,
// skills, proficiencies, a learned-talents summary, and export/import/reset.
// Mirrors character_sheet_fillable.tex; all exp math is shared with the tree.
// ============================================================================

(function () {
  var Engine = window.Engine, State = window.State, UI = window.UI, el = UI.el, CONFIG = window.CONFIG;

  // Weapon and Spellcasting proficiency names are drawn from a fixed, exhaustive
  // set (weapon categories; magical domain names) — a dropdown, never free text.
  // Crafting and Instrument stay open-ended (autocomplete over suggestions).
  var EXHAUSTIVE_PROF_KINDS = ["weapon", "spellcasting"];

  function init() {
    UI.renderHeader("sheet");
    UI.renderFooter();
    UI.renderStorageWarning();
    UI.renderCreationGate();
    UI.bindPrint(function () {
      var n = (State.get().identity.characterName || "aetherweave-character").trim();
      return n + " · character sheet";
    }, renderPrint);
    render();
    State.subscribe(function () { UI.renderHeader("sheet"); render(); });
    // Straight after creation: what is left to spend, then arrows at where.
    UI.takeSpendReminder(function () {
      UI.renderHeader("sheet");
      render();
      var arrow = document.querySelector(".spend-arrow-after");
      if (arrow && arrow.scrollIntoView) arrow.scrollIntoView({ block: "center" });
    });
  }

  // The paper copy is a whole second document (js/print-sheet.js), rebuilt
  // alongside this one so it is never out of date with what is on screen,
  // display toggles (skillsGroupByChar) included.
  function renderPrint() { window.PrintSheet.render(State.get(), { skillsGroupByChar: skillsGroupByChar }); }

  function render() {
    var root = document.getElementById("sheet");
    if (!root) return;
    var state = State.get();
    root.innerHTML = "";
    root.appendChild(creationSection(state));
    root.appendChild(identitySection(state));
    root.appendChild(statsSection(state));
    root.appendChild(expSection(state));
    root.appendChild(skillsSection(state));
    root.appendChild(profSection(state));
    root.appendChild(inventorySection(state));
    [abilitiesSection, maneuversSection, companionsSection].forEach(function (fn) {
      var s = fn(state);
      if (s) root.appendChild(s);
    });
    root.appendChild(dataSection());
    renderPrint();
  }

  function section(title, note) {
    var s = el("section", "sheet-section");
    var h = el("h2", "sheet-h2", title);
    if (note) h.appendChild(el("span", "sheet-h2-note", note));
    s.appendChild(h);
    return s;
  }

  // A reusable "dots" control (skills, characteristics). Click a dot to set the
  // value; click the current highest dot to step back down. Dots below `min`
  // were granted (by a talent, a defining trait or a background): they are
  // free and cannot be lowered. `grantedTitle` names the source. Training
  // bought at creation is not granted, so it lowers like any purchase.
  function dots(value, max, onSet, min, cap, grantedTitle) {
    min = min || 0;
    cap = cap == null ? max : cap;
    var row = el("div", "dots");
    for (var i = 0; i < max; i++) {
      (function (i) {
        var isGranted = i < min;
        var beyondCap = i + 1 > cap;
        var dot = el("button", "dot" + (i < value ? " filled" : "") +
          (isGranted ? " granted" : "") + (beyondCap ? " capped" : ""));
        dot.type = "button";
        dot.setAttribute("aria-label", "set to " + (i + 1));
        if (isGranted) dot.title = grantedTitle || "Granted, free";
        else if (beyondCap) dot.title = "Locked until a higher tier of play";
        dot.disabled = beyondCap && i + 1 > value;
        dot.onclick = function () {
          var target = value === i + 1 ? i : i + 1;
          if (target > cap) target = cap;
          onSet(Math.max(target, min));
        };
        row.appendChild(dot);
      })(i);
    }
    return row;
  }

  // Non-interactive dots, for values the player does not edit directly.
  function readonlyDots(value, max, cap) {
    var row = el("div", "dots dots-readonly");
    for (var i = 0; i < max; i++) {
      var d = el("span", "dot" + (i < value ? " filled" : "") + (i + 1 > cap ? " capped" : ""));
      if (i + 1 > cap) d.title = "Locked until a higher tier of play";
      row.appendChild(d);
    }
    return row;
  }

  // ---- Character creation summary ----------------------------------------
  function creationSection(state) {
    var c = state.creation || {};
    var s = section("Character Creation");

    if (!c.completed) {
      var hint = el("div", "sheet-hint", "This character hasn't been through creation. ");
      hint.appendChild(link("Run character creation", "create.html"));
      hint.appendChild(document.createTextNode(" to assign characteristics, an ancestry, a source of power, a defining trait and a background."));
      s.appendChild(hint);
      return s;
    }

    var anc = Engine.ancestryById(c.ancestry);
    var src = Engine.sourceById(c.source);
    var trait = Engine.characterTrait(state);
    var background = Engine.characterBackground(state);
    var row = el("div", "creation-row");

    [[anc, "Ancestry"], [src, "Source of Power"],
     [trait, "Defining Trait"], [background, "Background"]].forEach(function (pair) {
      var obj = pair[0];
      var card = el("div", "creation-card");
      card.appendChild(el("span", "creation-card-label", pair[1]));
      var body = el("div", "creation-card-body");
      body.appendChild(el("span", "creation-icon", obj ? obj.icon : "—"));
      var t = el("div");
      t.appendChild(el("div", "creation-name", obj ? obj.name : "—"));
      if (obj) t.appendChild(el("div", "creation-desc", obj.benefit || obj.flavour || obj.description));
      body.appendChild(t);
      card.appendChild(body);
      row.appendChild(card);
    });
    s.appendChild(row);

    var redo = el("button", "btn btn-danger", "↺ Redo character creation");
    redo.type = "button";
    redo.onclick = function () {
      if (confirm("Redo character creation? This clears the current character entirely.")) {
        State.reset();
        window.location.href = "create.html";
      }
    };
    s.appendChild(redo);
    return s;
  }

  // Text/number input that saves silently while typing (keeps focus) and does a
  // full re-render on blur so dependent sections reconcile.
  function textInput(value, onType, opts) {
    opts = opts || {};
    var inp = el("input", opts.cls || "");
    if (opts.type) inp.type = opts.type;
    if (opts.placeholder) inp.placeholder = opts.placeholder;
    if (opts.list) inp.setAttribute("list", opts.list);
    inp.value = value == null ? "" : value;
    inp.oninput = function () { onType(inp.value); };
    inp.onchange = function () { State.notify(); };
    return inp;
  }

  // ---- Identity -----------------------------------------------------------
  function identitySection(state) {
    var s = section("Identity");
    var grid = el("div", "id-grid");

    [["characterName", "Character Name"], ["playerName", "Player Name"]].forEach(function (f) {
      var field = el("label", "id-field");
      field.appendChild(el("span", "id-label", f[1]));
      field.appendChild(textInput(state.identity[f[0]], function (v) {
        State.update(function (s2) { s2.identity[f[0]] = v; }, true);
      }, { cls: "id-input" }));
      grid.appendChild(field);
    });

    // Fixed by character creation, not free text — always reflects the actual choice.
    var anc = Engine.ancestryById(state.creation && state.creation.ancestry);
    var src = Engine.sourceById(state.creation && state.creation.source);
    [["Ancestry", anc], ["Source of Power", src]].forEach(function (pair) {
      var field = el("label", "id-field");
      field.appendChild(el("span", "id-label", pair[0]));
      field.appendChild(el("span", "id-input id-fixed", pair[1] ? pair[1].name : "—"));
      grid.appendChild(field);
    });

    var notesField = el("label", "id-field id-field-wide");
    notesField.appendChild(el("span", "id-label", "Notes"));
    notesField.appendChild(textInput(state.identity.notes, function (v) {
      State.update(function (s2) { s2.identity.notes = v; }, true);
    }, { cls: "id-input" }));
    grid.appendChild(notesField);

    s.appendChild(grid);
    return s;
  }

  // ---- HP + Characteristics ----------------------------------------------
  function statsSection(state) {
    var s = section("Characteristics & HP");
    var topRow = el("div", "vitals-row");

    var hp = el("div", "hp-box");
    hp.appendChild(el("div", "stat-title", "HP"));
    var hpRow = el("div", "hp-row");
    var hpMaxField = el("label", "hp-field");
    hpMaxField.appendChild(el("span", "hp-label", "Max"));
    hpMaxField.appendChild(el("span", "hp-input hp-computed", String(Engine.maxHP(state))));
    hpRow.appendChild(hpMaxField);
    var hpCurField = el("label", "hp-field");
    hpCurField.appendChild(el("span", "hp-label", "Current"));
    hpCurField.appendChild(textInput(state.hp.current, function (v) {
      State.update(function (s2) { s2.hp.current = v; }, true);
    }, { cls: "hp-input", type: "number" }));
    hpRow.appendChild(hpCurField);
    hp.appendChild(hpRow);
    topRow.appendChild(hp);
    s.appendChild(topRow);

    var charRow = el("div", "char-row");
    var charCap = Engine.characteristicCap(state);
    CONFIG.CHARACTERISTICS.forEach(function (c) {
      var box = el("div", "char-box");
      var head = el("div", "char-head");
      head.appendChild(el("span", "char-name", c.label));
      head.appendChild(el("span", "char-abbr", c.abbr));
      box.appendChild(head);
      // Read-only: characteristics move only via tier-of-play advancement.
      box.appendChild(readonlyDots(state.characteristics[c.key] || 0, CONFIG.MAX_CHARACTERISTIC, charCap));
      charRow.appendChild(box);
    });
    s.appendChild(charRow);

    var adv = charAdvanceBlock(state);
    if (adv) s.appendChild(adv);
    return s;
  }

  // Each tier of play after the first lets the character raise
  // CHARACTERISTIC_ADVANCES_PER_TIER *different* characteristics by one. Only
  // rendered once there's an advancement to show — nothing to explain otherwise.
  function charAdvanceBlock(state) {
    var per = CONFIG.CHARACTERISTIC_ADVANCES_PER_TIER;
    var tiers = Engine.charAdvanceTiers(state);
    if (!tiers.length) return null;
    var block = el("div", "adv-block");

    var head = el("h3", "sub-title", "Characteristic advancement");
    var left = Engine.charAdvancesRemaining(state);
    head.appendChild(el("span", "group-note",
      left ? left + " increase" + (left === 1 ? "" : "s") + " unspent" : "all spent"));
    block.appendChild(head);

    var cap = Engine.characteristicCap(state);
    tiers.forEach(function (t) {
      var picks = Engine.charAdvancePicks(state, t);
      var row = el("div", "adv-row");
      row.appendChild(el("span", "adv-tier", (CONFIG.TIERS[t - 1] || {}).name || ("Tier " + t)));
      row.appendChild(el("span", "adv-count", picks.length + "/" + per));

      var opts = el("div", "adv-options");
      CONFIG.CHARACTERISTICS.forEach(function (c) {
        var chosen = picks.indexOf(c.key) >= 0;
        var atCap = !chosen && (state.characteristics[c.key] || 0) >= cap;
        var full = !chosen && picks.length >= per;
        var b = el("button", "adv-btn" + (chosen ? " chosen" : ""), c.abbr);
        b.type = "button";
        b.disabled = atCap || full;
        b.title = atCap ? c.label + " is already at the tier cap (" + cap + ")"
          : full ? "Both increases for this tier are already assigned"
          : c.label;
        b.onclick = function () {
          State.update(function (s2) {
            var arr = (s2.charAdvances[String(t)] || []).slice();
            var i = arr.indexOf(c.key);
            if (i >= 0) arr.splice(i, 1);
            else if (arr.length < per) arr.push(c.key);
            s2.charAdvances[String(t)] = arr;
          });
        };
        opts.appendChild(b);
      });
      row.appendChild(opts);
      block.appendChild(row);
    });

    block.appendChild(el("div", "sheet-hint",
      "Two different characteristics per tier. Repeatable next tier."));
    return block;
  }

  // ---- Experience ---------------------------------------------------------
  function expSection(state) {
    var s = section("Experience Points");
    var spent = Engine.computeSpent(state);
    var remaining = Engine.expRemaining(state, spent);
    var wrap = el("div", "exp-wrap");

    Engine.EXP_POOLS.forEach(function (p) {
      var pool = p.id;
      var box = el("div", "exp-pool");
      box.dataset.pool = pool;
      box.appendChild(el("div", "exp-pool-title", p.icon + " " + p.label + " exp"));
      var grid = el("div", "exp-pool-grid");

      var earned = el("div", "exp-cell");
      earned.appendChild(el("div", "exp-cell-label", "Earned"));
      earned.appendChild(textInput(state.expEarned[pool], function (v) {
        State.update(function (s2) { s2.expEarned[pool] = Number(v) || 0; }, true);
        UI.renderHeader("sheet");
      }, { cls: "exp-earned-input", type: "number" }));
      grid.appendChild(earned);

      grid.appendChild(expReadout("Spent", spent[pool], false));
      grid.appendChild(expReadout("Remaining", remaining[pool], remaining[pool] < 0));

      box.appendChild(grid);
      wrap.appendChild(box);
    });

    s.appendChild(wrap);

    // Where the spent exp actually went, including tree-access surcharges:
    // the skill exp lines first, then the talent exp ones.
    var b = spent.breakdown;
    var parts = [
      ["Skills", b.skills], ["Proficiencies", b.proficiencies], ["Spellcasting", b.spellcasting],
      ["Talents", b.talents], ["Tree access", b.treeAccess],
    ].filter(function (p) { return p[1] > 0; });

    if (parts.length) {
      var bd = el("div", "exp-breakdown");
      bd.appendChild(el("span", "exp-breakdown-label", "Spent on"));
      parts.forEach(function (p) {
        var chip = el("span", "exp-chip");
        chip.appendChild(el("span", "exp-chip-name", p[0]));
        chip.appendChild(el("span", "exp-chip-value", p[1]));
        bd.appendChild(chip);
      });
      s.appendChild(bd);
    }

    var charges = Engine.treeAccessCharges(state);
    if (charges.length) {
      var tl = el("div", "tree-cost-list");
      tl.appendChild(el("span", "tree-cost-label", "Trees opened"));
      charges.forEach(function (c, i) {
        var chip = el("span", "tree-cost-chip" + (c.cost ? "" : " free"));
        chip.appendChild(el("span", "tcc-name", (i + 1) + ". " + c.name));
        chip.appendChild(el("span", "tcc-cost", c.cost ? "+" + c.cost : "free"));
        tl.appendChild(chip);
      });
      var next = Engine.nextTreeCost(state);
      if (next) tl.appendChild(el("span", "tree-cost-next", "next tree: +" + next + " exp"));
      s.appendChild(tl);
    }

    return s;
  }
  function expReadout(label, value, negative) {
    var cell = el("div", "exp-cell");
    cell.appendChild(el("div", "exp-cell-label", label));
    cell.appendChild(el("div", "exp-cell-value" + (negative ? " negative" : ""), value));
    return cell;
  }

  // ---- Skills -------------------------------------------------------------
  // Two views over the same skill data: the default Combat/Non-Combat pool
  // split (matches how exp is actually spent), or grouped by characteristic
  // (matches how a player picks skills to boost a specific dice pool). Both
  // render the same skillRow, just grouped and annotated differently.
  var SKILLS_BY_CHAR_KEY = "aetherweave.sheet.skillsByCharacteristic";
  var skillsGroupByChar = window.SafeStorage.read(SKILLS_BY_CHAR_KEY) === "1";

  function skillsSection(state) {
    var s = section("Skills");
    var h2 = s.querySelector(".sheet-h2");
    // Straight after the title it points back at; the toggle keeps the far end.
    var arrow = UI.reminderArrow(state, "skill", "after");
    if (arrow) h2.appendChild(arrow);
    h2.appendChild(skillModeToggle());
    var warning = minimumsWarning(state);
    if (warning) s.appendChild(warning);
    if (skillsGroupByChar) {
      CONFIG.CHARACTERISTICS.forEach(function (c) {
        var g = skillGroupByChar(c, state);
        if (g) s.appendChild(g);
      });
    } else {
      s.appendChild(skillGroup("Combat Skills", window.SKILLS.combat, state, "combat"));
      s.appendChild(skillGroup("Non-Combat Skills", window.SKILLS.noncombat, state, "noncombat"));
    }
    return s;
  }

  // Creation's training minimums outlive creation (Engine.creationMinimums).
  // Dropping below one is allowed, since a player may be rearranging, but the
  // sheet says so until it is fixed.
  function minimumsWarning(state) {
    var unmet = Engine.unmetCreationMinimums(state);
    if (!unmet.length) return null;
    var box = el("div", "minimums-warning");
    box.appendChild(el("span", "minimums-warning-head", "⚠ Below the creation minimums:"));
    box.appendChild(el("span", "minimums-warning-list", unmet.map(Engine.creationMinimumLabel).join(" · ")));
    return box;
  }

  // Raising, lowering or removing a skill or proficiency goes through here, so
  // the moment one takes the character below a creation minimum it also says so
  // in a toast, wherever on the sheet the edit happened.
  function updateTraining(mutator) {
    var before = Engine.unmetCreationMinimums(State.get()).map(function (m) { return m.id; });
    State.update(mutator);
    var broken = Engine.unmetCreationMinimums(State.get()).filter(function (m) {
      return before.indexOf(m.id) < 0;
    });
    if (broken.length)
      UI.toast("Below the creation minimum: " + broken.map(Engine.creationMinimumLabel).join(", "), "error");
  }

  function skillModeToggle() {
    var wrap = el("label", "combo-toggle");
    var cb = el("input");
    cb.type = "checkbox";
    cb.checked = skillsGroupByChar;
    cb.onchange = function () {
      skillsGroupByChar = cb.checked;
      window.SafeStorage.write(SKILLS_BY_CHAR_KEY, skillsGroupByChar ? "1" : "0");
      render();
    };
    wrap.appendChild(cb);
    wrap.appendChild(el("span", null, "Group skills by characteristic"));
    return wrap;
  }

  function skillGroup(title, list, state, costKey) {
    var costs = CONFIG.SKILL_COSTS[costKey];
    var g = el("div", "skill-group");
    g.appendChild(withNote(el("h3", "skill-group-title", title),
      "(" + costs.join(", ") + " exp · max " + Engine.skillCap(state) + " at this tier)"));
    var grid = el("div", "skill-grid");
    var cap = Engine.skillCap(state);
    list.forEach(function (sk) { grid.appendChild(skillRow(sk, state, cap)); });
    g.appendChild(grid);
    return g;
  }

  // Combat and non-combat skills cost from different curves, so a merged
  // characteristic group can't carry one cost note the way a category group
  // can; each row is tagged with its own category instead. A skill paired with
  // two characteristics is listed under both: two rows, one skill, one level.
  function skillGroupByChar(c, state) {
    var list = window.SKILLS.combat.map(function (sk) { return { sk: sk, category: "combat" }; })
      .concat(window.SKILLS.noncombat.map(function (sk) { return { sk: sk, category: "noncombat" }; }))
      .filter(function (entry) { return Engine.skillChars(entry.sk).indexOf(c.key) >= 0; });
    if (!list.length) return null;
    var g = el("div", "skill-group");
    var h = el("h3", "skill-group-title", c.label);
    h.appendChild(el("span", "char-abbr", c.abbr));
    g.appendChild(h);
    var grid = el("div", "skill-grid");
    var cap = Engine.skillCap(state);
    list.forEach(function (entry) { grid.appendChild(skillRow(entry.sk, state, cap, entry.category)); });
    g.appendChild(grid);
    return g;
  }

  function skillRow(sk, state, cap, showCategory) {
    var tier = state.skills[sk.name] || 0;
    var free = Engine.grantedSkillTier(state, sk.name);
    var row = el("div", "skill-row");
    var name = el("div", "skill-name");
    name.appendChild(el("span", "skill-name-text", sk.name));
    if (showCategory) name.appendChild(el("span", "skill-category-tag " + showCategory,
      showCategory === "combat" ? "combat" : "non-combat"));
    else name.appendChild(el("span", "skill-char", Engine.skillChars(sk).map(charAbbr).join("/")));
    row.appendChild(name);
    row.appendChild(dots(tier, CONFIG.MAX_SKILL_TIER, function (v) {
      updateTraining(function (s2) { s2.skills[sk.name] = v; });
    }, free, cap, free ? grantedBy(state, "skill", sk.name) + ", free" : null));
    return row;
  }

  // "Granted by X", X being the talent, trait or background whose grant handed
  // this out. A free level no grant accounts for just reads "Granted".
  // `kind`/`id` match Engine.grantSource's.
  function grantedBy(state, kind, id) {
    var src = Engine.grantSource(state, kind, id);
    return src ? "Granted by " + src.name : "Granted";
  }

  function withNote(h, note) { h.appendChild(el("span", "group-note", note)); return h; }

  // ---- Proficiencies ------------------------------------------------------
  // Two columns — non-combat kinds on the left, combat kinds on the right —
  // driven entirely by PROFICIENCY_KINDS' own `category`, so a new kind (of
  // either category) slots into the right side automatically with no layout
  // change.
  function profSection(state) {
    var s = section("Proficiencies");
    var wrap = el("div", "prof-wrap");
    ["noncombat", "combat"].forEach(function (category) {
      var side = el("div", "prof-side");
      window.PROFICIENCY_KINDS.filter(function (k) { return Engine.trainingCategory(k) === category; }).forEach(function (kind) {
        var costs = CONFIG.SKILL_COSTS[kind.costKey];
        var col = el("div", "prof-col");
        col.appendChild(withNote(el("h3", "prof-title", kind.label),
          "(" + costs.join(", ") + " exp · max " + Engine.skillCap(state) + " at this tier)"));

        // A Spellcasting proficiency is named after a magical domain, so its
        // suggestions are the domains that exist, not a static authored list.
        var suggestions = kind.id === "spellcasting"
          ? Engine.magicalDomains().map(function (d) { return d.name; })
          : (kind.suggestions || []);
        var exhaustive = EXHAUSTIVE_PROF_KINDS.indexOf(kind.id) >= 0;
        var dl = null;
        if (!exhaustive) {
          dl = el("datalist"); dl.id = "prof-suggest-" + kind.id;
          suggestions.forEach(function (name) { var o = el("option"); o.value = name; dl.appendChild(o); });
          col.appendChild(dl);
        }

        state.proficiencies.forEach(function (p, idx) {
          if (p.kind !== kind.id) return;
          var free = Engine.grantedProfTier(state, p.name);
          var row = el("div", "prof-row");
          var nameInput;
          if (exhaustive) {
            nameInput = selectInput(suggestions.map(function (n) { return { value: n, label: n }; }), p.name, function (v) {
              State.update(function (s2) { s2.proficiencies[idx].name = v; }, true);
            });
            nameInput.className = "prof-name";
            if (!suggestions.length) { nameInput.disabled = true; nameInput.title = "No " + kind.label.toLowerCase() + " options defined"; }
          } else {
            nameInput = textInput(p.name, function (v) {
              State.update(function (s2) { s2.proficiencies[idx].name = v; }, true);
            }, { cls: "prof-name", placeholder: "name…", list: "prof-suggest-" + kind.id });
          }
          if (free) {
            if (exhaustive) nameInput.disabled = true; else nameInput.readOnly = true;
            nameInput.title = grantedBy(state, "proficiency", p.name);
          }
          row.appendChild(nameInput);
          row.appendChild(dots(p.tier || 0, CONFIG.MAX_SKILL_TIER, function (v) {
            updateTraining(function (s2) { s2.proficiencies[idx].tier = v; });
          }, free, Engine.skillCap(state), free ? grantedBy(state, "proficiency", p.name) + ", free" : null));
          var del = el("button", "icon-btn", "✕");
          del.title = free ? grantedBy(state, "proficiency", p.name) + ", can't be removed" : "Remove";
          del.type = "button";
          del.disabled = !!free;
          del.onclick = function () { updateTraining(function (s2) { s2.proficiencies.splice(idx, 1); }); };
          row.appendChild(del);
          col.appendChild(row);
        });

        var add = el("button", "prof-add", "+ Add " + kind.label);
        add.type = "button";
        if (exhaustive && !suggestions.length) {
          add.disabled = true;
          add.title = "No " + kind.label.toLowerCase() + " options defined";
        }
        add.onclick = function () {
          State.update(function (s2) { s2.proficiencies.push({ name: exhaustive ? (suggestions[0] || "") : "", kind: kind.id, tier: 0 }); });
        };
        col.appendChild(add);
        side.appendChild(col);
      });
      wrap.appendChild(side);
    });
    s.appendChild(wrap);
    return s;
  }

  // ---- Inventory ------------------------------------------------------------
  // General gear is a free-text "box of lines" (like the paper sheet); carried
  // weapons are picked from the fixed WEAPON_CATEGORIES so the dice pool and
  // damage note can be computed rather than typed in.
  function selectInput(options, value, onChange) {
    var s = el("select", "inv-select");
    options.forEach(function (o) {
      var opt = el("option", "", o.label);
      opt.value = o.value;
      if (o.value === value) opt.selected = true;
      s.appendChild(opt);
    });
    s.onchange = function () { onChange(s.value); };
    return s;
  }

  function wieldingOptions(hands) {
    var opts = [];
    if (hands !== "2h") opts.push({ value: "1h", label: "One-Handed" });
    if (hands === "either") opts.push({ value: "2h", label: "Two-Handed" });
    if (hands !== "2h") opts.push({ value: "dual", label: "Dual-Wielding" });
    return opts;
  }

  // "Reach 4y" for a melee weapon with an extended reach, plain "30y" for a
  // true Ranged weapon — the wording main.tex itself uses (see Weapons).
  function weaponRangeLabel(cat) {
    if (cat.range === "melee") return "Melee";
    return cat.ranged ? (cat.range + "y") : ("Reach " + cat.range + "y");
  }

  function weaponPropsLabel(cat) {
    var bits = [charAbbr(cat.characteristic), weaponRangeLabel(cat)];
    if (cat.ranged) bits.push("Ranged");
    return bits.join(" · ");
  }

  // A read-only pip row (unlike the clickable `dots()` used for skills): the
  // dice pool is computed from characteristic + trained tier, not set directly.
  function pips(value, max) {
    var row = el("span", "inv-dots");
    for (var i = 0; i < max; i++) row.appendChild(el("span", "inv-dot" + (i < value ? " filled" : "")));
    return row;
  }

  function weaponHeadRow() {
    var row = el("div", "inv-weapon-head-row");
    var head = el("div", "inv-weapon-head");
    ["Weapon Type", "Properties", "Name / Description", "Wielded", "Dice Pool", "Damage"].forEach(function (label) {
      head.appendChild(el("span", "", label));
    });
    row.appendChild(head);
    // Matches the width of each row's remove button, so the grid's `1fr`
    // column computes against the same available width in both.
    row.appendChild(el("span", "inv-weapon-head-spacer"));
    return row;
  }

  function weaponRow(state, w, idx) {
    var categories = Engine.weaponCategories();
    var cat = Engine.weaponCategoryById(w.category) || categories[0];
    var maxDicePool = CONFIG.MAX_CHARACTERISTIC + CONFIG.MAX_SKILL_TIER;
    var row = el("div", "inv-weapon-row");
    var cells = el("div", "inv-weapon-cells");

    cells.appendChild(selectInput(
      categories.map(function (c) { return { value: c.id, label: c.label }; }),
      cat.id,
      function (v) {
        State.update(function (s2) {
          var w2 = s2.inventory.weapons[idx];
          w2.category = v;
          var newCat = Engine.weaponCategoryById(v);
          if (newCat.hands !== "either" && w2.wielding === "2h" && newCat.hands !== "2h") w2.wielding = "1h";
          if (newCat.hands === "2h") w2.wielding = "2h";
          // The damage choice belonged to the old category; drop it rather than
          // leave a weapon claiming a type its new category cannot deal.
          if ((newCat.damage || []).indexOf(w2.damage) < 0) delete w2.damage;
        });
      }
    ));

    cells.appendChild(el("span", "inv-wtype-props", weaponPropsLabel(cat)));

    cells.appendChild(textInput(w.name, function (v) {
      State.update(function (s2) { s2.inventory.weapons[idx].name = v; }, true);
    }, { cls: "inv-name", placeholder: "name (optional)…" }));

    if (cat.hands === "2h") {
      cells.appendChild(el("span", "inv-wield-fixed", "Two-Handed"));
    } else {
      cells.appendChild(selectInput(wieldingOptions(cat.hands), w.wielding, function (v) {
        State.update(function (s2) { s2.inventory.weapons[idx].wielding = v; });
      }));
    }

    var diceCell = el("div", "inv-wdice");
    diceCell.appendChild(pips(Engine.weaponDicePool(state, cat.id), maxDicePool));
    cells.appendChild(diceCell);

    // Which defense this weapon is aimed at. A category offering only one kind
    // states it; one offering several puts the choice on the weapon, the same
    // way `hands: "either"` puts the wielding choice here (§4.10).
    var dmgCell = el("div", "inv-wdmg-cell");
    var dmgTypes = Engine.weaponDamageTypes(cat.id);
    var dmgType = Engine.weaponDamageType(w);
    if (dmgTypes.length > 1) {
      dmgCell.appendChild(selectInput(
        dmgTypes.map(function (d) { return { value: d, label: Engine.defenseLabel(d) }; }),
        dmgType,
        function (v) { State.update(function (s2) { s2.inventory.weapons[idx].damage = v; }); }
      ));
    } else if (dmgType) {
      dmgCell.appendChild(el("span", "inv-wdmg-type", Engine.defenseLabel(dmgType)));
    }
    dmgCell.appendChild(el("span", "inv-wdmg", Engine.weaponDamageNote(w.wielding)));
    cells.appendChild(dmgCell);

    row.appendChild(cells);

    var del = el("button", "icon-btn", "✕");
    del.type = "button";
    del.title = "Remove";
    del.onclick = function () { State.update(function (s2) { s2.inventory.weapons.splice(idx, 1); }); };
    row.appendChild(del);

    return row;
  }

  function inventorySection(state) {
    var s = section("Inventory");

    var notesField = el("label", "inv-notes-field");
    notesField.appendChild(el("span", "inv-label", "Items & Gear"));
    var notesArea = el("textarea", "inv-notes");
    notesArea.value = state.inventory.notes || "";
    notesArea.placeholder = "Armor, tools, coin, trinkets…";
    notesArea.oninput = function () {
      State.update(function (s2) { s2.inventory.notes = notesArea.value; }, true);
    };
    notesArea.onblur = function () { State.notify(); };
    notesField.appendChild(notesArea);
    s.appendChild(notesField);

    s.appendChild(withNote(el("h3", "prof-title", "Weapons Carried"),
      "dice pool = characteristic + trained tier; damage = # successes rolled"));

    var list = el("div", "inv-weapon-list");
    if (state.inventory.weapons.length) list.appendChild(weaponHeadRow());
    state.inventory.weapons.forEach(function (w, idx) { list.appendChild(weaponRow(state, w, idx)); });
    s.appendChild(list);

    var add = el("button", "prof-add", "+ Add Carried Weapon");
    add.type = "button";
    add.onclick = function () {
      var first = Engine.weaponCategories()[0];
      State.update(function (s2) {
        s2.inventory.weapons.push({ category: first.id, wielding: first.hands === "2h" ? "2h" : "1h", name: "" });
      });
    };
    s.appendChild(add);

    return s;
  }

  // ---- Abilities · Maneuvers ----------------------------------------------
  // Two independent categories, each its own section that only appears once
  // it has something in it. Both merge owned tree talents with any
  // source-of-power talents unlocked so far (Engine.ownedTalents), split by
  // `ability`. A magic ability is listed like any other, with its tag.
  // Every row can be clicked to expand it and read its description.
  var expanded = {};   // talent id -> true, while its description is open
  function toggleExpand(id) { if (expanded[id]) delete expanded[id]; else expanded[id] = true; render(); }

  function tierName(tier) { return (CONFIG.TIERS[tier - 1] || {}).name || ("Tier " + tier); }

  function sortTalents(a, b) {
    return (a.tier || 0) - (b.tier || 0) ||
      String(a.domain || a.sourceName || "").localeCompare(String(b.domain || b.sourceName || ""));
  }

  // Modifiers never get a row of their own: their effect is already inside the
  // entry they modify, so listing both would ask the player to merge the two
  // by hand. They stay refundable from the tree page (§4.8).
  // Companion talents are excluded here too: all four kinds render under
  // Companions instead, where the statblock they belong to is (§4.11).
  function abilitiesSection(state) {
    var owned = Engine.ownedTalents(state).filter(function (t) {
      return t.ability !== "maneuver" && !Engine.isModifier(t) && !Engine.isCompanionEntry(t);
    });
    if (!owned.length) return null;
    var s = section("Abilities", owned.length + "");
    owned.sort(sortTalents).forEach(function (t) { s.appendChild(talentRow(t, state)); });
    return s;
  }

  function maneuversSection(state) {
    var owned = Engine.ownedTalents(state).filter(function (t) { return t.ability === "maneuver"; });
    if (!owned.length) return null;
    var s = section("Maneuvers", owned.length + "");
    owned.sort(sortTalents).forEach(function (t) { s.appendChild(talentRow(t, state)); });
    return s;
  }

  function talentRow(t, state) {
    var status = t.fromSource ? { met: true, granted: true, reasons: [] } : Engine.requirementStatus(t, state);
    var isOpen = !!expanded[t.id];
    var row = el("div", "talent-row expandable" + (status.met ? "" : " invalid") +
      (status.granted ? " granted" : "") + (isOpen ? " expanded" : ""));
    row.appendChild(el("span", "talent-icon", t.icon || t.name.charAt(0)));

    var info = el("div", "talent-info");
    var nameLine = el("span", "talent-name", t.name);
    if (status.granted) nameLine.appendChild(el("span", "granted-tag", "granted"));
    var domainTag = t.fromSource ? t.sourceName : ((Engine.treeById(t.domain) || {}).name || t.domain);
    nameLine.appendChild(el("span", "talent-domain-tag", domainTag));
    UI.tagChips(t).forEach(function (chip) { nameLine.appendChild(chip); });
    var uses = t.ability === "maneuver" ? Engine.usesLabel(t) : "";
    if (uses) nameLine.appendChild(el("span", "talent-uses-tag", "⟳ " + uses));
    if (t.description || t.flavour || Engine.hasTest(t, state))
      nameLine.appendChild(el("span", "talent-expand-icon", isOpen ? "▾" : "▸"));
    info.appendChild(nameLine);
    var grantSrc = !t.fromSource && status.granted ? Engine.grantSource(state, "talent", t.id) : null;
    // A catalogue entry (a defining trait, a background) carries no tier: it is
    // granted, not reached.
    var tierSuffix = t.tier ? " · " + tierName(t.tier) : "";
    info.appendChild(el("span", "talent-meta", (t.fromSource
      ? "granted by " + t.sourceName
      : status.granted
        ? (grantSrc ? "granted by " + grantSrc.name : "free at creation")
        : t.cost + " talent exp") + tierSuffix));
    if (t.ability === "maneuver" && t.castingTime != null) {
      info.appendChild(el("span", "talent-meta", [
        Engine.castingTimeLabel(t), Engine.rangeLabel(t), Engine.targetLabel(t),
        Engine.durationLabel(t), Engine.aoeLabel(t),
      ].filter(Boolean).join(" · ")));
    }
    if (!status.met) {
      var why = status.reasons.filter(function (r) { return !Engine.reasonMet(r); })
        .map(function (r) { return r.label; }).join(", ");
      info.appendChild(el("span", "talent-invalid-note", "⚠ requirements no longer met: " + why));
    }
    var tTest = Engine.hasTest(t, state);
    if (isOpen && (t.flavour || t.description || tTest)) {
      var descBlock = el("div", "talent-desc");
      if (t.flavour) descBlock.appendChild(el("div", "talent-flavour", Engine.resolveText(t.flavour, state)));
      if (t.description) descBlock.appendChild(el("div", "talent-desc-text", Engine.resolveText(t.description, state)));
      var tTestBlock = UI.renderTest(t, state);
      if (tTestBlock) descBlock.appendChild(tTestBlock);
      info.appendChild(descBlock);
    }
    row.appendChild(info);

    if (!t.fromSource) {
      var del = el("button", "icon-btn", "✕");
      del.type = "button";
      del.disabled = !!status.granted;
      del.title = status.granted
        ? (grantSrc ? "Granted by " + grantSrc.name : "Granted at creation") + ", can't be refunded"
        : "Refund";
      del.onclick = function (e) {
        e.stopPropagation();
        var chk = Engine.canRefund(t.id, State.get());
        if (!chk.ok) { UI.toast("Can't refund " + t.name + ": needed by " + (chk.blockedBy || []).join(", "), "error"); return; }
        State.update(function (s2) {
          Engine.revokeGrants(s2, t.id);
          s2.talents = s2.talents.filter(function (id) { return id !== t.id; });
        });
      };
      row.appendChild(del);
    }
    row.onclick = function () { toggleExpand(t.id); };
    return row;
  }

  // ---- Companions (§4.11) --------------------------------------------------
  // Hidden until the character owns a companion talent, then one card per
  // companion: the statblock (hp, damage reduction, attack, skill pools) and
  // the abilities attached to it. Companion modifiers never get a row of their
  // own for the same reason plain modifiers don't (§4.8) — their effect is
  // already inside the numbers above.
  function companionsSection(state) {
    var list = Engine.companions(state);
    if (!list.length) return null;
    var s = section("Companions", list.length + "");
    list.forEach(function (c) { s.appendChild(companionCard(c, state)); });
    return s;
  }

  // Which companion's icon palette is open, if any. One at a time: the grid is
  // large enough that two open at once would push the second card off-screen.
  var iconPickerFor = null;

  function companionCard(c, state) {
    var block = c.block;
    var id = c.talent.id;
    var card = el("div", "companion-card");

    // The name and the icon are the player's to set (§4.11), so the head is an
    // editable row rather than a label: a button that opens the palette, and a
    // text field that saves silently the way every other identity field does.
    var head = el("div", "companion-head");
    var iconBtn = el("button", "talent-icon companion-icon-btn", c.icon);
    iconBtn.type = "button";
    iconBtn.title = "Pick an icon";
    iconBtn.onclick = function () {
      iconPickerFor = iconPickerFor === id ? null : id;
      render();
    };
    head.appendChild(iconBtn);

    var headInfo = el("div", "talent-info");
    var nameInput = el("input", "ed-input companion-name-input");
    nameInput.value = c.named ? c.name : "";
    nameInput.placeholder = c.talent.name;      // the fallback, shown as a hint
    nameInput.setAttribute("aria-label", "Companion name");
    nameInput.oninput = function () {
      State.update(function (s2) {
        s2.companions = s2.companions || {};
        s2.companions[id] = Object.assign({}, s2.companions[id], { name: nameInput.value });
      }, true);
    };
    nameInput.onchange = function () { State.notify(); };
    headInfo.appendChild(nameInput);
    headInfo.appendChild(el("span", "talent-meta", "granted by " + c.talent.name + " · " +
      ((Engine.treeById(c.talent.domain) || {}).name || c.talent.domain)));
    head.appendChild(headInfo);
    card.appendChild(head);

    if (iconPickerFor === id) card.appendChild(companionIconPicker(id, c.icon));

    // The three statblock rows a player reaches for mid-fight. A companion
    // makes no defense roll (main.tex §Companions), so its defenses read as
    // flat damage reduction rather than a pool to roll.
    var stats = el("div", "companion-stats");
    stats.appendChild(statPair("HP", String(block.hp != null ? block.hp : "—")));

    var defs = Engine.companionDefenses(block);
    if (defs.length) {
      stats.appendChild(statPair("Damage reduction", defs.map(function (d) {
        return d.label + " " + d.value;
      }).join(" · ")));
    }
    card.appendChild(stats);

    // Attacks get their own block rather than a stat pair: a companion may have
    // several, and three of them crammed into one value read as a sentence.
    var attacks = Engine.companionAttacks(block);
    if (attacks.length) {
      var atkList = el("div", "companion-attack-list");
      attacks.forEach(function (a) {
        var r = el("div", "companion-attack-row");
        r.appendChild(el("span", "companion-attack-name", a.name));
        r.appendChild(el("span", "companion-attack-dmg", Engine.defenseLabel(a.damage) || a.damage));
        r.appendChild(el("span", "companion-attack-pool", a.pool + (a.pool === 1 ? " die" : " dice")));
        atkList.appendChild(r);
      });
      card.appendChild(withLabel(attacks.length === 1 ? "Attack" : "Attacks", atkList));
    }

    var skills = Engine.companionSkills(block);
    if (skills.length) {
      var sk = el("div", "companion-skills");
      skills.forEach(function (row) {
        var r = el("div", "companion-skill-row");
        r.appendChild(el("span", "companion-skill-name", row.name));
        r.appendChild(el("span", "companion-skill-pool", row.pool + (row.pool === 1 ? " die" : " dice")));
        sk.appendChild(r);
      });
      card.appendChild(withLabel("Skills", sk));
    }

    // Inherent passives (authored on the statblock) and acquired ones
    // (companion_passive talents) are one list: on the sheet they are the same
    // thing, and which of them came from a talent is not a distinction the
    // player has to act on.
    var passives = (block.passives || []).map(function (p) {
      return { id: null, name: p.name, description: p.description };
    }).concat(c.passives);
    if (passives.length) card.appendChild(withLabel("Passives", abilityList(passives, state)));
    if (c.maneuvers.length) card.appendChild(withLabel("Maneuvers", abilityList(c.maneuvers, state)));

    return card;
  }

  function companionIconPicker(id, current) {
    var grid = el("div", "companion-icon-grid");
    (CONFIG.COMPANION_ICONS || []).forEach(function (icon) {
      var b = el("button", "companion-icon-option" + (icon === current ? " selected" : ""), icon);
      b.type = "button";
      b.onclick = function () {
        // Close first: State.update notifies synchronously, so a re-render runs
        // inside it and would paint the palette open again.
        iconPickerFor = null;
        State.update(function (s2) {
          s2.companions = s2.companions || {};
          s2.companions[id] = Object.assign({}, s2.companions[id], { icon: icon });
        });
      };
      grid.appendChild(b);
    });
    return grid;
  }

  function statPair(label, value) {
    var p = el("div", "companion-stat");
    p.appendChild(el("span", "companion-stat-label", label));
    p.appendChild(el("span", "companion-stat-value", value));
    return p;
  }
  function withLabel(label, node) {
    var wrap = el("div", "companion-block");
    wrap.appendChild(el("h3", "companion-block-title", label));
    wrap.appendChild(node);
    return wrap;
  }

  // Companion abilities expand exactly like the character's own rows do, and
  // reuse the same `expanded` map — an inherent passive has no talent id, so
  // it is keyed by the companion-scoped name instead.
  function abilityList(items, state) {
    var wrap = el("div", "companion-ability-list");
    items.forEach(function (a) {
      var key = a.id || ("inherent:" + a.name);
      var isOpen = !!expanded[key];
      var hasBody = !!(a.description || a.flavour || (a.id && Engine.hasTest(a, state)));
      var row = el("div", "talent-row expandable" + (isOpen ? " expanded" : ""));
      var info = el("div", "talent-info");
      var nameLine = el("span", "talent-name", a.name);
      UI.tagChips(a).forEach(function (chip) { nameLine.appendChild(chip); });
      if (Engine.usesLabel(a)) nameLine.appendChild(el("span", "talent-uses-tag", "⟳ " + Engine.usesLabel(a)));
      if (hasBody) nameLine.appendChild(el("span", "talent-expand-icon", isOpen ? "▾" : "▸"));
      info.appendChild(nameLine);
      if (a.id && a.castingTime != null) {
        info.appendChild(el("span", "talent-meta", [
          Engine.castingTimeLabel(a), Engine.rangeLabel(a), Engine.targetLabel(a),
          Engine.durationLabel(a), Engine.aoeLabel(a),
        ].filter(Boolean).join(" · ")));
      }
      if (isOpen && hasBody) {
        var desc = el("div", "talent-desc");
        if (a.flavour) desc.appendChild(el("div", "talent-flavour", Engine.resolveText(a.flavour, state)));
        if (a.description) desc.appendChild(el("div", "talent-desc-text", Engine.resolveText(a.description, state)));
        if (a.id) {
          var tb = UI.renderTest(a, state);
          if (tb) desc.appendChild(tb);
        }
        info.appendChild(desc);
      }
      row.appendChild(info);
      if (hasBody) row.onclick = function () { toggleExpand(key); };
      wrap.appendChild(row);
    });
    return wrap;
  }

  // ---- Save data ----------------------------------------------------------
  function dataSection() {
    var s = section("Save Data");
    var row = el("div", "data-row");

    var exp = el("button", "btn", "⬇ Export JSON"); exp.type = "button"; exp.onclick = exportJSON;
    var imp = el("button", "btn", "⬆ Import JSON"); imp.type = "button";
    var file = el("input"); file.type = "file"; file.accept = "application/json"; file.style.display = "none";
    file.onchange = importJSON;
    imp.onclick = function () { file.click(); };
    var reset = el("button", "btn btn-danger", "↺ Reset character"); reset.type = "button";
    reset.onclick = function () {
      if (confirm("Reset the whole character? This clears identity, skills, proficiencies, and talents.")) {
        State.reset(); UI.toast("Character reset");
      }
    };

    [exp, imp, reset, file].forEach(function (n) { row.appendChild(n); });
    s.appendChild(row);
    s.appendChild(el("div", "sheet-hint",
      "Saved automatically in this browser (localStorage). Export to back up or move between machines."));
    return s;
  }

  function exportJSON() {
    var data = JSON.stringify(State.get(), null, 2);
    var blob = new Blob([data], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var name = (State.get().identity.characterName || "aetherweave-character").replace(/[^a-z0-9]+/gi, "_");
    a.href = url; a.download = name + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  function importJSON(e) {
    var f = e.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try { State.set(JSON.parse(reader.result)); UI.toast("Character imported", "success"); }
      catch (err) { UI.toast("Import failed: not valid JSON", "error"); }
    };
    reader.readAsText(f);
    e.target.value = "";
  }

  // ---- utils --------------------------------------------------------------
  function charAbbr(key) {
    var c = (CONFIG.CHARACTERISTICS || []).filter(function (x) { return x.key === key; })[0];
    return c ? c.abbr : key;
  }
  function link(text, href) { var a = el("a", "inline-link", text); a.href = href; return a; }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
