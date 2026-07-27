// ============================================================================
// Character Sheet page (sheet.html): identity, HP, characteristics, exp totals,
// skills, proficiencies, a learned-talents summary, and export/import/reset.
// Mirrors character_sheet_fillable.tex; all exp math is shared with the tree.
// ============================================================================

(function () {
  var Engine = window.Engine, State = window.State, UI = window.UI, el = UI.el, CONFIG = window.CONFIG;

  function init() {
    UI.renderHeader("sheet");
    UI.renderStorageWarning();
    UI.renderCreationGate();
    UI.bindPrint(function () {
      var n = (State.get().identity.characterName || "aetherweave-character").trim();
      return n + " — character sheet";
    });
    render();
    State.subscribe(function () { UI.renderHeader("sheet"); render(); });
  }

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
    root.appendChild(talentsSection(state));
    root.appendChild(dataSection());
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
        if (isGranted) dot.title = "Granted at character creation — free";
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
      if (obj) t.appendChild(el("div", "creation-desc", obj.benefit || obj.description));
      body.appendChild(t);
      card.appendChild(body);
      row.appendChild(card);
    });
    s.appendChild(row);

    // Sub-ancestry chain, if any (child → parent → grandparent).
    var chain = Engine.ancestryChain(c.ancestry);
    if (chain.length > 1) {
      var names = chain.map(function (aid) { return (Engine.ancestryById(aid) || {}).name; });
      s.appendChild(el("div", "sheet-hint", "Ancestral line: " + names.join(" → ") +
        " (access to all of these ancestral trees)."));
    }

    var g = state.granted || {};
    var counts = el("div", "sheet-hint",
      "Granted free at creation: " + (g.talents || []).length + " talent(s), " +
      Object.keys(g.skills || {}).length + " skill(s), " +
      Object.keys(g.proficiencies || {}).length + " proficiency/-ies. " +
      "None of it counts as spent exp.");
    s.appendChild(counts);

    // Source-of-power talents: one per tier of play, unlocked as the tier is reached.
    var st = Engine.sourceTalents(state);
    if (st.length) {
      var stWrap = el("div", "source-talents");
      var stHead = el("h3", "sub-title", "Source talents");
      stHead.appendChild(el("span", "group-note", "one per tier of play — granted free as you reach each tier"));
      stWrap.appendChild(stHead);
      st.forEach(function (t) {
        var row = el("div", "source-talent-row" + (t.unlocked ? " unlocked" : " locked"));
        row.appendChild(el("span", "st-tier", (CONFIG.TIERS[t.tier - 1] || {}).name || ("Tier " + t.tier)));
        row.appendChild(el("span", "st-icon", t.icon || (t.name || "?").charAt(0)));
        var info = el("div", "st-info");
        var nameLine = el("span", "st-name", t.name);
        nameLine.appendChild(el("span", t.unlocked ? "st-flag on" : "st-flag off", t.unlocked ? "unlocked" : "locked"));
        info.appendChild(nameLine);
        if (t.description) info.appendChild(el("span", "st-desc", t.description));
        row.appendChild(info);
        stWrap.appendChild(row);
      });
      s.appendChild(stWrap);
    }

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
    [["characterName", "Character Name"], ["sourceOfPower", "Source of Power"],
     ["playerName", "Player Name"], ["concept", "Concept / Archetype"],
     ["ancestry", "Ancestry"], ["notes", "Notes"]].forEach(function (f) {
      var field = el("label", "id-field");
      field.appendChild(el("span", "id-label", f[1]));
      field.appendChild(textInput(state.identity[f[0]], function (v) {
        State.update(function (s2) { s2.identity[f[0]] = v; }, true);
      }, { cls: "id-input" }));
      grid.appendChild(field);
    });
    s.appendChild(grid);
    return s;
  }

  // ---- HP + Characteristics ----------------------------------------------
  function statsSection(state) {
    var s = section("Characteristics & HP");
    var wrap = el("div", "stats-wrap");

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
    wrap.appendChild(hp);

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
    wrap.appendChild(mana);

    var charCap = Engine.characteristicCap(state);
    CONFIG.CHARACTERISTICS.forEach(function (c) {
      var box = el("div", "char-box");
      var head = el("div", "char-head");
      head.appendChild(el("span", "char-name", c.label));
      head.appendChild(el("span", "char-abbr", c.abbr));
      box.appendChild(head);
      // Read-only: characteristics move only via tier-of-play advancement.
      box.appendChild(readonlyDots(state.characteristics[c.key] || 0, CONFIG.MAX_CHARACTERISTIC, charCap));
      wrap.appendChild(box);
    });

    s.appendChild(wrap);
    s.appendChild(el("div", "sheet-hint",
      "Characteristics are fixed at character creation and cost no exp. They rise only " +
      "through tier-of-play advancement, below. At " +
      ((CONFIG.TIERS[Engine.currentTierIndex(state)] || {}).name || "this tier") +
      " they cannot exceed " + charCap + "."));
    s.appendChild(charAdvanceBlock(state));
    return s;
  }

  // Each tier of play after the first lets the character raise
  // CHARACTERISTIC_ADVANCES_PER_TIER *different* characteristics by one.
  function charAdvanceBlock(state) {
    var per = CONFIG.CHARACTERISTIC_ADVANCES_PER_TIER;
    var tiers = Engine.charAdvanceTiers(state);
    var block = el("div", "adv-block");

    if (!tiers.length) {
      block.appendChild(el("div", "sheet-hint",
        "No advancements available yet — each tier of play beyond the first lets you raise " +
        per + " different characteristics by one."));
      return block;
    }

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
      "Two different characteristics per tier — a characteristic can be raised again at the next tier."));
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
  function skillsSection(state) {
    var s = section("Skills");
    s.appendChild(skillGroup("Combat Skills", window.SKILLS.combat, state, "combat"));
    s.appendChild(skillGroup("Non-Combat Skills", window.SKILLS.noncombat, state, "noncombat"));
    return s;
  }
  function skillGroup(title, list, state, costKey) {
    var costs = CONFIG.SKILL_COSTS[costKey];
    var g = el("div", "skill-group");
    g.appendChild(withNote(el("h3", "skill-group-title", title),
      "(" + costs.join(", ") + " exp · max " + Engine.skillCap(state) + " at this tier)"));
    var grid = el("div", "skill-grid");
    var cap = Engine.skillCap(state);
    list.forEach(function (sk) {
      var tier = state.skills[sk.name] || 0;
      var free = Engine.grantedSkillTier(state, sk.name);
      var row = el("div", "skill-row");
      var name = el("div", "skill-name");
      name.appendChild(el("span", "skill-name-text", sk.name));
      name.appendChild(el("span", "skill-char", charAbbr(sk.char)));
      row.appendChild(name);
      row.appendChild(dots(tier, CONFIG.MAX_SKILL_TIER, function (v) {
        State.update(function (s2) { s2.skills[sk.name] = v; });
      }, free, cap));
      row.appendChild(el("div", "skill-hint",
        tier >= CONFIG.MAX_SKILL_TIER ? "max" : tier >= cap ? "tier cap" : "next " + costs[tier]));
      grid.appendChild(row);
    });
    g.appendChild(grid);
    return g;
  }
  function withNote(h, note) { h.appendChild(el("span", "group-note", note)); return h; }

  // ---- Proficiencies ------------------------------------------------------
  function profSection(state) {
    var s = section("Proficiencies");
    var wrap = el("div", "prof-wrap");
    window.PROFICIENCY_KINDS.forEach(function (kind) {
      var costs = CONFIG.SKILL_COSTS[kind.costKey];
      var col = el("div", "prof-col");
      col.appendChild(withNote(el("h3", "prof-title", kind.label), "(" + costs.join(", ") + " exp)"));

      var dl = el("datalist"); dl.id = "prof-suggest-" + kind.id;
      (kind.suggestions || []).forEach(function (name) { var o = el("option"); o.value = name; dl.appendChild(o); });
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
        del.title = free ? "Granted at creation — can't be removed" : "Remove";
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
      wrap.appendChild(col);
    });
    s.appendChild(wrap);
    return s;
  }

  // ---- Abilities (passives · maneuvers · spells) --------------------------
  // Owned talents split by the ability they grant, plus learned spells grouped
  // by their magical domain. Each is a distinct category, per the design.
  function talentsSection(state) {
    var s = section("Abilities");
    var owned = (state.talents || []).map(Engine.talentById).filter(Boolean);
    var anySpells = Engine.magicalDomains().some(function (d) {
      return Engine.spellcastingLevel(state, d.id) > 0 ||
        Engine.spellsForDomain(d.id).some(function (sp) { return Engine.spellOwned(state, sp.id); });
    });

    if (!owned.length && !anySpells) {
      var hint = el("div", "sheet-hint", "No abilities yet. Head to the ");
      hint.appendChild(link("Talent Trees", "index.html"));
      hint.appendChild(document.createTextNode(" to learn talents or spells."));
      s.appendChild(hint);
      return s;
    }

    var passives = owned.filter(function (t) { return t.ability !== "maneuver"; });
    var maneuvers = owned.filter(function (t) { return t.ability === "maneuver"; });

    if (passives.length) s.appendChild(abilityGroup("Passives", "◆", passives, state));
    if (maneuvers.length) s.appendChild(abilityGroup("Maneuvers", "⟳", maneuvers, state));
    var sg = spellsGroup(state);
    if (sg) s.appendChild(sg);
    return s;
  }

  function tierName(tier) { return (CONFIG.TIERS[tier - 1] || {}).name || ("Tier " + tier); }

  function abilityGroup(title, icon, talents, state) {
    var group = el("div", "ability-group");
    var h = el("h3", "talent-group-title");
    h.appendChild(el("span", "tg-icon", icon));
    h.appendChild(el("span", null, title));
    h.appendChild(el("span", "group-note", talents.length + ""));
    group.appendChild(h);
    talents.slice()
      .sort(function (a, b) { return a.tier - b.tier || String(a.domain).localeCompare(String(b.domain)); })
      .forEach(function (t) { group.appendChild(talentRow(t, state)); });
    return group;
  }

  function talentRow(t, state) {
    var status = Engine.requirementStatus(t, state);
    var row = el("div", "talent-row" + (status.met ? "" : " invalid") + (status.granted ? " granted" : ""));
    row.appendChild(el("span", "talent-icon", t.icon || t.name.charAt(0)));

    var info = el("div", "talent-info");
    var nameLine = el("span", "talent-name", t.name);
    if (status.granted) nameLine.appendChild(el("span", "granted-tag", "granted"));
    var tree = Engine.treeById(t.domain);
    nameLine.appendChild(el("span", "talent-domain-tag", (tree && tree.name) || t.domain));
    if (t.ability === "maneuver" && t.uses) nameLine.appendChild(el("span", "talent-uses-tag", "⟳ " + t.uses + " / " + (t.usesPer || "session")));
    info.appendChild(nameLine);
    info.appendChild(el("span", "talent-meta", status.granted
      ? "free at creation · " + tierName(t.tier)
      : t.cost + (t.pool === "combat" ? " combat" : " non-combat") + " exp · " + tierName(t.tier)));
    if (!status.met) {
      var why = status.reasons.filter(function (r) { return !Engine.reasonMet(r); })
        .map(function (r) { return r.label; }).join(", ");
      info.appendChild(el("span", "talent-invalid-note", "⚠ requirements no longer met: " + why));
    }
    row.appendChild(info);

    var del = el("button", "icon-btn", "✕");
    del.type = "button";
    del.disabled = !!status.granted;
    del.title = status.granted ? "Granted at creation — can't be refunded" : "Refund";
    del.onclick = function () {
      var chk = Engine.canRefund(t.id, State.get());
      if (!chk.ok) { UI.toast("Can't refund " + t.name + " — required by " + (chk.blockedBy || []).join(", "), "error"); return; }
      State.update(function (s2) { s2.talents = s2.talents.filter(function (id) { return id !== t.id; }); });
    };
    row.appendChild(del);
    return row;
  }

  // Spells category: one block per magical domain the character casts in or
  // knows spells from, with its spellcasting level + effective pool.
  function spellsGroup(state) {
    var relevant = Engine.magicalDomains().filter(function (d) {
      return Engine.spellcastingLevel(state, d.id) > 0 ||
        Engine.spellsForDomain(d.id).some(function (sp) { return Engine.spellOwned(state, sp.id); });
    });
    if (!relevant.length) return null;

    var group = el("div", "ability-group");
    var h = el("h3", "talent-group-title");
    h.appendChild(el("span", "tg-icon", "✨"));
    h.appendChild(el("span", null, "Spells"));
    group.appendChild(h);

    relevant.forEach(function (d) {
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

      var owned = Engine.spellsForDomain(d.id).filter(function (sp) { return Engine.spellOwned(state, sp.id); })
        .sort(function (a, b) { return (a.tier || 1) - (b.tier || 1) || a.name.localeCompare(b.name); });
      if (!owned.length) {
        block.appendChild(el("div", "sheet-hint", "Able to cast, but no spells learned yet."));
      } else {
        owned.forEach(function (sp) {
          var castable = Engine.spellCastable(state, sp);
          var row = el("div", "talent-row spell-sheet-row" + (castable ? "" : " invalid"));
          row.appendChild(el("span", "talent-icon", sp.icon || sp.name.charAt(0)));
          var info = el("div", "talent-info");
          var nameLine = el("span", "talent-name", sp.name);
          nameLine.appendChild(el("span", "spell-tier-tag", "T" + (sp.tier || 1)));
          info.appendChild(nameLine);
          var manaCost = Engine.spellManaCost(sp);
          info.appendChild(el("span", "talent-meta",
            (sp.cost || 0) + (sp.pool === "combat" ? " combat" : " non-combat") + " exp · " +
            (manaCost ? (manaCost + " mana to cast") : "cantrip (free to cast)")));
          if (sp.description) info.appendChild(el("span", "talent-meta spell-desc-line", sp.description));
          if (!castable) info.appendChild(el("span", "talent-invalid-note",
            "⚠ needs Spellcasting +" + (sp.tier || 1) + " to cast"));
          row.appendChild(info);
          var del = el("button", "icon-btn", "✕"); del.type = "button"; del.title = "Unlearn";
          del.onclick = function () {
            State.update(function (s2) { s2.spells = (s2.spells || []).filter(function (id) { return id !== sp.id; }); });
          };
          row.appendChild(del);
          block.appendChild(row);
        });
      }
      group.appendChild(block);
    });
    return group;
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
      catch (err) { UI.toast("Import failed — not valid JSON", "error"); }
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
