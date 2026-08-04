// ============================================================================
// Character Sheet page (sheet.html): identity, HP, characteristics, exp totals,
// skills, proficiencies, a learned-talents summary, and export/import/reset.
// Mirrors character_sheet_fillable.tex; all exp math is shared with the tree.
// ============================================================================

(function () {
  var Engine = window.Engine, State = window.State, UI = window.UI, el = UI.el, CONFIG = window.CONFIG;

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
  }

  // The paper copy is a whole second document (js/print-sheet.js), rebuilt
  // alongside this one so it is never out of date with what is on screen.
  function renderPrint() { window.PrintSheet.render(State.get()); }

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
    [abilitiesSection, maneuversSection, spellsSection].forEach(function (fn) {
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
  // were granted at character creation: they are free and cannot be lowered.
  function dots(value, max, onSet, min, cap) {
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
        if (isGranted) dot.title = "Granted at creation, free";
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
      hint.appendChild(document.createTextNode(" to assign characteristics, an ancestry and a source of power."));
      s.appendChild(hint);
      return s;
    }

    var anc = Engine.ancestryById(c.ancestry);
    var src = Engine.sourceById(c.source);
    var row = el("div", "creation-row");

    [[anc, "Ancestry"], [src, "Source of Power"]].forEach(function (pair) {
      var obj = pair[0];
      var card = el("div", "creation-card");
      card.appendChild(el("span", "creation-card-label", pair[1]));
      var body = el("div", "creation-card-body");
      body.appendChild(el("span", "creation-icon", obj ? obj.icon : "—"));
      var t = el("div");
      t.appendChild(el("div", "creation-name", obj ? obj.name : "—"));
      if (obj) t.appendChild(el("div", "creation-desc", obj.benefit || obj.flavour));
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
    var topRow = el("div", "hp-mana-row");

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

    // Mana — the resource spells (tier 2+) spend to cast. Max is computed;
    // only Current is hand-edited, like HP.
    var mana = el("div", "hp-box mana-box");
    mana.appendChild(el("div", "stat-title", "Mana"));
    var manaRow = el("div", "hp-row");
    var manaMaxField = el("label", "hp-field");
    manaMaxField.appendChild(el("span", "hp-label", "Max"));
    manaMaxField.appendChild(el("span", "hp-input hp-computed", String(Engine.maxMana(state))));
    manaRow.appendChild(manaMaxField);
    var manaCurField = el("label", "hp-field");
    manaCurField.appendChild(el("span", "hp-label", "Current"));
    manaCurField.appendChild(textInput(state.mana.current, function (v) {
      State.update(function (s2) { s2.mana.current = v; }, true);
    }, { cls: "hp-input", type: "number" }));
    manaRow.appendChild(manaCurField);
    mana.appendChild(manaRow);
    topRow.appendChild(mana);
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
    var wrap = el("div", "exp-wrap");

    [["combat", "Combat", "⚔"], ["noncombat", "Non-combat", "❖"]].forEach(function (p) {
      var pool = p[0];
      var box = el("div", "exp-pool");
      box.appendChild(el("div", "exp-pool-title", p[2] + " " + p[1] + " exp"));
      var grid = el("div", "exp-pool-grid");

      var earned = el("div", "exp-cell");
      earned.appendChild(el("div", "exp-cell-label", "Earned"));
      earned.appendChild(textInput(state.expEarned[pool], function (v) {
        State.update(function (s2) { s2.expEarned[pool] = Number(v) || 0; }, true);
        UI.renderHeader("sheet");
      }, { cls: "exp-earned-input", type: "number" }));
      grid.appendChild(earned);

      grid.appendChild(expReadout("Spent", spent[pool], false));
      var rem = (Number(state.expEarned[pool]) || 0) - spent[pool];
      grid.appendChild(expReadout("Remaining", rem, rem < 0));

      box.appendChild(grid);
      wrap.appendChild(box);
    });

    s.appendChild(wrap);

    // Where the spent exp actually went, including tree-access surcharges.
    var b = spent.breakdown;
    var parts = [
      ["Skills", b.skills], ["Proficiencies", b.proficiencies],
      ["Talents", b.talents], ["Tree access", b.treeAccess],
      ["Spellcasting", b.spellcasting], ["Spells", b.spells],
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
    s.appendChild(skillModeToggle());
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
  // characteristic group can't carry one cost note the way a pool group can;
  // each row is tagged with its own pool instead.
  function skillGroupByChar(c, state) {
    var list = window.SKILLS.combat.map(function (sk) { return { sk: sk, pool: "combat" }; })
      .concat(window.SKILLS.noncombat.map(function (sk) { return { sk: sk, pool: "noncombat" }; }))
      .filter(function (entry) { return entry.sk.char === c.key; });
    if (!list.length) return null;
    var g = el("div", "skill-group");
    var h = el("h3", "skill-group-title", c.label);
    h.appendChild(el("span", "char-abbr", c.abbr));
    g.appendChild(h);
    var grid = el("div", "skill-grid");
    var cap = Engine.skillCap(state);
    list.forEach(function (entry) { grid.appendChild(skillRow(entry.sk, state, cap, entry.pool)); });
    g.appendChild(grid);
    return g;
  }

  function skillRow(sk, state, cap, showPool) {
    var tier = state.skills[sk.name] || 0;
    var free = Engine.grantedSkillTier(state, sk.name);
    var row = el("div", "skill-row");
    var name = el("div", "skill-name");
    name.appendChild(el("span", "skill-name-text", sk.name));
    if (showPool) name.appendChild(el("span", "skill-pool-tag " + showPool, showPool === "combat" ? "combat" : "non-combat"));
    else name.appendChild(el("span", "skill-char", charAbbr(sk.char)));
    row.appendChild(name);
    row.appendChild(dots(tier, CONFIG.MAX_SKILL_TIER, function (v) {
      State.update(function (s2) { s2.skills[sk.name] = v; });
    }, free, cap));
    return row;
  }

  function withNote(h, note) { h.appendChild(el("span", "group-note", note)); return h; }

  // ---- Proficiencies ------------------------------------------------------
  // Two columns — non-combat kinds on the left, combat kinds on the right —
  // driven entirely by PROFICIENCY_KINDS' own `pool`, so a new kind (of
  // either pool) slots into the right side automatically with no layout change.
  function profSection(state) {
    var s = section("Proficiencies");
    var wrap = el("div", "prof-wrap");
    ["noncombat", "combat"].forEach(function (poolName) {
      var side = el("div", "prof-side");
      window.PROFICIENCY_KINDS.filter(function (k) { return k.pool === poolName; }).forEach(function (kind) {
        var costs = CONFIG.SKILL_COSTS[kind.costKey];
        var col = el("div", "prof-col");
        col.appendChild(withNote(el("h3", "prof-title", kind.label), "(" + costs.join(", ") + " exp)"));

        // A Spellcasting proficiency is named after a magical domain, so its
        // suggestions are the domains that exist, not a static authored list.
        var suggestions = kind.id === "spellcasting"
          ? Engine.magicalDomains().map(function (d) { return d.name; })
          : (kind.suggestions || []);
        var dl = el("datalist"); dl.id = "prof-suggest-" + kind.id;
        suggestions.forEach(function (name) { var o = el("option"); o.value = name; dl.appendChild(o); });
        col.appendChild(dl);

        state.proficiencies.forEach(function (p, idx) {
          if (p.kind !== kind.id) return;
          var free = Engine.grantedProfTier(state, p.name);
          var row = el("div", "prof-row");
          var nameInput = textInput(p.name, function (v) {
            State.update(function (s2) { s2.proficiencies[idx].name = v; }, true);
          }, { cls: "prof-name", placeholder: "name…", list: "prof-suggest-" + kind.id });
          if (free) { nameInput.readOnly = true; nameInput.title = "Granted at character creation"; }
          row.appendChild(nameInput);
          row.appendChild(dots(p.tier || 0, CONFIG.MAX_SKILL_TIER, function (v) {
            State.update(function (s2) { s2.proficiencies[idx].tier = v; });
          }, free, Engine.skillCap(state)));
          var del = el("button", "icon-btn", "✕");
          del.title = free ? "Granted at creation, can't be removed" : "Remove";
          del.type = "button";
          del.disabled = !!free;
          del.onclick = function () { State.update(function (s2) { s2.proficiencies.splice(idx, 1); }); };
          row.appendChild(del);
          col.appendChild(row);
        });

        var add = el("button", "prof-add", "+ Add " + kind.label);
        add.type = "button";
        add.onclick = function () { State.update(function (s2) { s2.proficiencies.push({ name: "", kind: kind.id, tier: 0 }); }); };
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

    cells.appendChild(el("span", "inv-wdmg", Engine.weaponDamageNote(w.wielding)));

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

  // ---- Abilities · Maneuvers · Spells --------------------------------------
  // Three independent categories, each its own section that only appears once
  // it has something in it. Abilities/Maneuvers merge owned tree talents with
  // any source-of-power talents unlocked so far (Engine.ownedTalents), split
  // by `ability`; Spells is a separate mechanic, grouped by magical domain.
  // Every row can be clicked to expand it and read its description.
  var expanded = {};   // talent/spell id -> true, while its description is open
  function toggleExpand(id) { if (expanded[id]) delete expanded[id]; else expanded[id] = true; render(); }

  function tierName(tier) { return (CONFIG.TIERS[tier - 1] || {}).name || ("Tier " + tier); }

  function sortTalents(a, b) {
    return (a.tier || 0) - (b.tier || 0) ||
      String(a.domain || a.sourceName || "").localeCompare(String(b.domain || b.sourceName || ""));
  }

  // Modifiers never get a row of their own: their effect is already inside the
  // entry they modify, so listing both would ask the player to merge the two
  // by hand. They stay refundable from the tree page (§4.8).
  function abilitiesSection(state) {
    var owned = Engine.ownedTalents(state).filter(function (t) {
      return t.ability !== "maneuver" && !Engine.isModifier(t);
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
    if (t.ability === "maneuver" && t.uses) nameLine.appendChild(el("span", "talent-uses-tag", "⟳ " + t.uses + " / " + (t.usesPer || "session")));
    if (t.description || t.flavour) nameLine.appendChild(el("span", "talent-expand-icon", isOpen ? "▾" : "▸"));
    info.appendChild(nameLine);
    info.appendChild(el("span", "talent-meta", t.fromSource
      ? "granted by " + t.sourceName + " · " + tierName(t.tier)
      : status.granted
        ? "free at creation · " + tierName(t.tier)
        : t.cost + (t.pool === "combat" ? " combat" : " non-combat") + " exp · " + tierName(t.tier)));
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
    if (isOpen && (t.flavour || t.description)) {
      var descBlock = el("div", "talent-desc");
      if (t.flavour) descBlock.appendChild(el("div", "talent-flavour", Engine.resolveText(t.flavour, state)));
      if (t.description) descBlock.appendChild(el("div", "talent-desc-text", Engine.resolveText(t.description, state)));
      info.appendChild(descBlock);
    }
    row.appendChild(info);

    if (!t.fromSource) {
      var del = el("button", "icon-btn", "✕");
      del.type = "button";
      del.disabled = !!status.granted;
      del.title = status.granted ? "Granted at creation, can't be refunded" : "Refund";
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

  // Spells: their own section, one block per magical domain the character
  // casts in or knows spells from, with its spellcasting level + effective pool.
  function spellsSection(state) {
    var relevant = Engine.magicalDomains().filter(function (d) {
      return Engine.spellcastingLevel(state, d.id) > 0 ||
        Engine.spellsForDomain(d.id).some(function (sp) { return Engine.spellOwned(state, sp.id); });
    });
    if (!relevant.length) return null;

    var ownedByDomain = relevant.map(function (d) {
      return Engine.spellsForDomain(d.id).filter(function (sp) { return Engine.spellOwned(state, sp.id); });
    });
    var total = ownedByDomain.reduce(function (n, list) { return n + list.length; }, 0);
    var s = section("Spells", total + "");

    relevant.forEach(function (d, i) {
      var block = el("div", "spell-domain-block");
      var pool = Engine.spellPool(state, d.id);
      var dh = el("div", "spell-domain-head");
      dh.appendChild(el("span", "sdh-icon", d.icon));
      dh.appendChild(el("span", "sdh-name", d.name));
      dh.appendChild(el("span", "sdh-pool", pool.charKey
        ? "spellcasting +" + pool.ladder + " · pool " + Engine.charLabel(pool.charKey) +
          " (" + pool.charVal + ") + " + pool.ladder + " = " + pool.total + " dice"
        : "spellcasting +" + pool.ladder + " · set a source characteristic to complete the pool"));
      block.appendChild(dh);

      var owned = ownedByDomain[i].sort(function (a, b) { return (a.tier || 1) - (b.tier || 1) || a.name.localeCompare(b.name); });
      if (!owned.length) {
        block.appendChild(el("div", "sheet-hint", "Able to cast, but no spells learned yet."));
      } else {
        owned.forEach(function (raw) {
          var sp = Engine.effective(raw, state);   // a modifier may reshape a spell too
          var status = Engine.spellRequirementStatus(sp, state);
          var isOpen = !!expanded[sp.id];
          var row = el("div", "talent-row spell-sheet-row expandable" + (status.met ? "" : " invalid") + (isOpen ? " expanded" : ""));
          row.appendChild(el("span", "talent-icon", sp.icon || sp.name.charAt(0)));
          var info = el("div", "talent-info");
          var nameLine = el("span", "talent-name", sp.name);
          nameLine.appendChild(el("span", "spell-tier-tag", "T" + (sp.tier || 1)));
          if (sp.description || sp.flavour) nameLine.appendChild(el("span", "talent-expand-icon", isOpen ? "▾" : "▸"));
          info.appendChild(nameLine);
          var manaCost = Engine.spellManaCost(sp);
          info.appendChild(el("span", "talent-meta", [
            (sp.cost || 0) + (sp.pool === "combat" ? " combat" : " non-combat") + " exp",
            manaCost ? (manaCost + " mana to cast") : "cantrip (free to cast)",
            Engine.castingTimeLabel(sp),
            Engine.rangeLabel(sp),
            Engine.targetLabel(sp),
            Engine.durationLabel(sp),
            Engine.aoeLabel(sp),
          ].filter(Boolean).join(" · ")));
          if (!status.met) {
            var why = status.reasons.filter(function (r) { return !Engine.reasonMet(r); })
              .map(function (r) { return r.label; }).join(", ");
            info.appendChild(el("span", "talent-invalid-note", "⚠ requirements no longer met: " + why));
          }
          if (isOpen && (sp.flavour || sp.description)) {
            var spDescBlock = el("div", "talent-desc");
            if (sp.flavour) spDescBlock.appendChild(el("div", "talent-flavour", sp.flavour));
            if (sp.description) spDescBlock.appendChild(el("div", "talent-desc-text", Engine.resolveText(sp.description, state)));
            info.appendChild(spDescBlock);
          }
          row.appendChild(info);
          var del = el("button", "icon-btn", "✕"); del.type = "button"; del.title = "Unlearn";
          del.onclick = function (e) {
            e.stopPropagation();
            State.update(function (s2) {
              Engine.revokeGrants(s2, sp.id);
              s2.spells = (s2.spells || []).filter(function (id) { return id !== sp.id; });
            });
          };
          row.appendChild(del);
          row.onclick = function () { toggleExpand(sp.id); };
          block.appendChild(row);
        });
      }
      s.appendChild(block);
    });
    return s;
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
