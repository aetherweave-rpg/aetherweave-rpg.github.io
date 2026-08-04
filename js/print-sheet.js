// ============================================================================
// The printable character sheet (sheet.html → Export to PDF).
// ----------------------------------------------------------------------------
// Paper gets its own document rather than a restyled version of the app's.
// The interactive sheet is built for *editing* a character — inputs, dot
// buttons, rows that hide their rules text until you click them — and none of
// that survives the trip: printing it produced form controls, a screen-width
// layout the browser then shrank to fit, and an ability list with no rules at
// all, because descriptions only enter the DOM while a row is expanded.
//
// So `build(state)` emits a second, static DOM: every value is ink, nothing is
// interactive, and nothing is hidden. Layout is A4 (see the `@page` block in
// css/style.css) in two parts, which is the split that keeps the sheet usable:
//
//   1. the play sheet — vitals, exp, skills, proficiencies, and an *index* of
//      abilities/maneuvers/spells by name, the things you scan mid-session;
//   2. a rules appendix, starting on its own page, carrying the full text of
//      every one of those entries, which is what you actually need to read.
//
// It is a pure function of `state` + the database: no listeners, no storage,
// no side effects, so it can be built and asserted on without a print dialog.
// ============================================================================

(function () {
  var Engine = window.Engine, UI = window.UI, el = UI.el, CONFIG = window.CONFIG;

  // ---- small builders ------------------------------------------------------

  function block(title, note, cls) {
    var b = el("section", "ps-block" + (cls ? " " + cls : ""));
    var h = el("h2", "ps-h2", title);
    if (note) h.appendChild(el("span", "ps-h2-note", note));
    b.appendChild(h);
    return b;
  }

  // Dots as ink, not form controls: a filled dot is a solid disc, an empty one
  // an outline. Both are spans — the interactive sheet's <button> dots print as
  // whatever the UA decides a button looks like on paper.
  function dots(value, max) {
    var row = el("span", "ps-dots");
    for (var i = 0; i < max; i++) row.appendChild(el("span", "ps-dot" + (i < value ? " on" : "")));
    return row;
  }

  function field(label, value) {
    var f = el("div", "ps-field");
    f.appendChild(el("span", "ps-field-label", label));
    f.appendChild(el("span", "ps-field-value", value == null || value === "" ? "—" : String(value)));
    return f;
  }

  function tierName(tier) { return (CONFIG.TIERS[tier - 1] || {}).name || ("Tier " + tier); }

  function charAbbr(key) {
    var c = (CONFIG.CHARACTERISTICS || []).filter(function (x) { return x.key === key; })[0];
    return c ? c.abbr : key;
  }

  // ---- masthead ------------------------------------------------------------

  function masthead(state) {
    var head = el("header", "ps-masthead");
    var top = el("div", "ps-masthead-top");
    top.appendChild(el("span", "ps-wordmark", "Aetherweave"));
    top.appendChild(el("span", "ps-doc-kind", "Character Sheet"));
    top.appendChild(el("span", "ps-tier", (CONFIG.TIERS[Engine.currentTierIndex(state)] || {}).name || "—"));
    head.appendChild(top);

    head.appendChild(el("div", "ps-charname", state.identity.characterName || "Unnamed character"));

    // The identifying line reads as prose because that is how a player says it
    // out loud: "a Wood Elf of the Ember Pact, played by …".
    var anc = Engine.ancestryById(state.creation && state.creation.ancestry);
    var src = Engine.sourceById(state.creation && state.creation.source);
    var bits = [];
    if (anc) bits.push(anc.name);
    if (src) bits.push(src.name);
    if (state.identity.concept) bits.push(state.identity.concept);
    if (state.identity.playerName) bits.push("played by " + state.identity.playerName);
    head.appendChild(el("div", "ps-charline", bits.length ? bits.join(" · ") : "—"));

    if (state.identity.notes) head.appendChild(el("div", "ps-charnotes", state.identity.notes));
    return head;
  }

  // ---- vitals: HP, mana, characteristics -----------------------------------

  function vitals(state) {
    var b = block("Vitals");
    var row = el("div", "ps-vitals");

    row.appendChild(pool("HP", Engine.maxHP(state), state.hp.current));
    row.appendChild(pool("Mana", Engine.maxMana(state), state.mana.current));

    var chars = el("div", "ps-chars");
    CONFIG.CHARACTERISTICS.forEach(function (c) {
      var box = el("div", "ps-char");
      box.appendChild(el("span", "ps-char-abbr", c.abbr));
      box.appendChild(dots(state.characteristics[c.key] || 0, CONFIG.MAX_CHARACTERISTIC));
      box.appendChild(el("span", "ps-char-value", String(state.characteristics[c.key] || 0)));
      chars.appendChild(box);
    });
    row.appendChild(chars);

    b.appendChild(row);
    return b;
  }

  // Max is computed; current is whatever was last written down, and stays blank
  // rather than guessing — a printed sheet is filled in with a pencil.
  function pool(label, max, current) {
    var box = el("div", "ps-pool");
    box.appendChild(el("span", "ps-pool-label", label));
    var v = el("span", "ps-pool-value");
    v.appendChild(el("span", "ps-pool-cur", current === "" || current == null ? "___" : String(current)));
    v.appendChild(el("span", "ps-pool-sep", "/"));
    v.appendChild(el("span", "ps-pool-max", String(max)));
    box.appendChild(v);
    return box;
  }

  // ---- experience ----------------------------------------------------------

  function experience(state) {
    var spent = Engine.computeSpent(state);
    var b = block("Experience");

    var row = el("div", "ps-exp-row");
    [["combat", "⚔ Combat"], ["noncombat", "❖ Non-combat"]].forEach(function (p) {
      var earned = Number(state.expEarned[p[0]]) || 0;
      var box = el("div", "ps-exp-pool");
      box.appendChild(el("span", "ps-exp-pool-name", p[1]));
      var g = el("span", "ps-exp-nums");
      [["earned", earned], ["spent", spent[p[0]]], ["left", earned - spent[p[0]]]].forEach(function (n) {
        var cell = el("span", "ps-exp-cell" + (n[0] === "left" && n[1] < 0 ? " over" : ""));
        cell.appendChild(el("span", "ps-exp-cell-label", n[0]));
        cell.appendChild(el("span", "ps-exp-cell-value", String(n[1])));
        g.appendChild(cell);
      });
      box.appendChild(g);
      row.appendChild(box);
    });
    b.appendChild(row);

    var bd = spent.breakdown;
    var parts = [
      ["Skills", bd.skills], ["Proficiencies", bd.proficiencies], ["Talents", bd.talents],
      ["Tree access", bd.treeAccess], ["Spellcasting", bd.spellcasting], ["Spells", bd.spells],
    ].filter(function (p) { return p[1] > 0; });
    if (parts.length) {
      b.appendChild(inlineList("Spent on", parts.map(function (p) { return p[0] + " " + p[1]; })));
    }

    var charges = Engine.treeAccessCharges(state);
    if (charges.length) {
      b.appendChild(inlineList("Trees opened", charges.map(function (c, i) {
        return (i + 1) + ". " + c.name + (c.cost ? " +" + c.cost : " free");
      })));
    }
    return b;
  }

  function inlineList(label, items) {
    var line = el("div", "ps-inline");
    line.appendChild(el("span", "ps-inline-label", label));
    line.appendChild(el("span", "ps-inline-items", items.join("  ·  ")));
    return line;
  }

  // ---- skills & proficiencies ----------------------------------------------

  // Two layouts over the same skill data, mirroring the toggle on screen: the
  // Combat/Non-Combat pool split (default), or one group per characteristic
  // with each row tagged by its pool instead of by its characteristic (the
  // group heading already says that).
  function skills(state, opts) {
    var b = block("Skills", "filled to current level · max " + Engine.skillCap(state) + " at this tier");
    b.appendChild(opts && opts.skillsGroupByChar ? skillsByCharWrap(state) : skillsByPoolWrap(state));
    return b;
  }

  function skillsByPoolWrap(state) {
    var wrap = el("div", "ps-skills");
    wrap.appendChild(skillGroup("Combat", window.SKILLS.combat, state, "ps-one-col"));
    wrap.appendChild(skillGroup("Non-Combat", window.SKILLS.noncombat, state, "ps-two-col"));
    return wrap;
  }

  function skillGroup(title, list, state, cls) {
    var g = el("div", "ps-skill-group");
    g.appendChild(el("h3", "ps-h3", title));
    var body = el("div", "ps-skill-list " + cls);
    list.forEach(function (sk) {
      var row = el("div", "ps-row");
      var name = el("span", "ps-row-name", sk.name);
      name.appendChild(el("span", "ps-row-sub", charAbbr(sk.char)));
      row.appendChild(name);
      row.appendChild(dots(state.skills[sk.name] || 0, CONFIG.MAX_SKILL_TIER));
      body.appendChild(row);
    });
    g.appendChild(body);
    return g;
  }

  function charSkillEntries(key) {
    return window.SKILLS.combat.map(function (sk) { return { sk: sk, pool: "combat" }; })
      .concat(window.SKILLS.noncombat.map(function (sk) { return { sk: sk, pool: "noncombat" }; }))
      .filter(function (entry) { return entry.sk.char === key; });
  }

  function skillsByCharWrap(state) {
    var wrap = el("div", "ps-skills ps-skills-bychar");
    CONFIG.CHARACTERISTICS.forEach(function (c) {
      var entries = charSkillEntries(c.key);
      if (!entries.length) return;
      var g = el("div", "ps-skill-group");
      g.appendChild(el("h3", "ps-h3", c.label));
      var body = el("div", "ps-skill-list");
      entries.forEach(function (entry) {
        var row = el("div", "ps-row");
        var name = el("span", "ps-row-name", entry.sk.name);
        name.appendChild(el("span", "ps-row-sub", entry.pool === "combat" ? "combat" : "non-combat"));
        row.appendChild(name);
        row.appendChild(dots(state.skills[entry.sk.name] || 0, CONFIG.MAX_SKILL_TIER));
        body.appendChild(row);
      });
      g.appendChild(body);
      wrap.appendChild(g);
    });
    return wrap;
  }

  function proficiencies(state) {
    var b = block("Proficiencies");
    var wrap = el("div", "ps-profs");
    window.PROFICIENCY_KINDS.forEach(function (kind) {
      var col = el("div", "ps-prof-col");
      col.appendChild(el("h3", "ps-h3", kind.label));
      var owned = (state.proficiencies || []).filter(function (p) {
        return p.kind === kind.id && String(p.name || "").trim();
      });
      if (!owned.length) {
        col.appendChild(el("div", "ps-empty", "—"));
      } else {
        owned.forEach(function (p) {
          var row = el("div", "ps-row");
          row.appendChild(el("span", "ps-row-name", p.name));
          row.appendChild(dots(p.tier || 0, CONFIG.MAX_SKILL_TIER));
          col.appendChild(row);
        });
      }
      wrap.appendChild(col);
    });
    b.appendChild(wrap);
    return b;
  }

  // ---- inventory -------------------------------------------------------------
  // Unlike Abilities/Maneuvers/Spells, this block always prints, blank
  // character or not: the app is for building a character, but once play
  // starts, loot picked up mid-session gets written straight onto the paper
  // sheet rather than round-tripped back through the app. So it always
  // carries a few ruled lines and a few blank weapon rows to write into,
  // the same "leave it to a pencil" idea as the HP/Mana current-value boxes.
  var MIN_NOTES_LINES = 5;
  var NOTES_PADDING_LINES = 2;
  var BLANK_WEAPON_ROWS = 3;
  var MAX_DICE_POOL = CONFIG.MAX_CHARACTERISTIC + CONFIG.MAX_SKILL_TIER;
  var NBSP = " ";
  var DASH = "—";
  var MIDDOT = "·";

  function wieldingLabel(w, cat) {
    if (cat.hands === "2h") return "Two-Handed";
    return w.wielding === "dual" ? "Dual-Wielding" : w.wielding === "2h" ? "Two-Handed" : "One-Handed";
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

  function weaponHeadRow() {
    var head = el("div", "ps-inv-whead");
    ["Weapon Type", "Properties", "Name / Description", "Wielded", "Dice Pool", "Damage"].forEach(function (label) {
      head.appendChild(el("span", "", label));
    });
    return head;
  }

  function weaponRow(state, w, cat) {
    var row = el("div", "ps-inv-wrow");

    row.appendChild(el("div", "ps-inv-wtype", cat.label));
    row.appendChild(el("div", "ps-inv-wprops", weaponPropsLabel(cat)));
    row.appendChild(el("div", "ps-inv-wname", w.name ? w.name : "—"));
    row.appendChild(el("div", "ps-inv-wwield", wieldingLabel(w, cat)));

    var diceCell = el("div", "ps-inv-wdice");
    diceCell.appendChild(dots(Engine.weaponDicePool(state, cat.id), MAX_DICE_POOL));
    row.appendChild(diceCell);

    row.appendChild(el("div", "ps-inv-wdmg", Engine.weaponDamageNote(w.wielding)));
    return row;
  }

  function blankWeaponRow() {
    var row = el("div", "ps-inv-wrow ps-inv-blank-row");
    row.appendChild(el("div", "ps-inv-wtype"));
    row.appendChild(el("div", "ps-inv-wprops"));
    row.appendChild(el("div", "ps-inv-wname"));
    row.appendChild(el("div", "ps-inv-wwield"));
    var diceCell = el("div", "ps-inv-wdice");
    diceCell.appendChild(dots(0, MAX_DICE_POOL));
    row.appendChild(diceCell);
    row.appendChild(el("div", "ps-inv-wdmg"));
    return row;
  }

  function inventory(state) {
    var inv = state.inventory || {};
    var notes = String(inv.notes || "").trim();
    var weapons = inv.weapons || [];

    var b = block("Inventory");

    var noteLines = notes ? notes.split("\n") : [];
    var lineCount = Math.max(MIN_NOTES_LINES, noteLines.length + NOTES_PADDING_LINES);
    var notesBox = el("div", "ps-inv-notes");
    for (var i = 0; i < lineCount; i++) {
      notesBox.appendChild(el("div", "ps-inv-notes-line", noteLines[i] || " "));
    }
    b.appendChild(notesBox);

    b.appendChild(el("h3", "ps-h3", "Weapons Carried"));
    var table = el("div", "ps-inv-wtable");
    table.appendChild(weaponHeadRow());
    weapons.forEach(function (w) {
      var cat = Engine.weaponCategoryById(w.category);
      if (!cat) return;
      table.appendChild(weaponRow(state, w, cat));
    });
    for (var j = 0; j < BLANK_WEAPON_ROWS; j++) table.appendChild(blankWeaponRow());
    b.appendChild(table);
    return b;
  }

  // ---- the entries (abilities · maneuvers · spells) ------------------------
  // Collected once and rendered twice: as a scannable index on the play sheet,
  // and in full in the appendix. One collection means the two can never
  // disagree about what the character actually has.

  function sortTalents(a, b) {
    return (a.tier || 0) - (b.tier || 0) ||
      String(a.domain || a.sourceName || "").localeCompare(String(b.domain || b.sourceName || ""));
  }

  function unmetNote(status) {
    if (status.met) return null;
    return "requirements no longer met: " + status.reasons.filter(function (r) { return !Engine.reasonMet(r); })
      .map(function (r) { return r.label; }).join(", ");
  }

  function talentEntry(raw, state) {
    var t = Engine.effective(raw, state);
    var status = t.fromSource ? { met: true, granted: true, reasons: [] } : Engine.requirementStatus(t, state);
    var source = t.fromSource ? t.sourceName : ((Engine.treeById(t.domain) || {}).name || t.domain);
    var grantSrc = !t.fromSource && status.granted ? Engine.grantSource(state, "talent", t.id) : null;
    var cost = t.fromSource ? "granted by " + t.sourceName
      : status.granted ? (grantSrc ? "granted by " + grantSrc.name : "free at creation")
      : t.cost + (t.pool === "combat" ? " combat" : " non-combat") + " exp";
    var tags = [];
    if (t.ability === "maneuver") {
      if (t.uses) tags.push("⟳ " + t.uses + " / " + (t.usesPer || "session"));
      if (t.castingTime != null) {
        [Engine.castingTimeLabel(t), Engine.rangeLabel(t), Engine.targetLabel(t),
         Engine.durationLabel(t), Engine.aoeLabel(t)].forEach(function (v) { if (v) tags.push(v); });
      }
    }
    return {
      id: t.id, icon: t.icon || t.name.charAt(0), name: t.name,
      // Resolved here, so the index and the appendix can't disagree and the
      // paper sheet carries the same modified text the screen does (§4.7).
      flavour: Engine.resolveText(t.flavour || "", state),
      description: Engine.resolveText(t.description || "", state),
      source: source, tags: tags, meta: cost + " · " + tierName(t.tier), warn: unmetNote(status),
    };
  }

  function spellEntry(rawSpell, state) {
    var sp = Engine.effective(rawSpell, state);
    var mana = Engine.spellManaCost(sp);
    return {
      id: sp.id, icon: sp.icon || sp.name.charAt(0), name: sp.name,
      flavour: Engine.resolveText(sp.flavour || "", state),
      description: Engine.resolveText(sp.description || "", state),
      source: "T" + (sp.tier || 1),
      tags: [mana ? mana + " mana" : "cantrip", Engine.castingTimeLabel(sp),
        Engine.rangeLabel(sp), Engine.targetLabel(sp), Engine.durationLabel(sp), Engine.aoeLabel(sp)].filter(Boolean),
      meta: (sp.cost || 0) + (sp.pool === "combat" ? " combat" : " non-combat") + " exp",
      warn: unmetNote(Engine.spellRequirementStatus(sp, state)),
    };
  }

  // Returns [{ title, note, entries }] — the groups both halves of the document
  // walk, in the order they appear.
  function entryGroups(state) {
    var owned = Engine.ownedTalents(state);
    var groups = [];

    // Modifiers are absent by design: the paper sheet shows the modified entry,
    // not the modification (§4.8), same as the screen.
    [["Abilities", function (t) { return t.ability !== "maneuver" && !Engine.isModifier(t); }],
     ["Maneuvers", function (t) { return t.ability === "maneuver"; }]].forEach(function (g) {
      var list = owned.filter(g[1]).sort(sortTalents);
      if (list.length) {
        groups.push({
          title: g[0], note: String(list.length),
          entries: list.map(function (t) { return talentEntry(t, state); }),
        });
      }
    });

    // One group per magical domain the character casts in, so the spell-test
    // pool that applies to those spells sits in the heading above them.
    Engine.magicalDomains().forEach(function (d) {
      var spells = Engine.spellsForDomain(d.id).filter(function (sp) { return Engine.spellOwned(state, sp.id); });
      var ladder = Engine.spellcastingLevel(state, d.id);
      if (!ladder && !spells.length) return;
      var p = Engine.spellPool(state, d.id);
      groups.push({
        title: "Spells · " + d.name,
        note: p.charKey
          ? "spellcasting +" + p.ladder + " · pool " + charAbbr(p.charKey) + " " + p.charVal + " + " + p.ladder + " = " + p.total + " dice"
          : "spellcasting +" + p.ladder,
        entries: spells
          .sort(function (a, b) { return (a.tier || 1) - (b.tier || 1) || a.name.localeCompare(b.name); })
          .map(function (sp) { return spellEntry(sp, state); }),
        empty: "Able to cast, but no spells learned yet.",
      });
    });

    return groups;
  }

  // The play-sheet half: names and the numbers you need mid-roll, nothing else.
  function entryIndex(groups) {
    if (!groups.length) return null;
    var b = block("Abilities, Maneuvers & Spells", "rules text in the appendix", "ps-index");
    groups.forEach(function (g) {
      b.appendChild(groupHead(g));
      if (!g.entries.length) { b.appendChild(el("div", "ps-empty", g.empty || "—")); return; }
      var list = el("div", "ps-index-list");
      g.entries.forEach(function (e) {
        // The dotted leader exists to carry the eye across to something on the
        // right. A plain passive has nothing over there, so it gets no leader —
        // otherwise the line reads as unfinished.
        var trailing = e.tags.length || e.warn;
        var row = el("div", "ps-row ps-index-row" + (trailing ? "" : " ps-plain"));
        var name = el("span", "ps-row-name", e.name);
        name.appendChild(el("span", "ps-row-sub", e.source));
        row.appendChild(name);
        if (trailing) {
          var tags = el("span", "ps-tags");
          e.tags.forEach(function (t) { tags.appendChild(el("span", "ps-tag", t)); });
          if (e.warn) tags.appendChild(el("span", "ps-tag ps-warn", "⚠"));
          row.appendChild(tags);
        }
        list.appendChild(row);
      });
      b.appendChild(list);
    });
    return b;
  }

  function groupHead(g) {
    var h = el("h3", "ps-h3", g.title);
    if (g.note) h.appendChild(el("span", "ps-h3-note", g.note));
    return h;
  }

  // The appendix: the same entries with their rules text, starting on its own
  // page. This is the half the old print output dropped entirely.
  function appendix(groups, state) {
    var withText = groups.filter(function (g) { return g.entries.length; });
    if (!withText.length) return null;

    var b = block("Rules Reference", state.identity.characterName || "", "ps-appendix");
    withText.forEach(function (g) {
      b.appendChild(groupHead(g));
      g.entries.forEach(function (e) {
        var card = el("article", "ps-entry");
        var head = el("div", "ps-entry-head");
        head.appendChild(el("span", "ps-entry-icon", e.icon));
        var t = el("div", "ps-entry-titles");
        var nameLine = el("div", "ps-entry-name", e.name);
        e.tags.forEach(function (tag) { nameLine.appendChild(el("span", "ps-tag", tag)); });
        t.appendChild(nameLine);
        t.appendChild(el("div", "ps-entry-meta", e.source + " · " + e.meta));
        head.appendChild(t);
        card.appendChild(head);
        if (e.flavour) card.appendChild(el("div", "ps-entry-flavour", e.flavour));
        if (e.description) card.appendChild(el("div", "ps-entry-desc", e.description));
        if (e.warn) card.appendChild(el("div", "ps-entry-warn", "⚠ " + e.warn));
        b.appendChild(card);
      });
    });
    return b;
  }

  // ---- assembly ------------------------------------------------------------

  function build(state, opts) {
    var doc = el("div", "ps-doc");
    doc.appendChild(masthead(state));

    var sheet = el("div", "ps-play");
    sheet.appendChild(vitals(state));
    sheet.appendChild(experience(state));
    sheet.appendChild(skills(state, opts));
    sheet.appendChild(proficiencies(state));
    sheet.appendChild(inventory(state));

    var groups = entryGroups(state);
    var index = entryIndex(groups);
    if (index) sheet.appendChild(index);
    doc.appendChild(sheet);

    var app = appendix(groups, state);
    if (app) doc.appendChild(app);
    return doc;
  }

  // Rebuilds into `#print-sheet` (or a given host). Cheap enough to run on every
  // state change, which is what keeps the paper copy from ever going stale.
  // `opts.skillsGroupByChar` mirrors the on-screen toggle of the same name.
  function render(state, opts) {
    opts = opts || {};
    var host = opts.host || document.getElementById("print-sheet");
    if (!host) return null;
    host.innerHTML = "";
    host.appendChild(build(state, opts));
    return host;
  }

  window.PrintSheet = { build: build, render: render };
})();
