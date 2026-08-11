// ============================================================================
// Rules engine — pure logic: the tree registry, costs, tiers, requirement
// checking, the tree-access surcharge, and database validation.
// No DOM here. Reads the databases and a character `state`; never mutates it.
// ============================================================================

(function () {
  var CONFIG = window.CONFIG;

  // ---- Tree registry ------------------------------------------------------
  // Three kinds of tree, all sharing one talent schema and one id space:
  //   core        — always visible                       (js/data/domains.js)
  //   ancestry    — visible only to that ancestry        (js/data/ancestries.js)
  //   combination — visible once both parents have talents (js/data/combinations.js)
  var trees = [], treeIndex = {};

  function buildTrees() {
    trees = [];
    (window.DOMAINS || []).forEach(function (d) {
      trees.push({ id: d.id, name: d.name, icon: d.icon, accent: d.accent, cols: d.cols, kind: d.kind || "core", magical: !!d.magical, hidden: !!d.hidden, groups: d.groups || [], anchors: d.anchors || [] });
    });
    (window.ANCESTRIES || []).forEach(function (a) {
      trees.push({ id: a.treeId, name: a.name, icon: a.icon, accent: a.accent, cols: a.cols || 3,
        kind: "ancestry", ancestry: a.id, parent: a.parent || null, description: a.description, hidden: !!a.hidden, groups: a.groups || [], anchors: a.anchors || [] });
    });
    (window.COMBINATIONS || []).forEach(function (c) {
      trees.push({ id: c.id, name: c.name, icon: c.icon, accent: c.accent, cols: c.cols || 3,
        kind: "combination", parents: c.parents || [], description: c.description, groups: c.groups || [], anchors: c.anchors || [] });
    });
    treeIndex = {};
    trees.forEach(function (t) { treeIndex[t.id] = t; });
  }

  function allTrees() { return trees; }
  function treeById(id) { return treeIndex[id]; }
  function treesOfKind(kind) { return trees.filter(function (t) { return t.kind === kind; }); }

  // ---- Talent groups ------------------------------------------------------
  // A group boxes up adjacent talents that share a requirement, so the tree can
  // draw ONE arrow into the box instead of one per member (§6b). It is a
  // drawing construct with a validated claim behind it: each member still
  // carries its own full `requires`, so the engine, the sheet and the PDF never
  // need to know groups exist. `requires` on the group is the part they have in
  // common — the validator checks that it really is common, and the editor is
  // what keeps them in step.
  function treeGroups(treeId) {
    var t = treeById(treeId);
    return (t && t.groups) || [];
  }

  // ---- Manual link anchors ------------------------------------------------
  // A drawing construct like a group, and on the tree for the same reason: it
  // says nothing about the rules, only about where one already-implied arrow
  // should be dragged. Each entry pins one prerequisite line through a list of
  // waypoints in grid coordinates (`{ col, row }`, half steps meaning
  // "between"), so an anchor survives a resize, a row widening for its lanes,
  // or a talent landing in the column it passes. `to` names either a talent or
  // one of the tree's groups, matching what the line actually points at.
  function treeAnchors(treeId) {
    var t = treeById(treeId);
    return (t && t.anchors) || [];
  }

  function anchorFor(treeId, from, to) {
    var found = null;
    treeAnchors(treeId).forEach(function (a) {
      if (a.from === from && a.to === to) found = a;
    });
    return found;
  }

  // The group a node belongs to, if any. Takes a talent or a spell: both are
  // nodes in the same grid, so either can be boxed into a group.
  function groupOf(entryId) {
    var t = entryById(entryId);
    if (!t) return null;
    var found = null;
    treeGroups(entryTreeId(t)).forEach(function (g) {
      if ((g.members || []).indexOf(entryId) >= 0) found = g;
    });
    return found;
  }

  // Does `whole` contain everything `part` asks for? Used to check that a
  // group's declared shared requirement really is shared by every member.
  function requirementsCover(whole, part) {
    whole = whole || {}; part = part || {};
    var listsOk = ["talents", "anyTalents"].every(function (key) {
      var have = whole[key] || [];
      return (part[key] || []).every(function (id) { return have.indexOf(id) >= 0; });
    });
    if (!listsOk) return false;
    var mapsOk = ["skills", "characteristics", "proficiencies", "spent"].every(function (key) {
      var have = whole[key] || {}, want = part[key] || {};
      return Object.keys(want).every(function (k) { return (have[k] || 0) >= want[k]; });
    });
    if (!mapsOk) return false;
    // The any* (OR-group) counterparts hold richer entries than a plain id,
    // so containment is entry-by-entry equality on their own key fields
    // rather than an indexOf/threshold check.
    var anyGroupsOk = [["anySkills", ["name", "tier"]], ["anyCharacteristics", ["key", "value"]],
                        ["anyProficiencies", ["name", "tier"]]].every(function (spec) {
      var key = spec[0], fields = spec[1];
      var have = whole[key] || [];
      return (part[key] || []).every(function (want) {
        return have.some(function (h) { return fields.every(function (f) { return h[f] === want[f]; }); });
      });
    });
    return anyGroupsOk;
  }

  // ---- Talent index -------------------------------------------------------
  var byId = {}, allTalents = [];
  // Spell index state (declared here so the initial indexTalents() call — which
  // runs indexSpells() — isn't wiped by a later inline initializer).
  var spellsById = {}, spellsByDomain = {}, spellDomainById = {};

  function indexTalents() {
    buildTrees();
    byId = {}; allTalents = [];
    var db = window.TALENT_DB || {};
    Object.keys(db).forEach(function (treeId) {
      (db[treeId] || []).forEach(function (t) {
        t.domain = treeId;                 // stamp the owning tree onto each talent
        allTalents.push(t);
        byId[t.id] = t;
      });
    });
    indexSpells();
  }
  indexTalents();

  function talentById(id) { return byId[id]; }
  function talentsForDomain(treeId) { return (window.TALENT_DB || {})[treeId] || []; }

  // ---- Spell index --------------------------------------------------------
  // Spells live in window.SPELLS keyed by (magical) domain id. Unlike talents,
  // spell objects are NOT mutated with a runtime `domain` field — the owning
  // domain is tracked in a side map — so the editor can serialize them verbatim.
  // (State vars are declared up in the talent-index section — see the note there.)
  function indexSpells() {
    spellsById = {}; spellsByDomain = {}; spellDomainById = {};
    var db = window.SPELLS || {};
    Object.keys(db).forEach(function (domainId) {
      var list = db[domainId] || [];
      spellsByDomain[domainId] = list;
      list.forEach(function (sp) { spellsById[sp.id] = sp; spellDomainById[sp.id] = domainId; });
    });
  }
  function spellById(id) { return spellsById[id]; }
  function spellsForDomain(domainId) { return spellsByDomain[domainId] || []; }
  function spellDomain(id) { return spellDomainById[id] || null; }
  function allSpells() {
    var out = [];
    Object.keys(spellsByDomain).forEach(function (d) { (spellsByDomain[d] || []).forEach(function (s) { out.push(s); }); });
    return out;
  }

  // ---- Tree entries (talents AND spells share one grid) -------------------
  // A magical domain's spells sit in its talent tree, in the same row/col
  // space, drawn as ordinary nodes and linked by the same prerequisite lines
  // (§4.6). The two stay different *rules* — a spell gates on a Spellcasting
  // proficiency tier, a talent on tier of play plus in-tree exp — but they are
  // one set of nodes to place, so every grid renderer asks for entries rather
  // than talents, and dispatches on `entryKind` where the rules differ.
  //
  // A node's corner marker is exactly this classification, which is why it
  // lives here and not in a renderer: the trees page, the editor and the tests
  // must agree on what a given entry *is*.
  var ENTRY_KIND_MARKS = { passive: "P", maneuver: "M", spell: "S", modifier: "mod" };
  var ENTRY_KIND_NAMES = { passive: "Passive", maneuver: "Maneuver", spell: "Spell", modifier: "Modifier" };

  function isSpellEntry(entry) { return !!(entry && spellDomainById[entry.id] !== undefined); }
  function entryKind(entry) {
    if (!entry) return null;
    if (isSpellEntry(entry)) return "spell";
    if (entry.ability === "modifier") return "modifier";
    if (entry.ability === "maneuver") return "maneuver";
    return "passive";
  }
  function entryKindMark(entry) { return ENTRY_KIND_MARKS[entryKind(entry)] || ""; }
  function entryKindName(entry) { return ENTRY_KIND_NAMES[entryKind(entry)] || ""; }

  // A talent or a spell, by id — the lookup every renderer wants now that a
  // prerequisite, a modifier target and a grid node can all be either.
  function entryById(id) { return byId[id] || spellsById[id] || null; }
  function entryTreeId(entry) {
    if (!entry) return null;
    return entry.domain || spellDomainById[entry.id] || null;
  }
  // Everything placed in one tree's grid, talents first so a collision between
  // the two reads consistently wherever the list is walked.
  function treeEntries(treeId) {
    return talentsForDomain(treeId).concat(spellsForDomain(treeId));
  }
  function entryOwned(state, entry) {
    if (!entry) return false;
    return isSpellEntry(entry)
      ? spellOwned(state, entry.id)
      : (state.talents || []).indexOf(entry.id) >= 0;
  }
  // The right requirement check for whichever kind this is, so a caller can
  // treat a grid cell uniformly. Both return the same { owned, met, reasons }
  // shape; only a talent can be `granted`.
  function entryRequirementStatus(entry, state) {
    return isSpellEntry(entry) ? spellRequirementStatus(entry, state) : requirementStatus(entry, state);
  }

  // ---- Granted (free) baseline -------------------------------------------
  function grantedOf(state) {
    return state.granted || { talents: [], skills: {}, proficiencies: {} };
  }
  function isGrantedSpell(state, id) {
    return (grantedOf(state).spells || []).indexOf(id) >= 0;
  }
  function isGrantedTalent(state, id) {
    return grantedOf(state).talents.indexOf(id) >= 0;
  }
  function grantedSkillTier(state, name) {
    return grantedOf(state).skills[name] || 0;
  }
  function grantedProfTier(state, name) {
    var g = grantedOf(state).proficiencies || {};
    var key = Object.keys(g).filter(function (k) {
      return k.toLowerCase() === String(name || "").toLowerCase();
    })[0];
    return key ? (g[key] || 0) : 0;
  }

  // ---- Costs --------------------------------------------------------------
  // Total cost to reach `tier` given a per-step cost array.
  function sumSteps(costArray, tier) {
    var total = 0;
    for (var i = 0; i < tier && i < costArray.length; i++) total += costArray[i];
    return total;
  }
  // Cost of moving from `fromTier` up to `toTier` (0 if already at or above).
  function stepCost(costArray, fromTier, toTier) {
    if (toTier <= fromTier) return 0;
    return sumSteps(costArray, toTier) - sumSteps(costArray, fromTier);
  }
  var COMBAT_SKILL_NAMES = null;
  function isCombatSkill(name) {
    if (!COMBAT_SKILL_NAMES) {
      COMBAT_SKILL_NAMES = {};
      (window.SKILLS.combat || []).forEach(function (s) { COMBAT_SKILL_NAMES[s.name] = true; });
    }
    return !!COMBAT_SKILL_NAMES[name];
  }
  function findKind(id) {
    return (window.PROFICIENCY_KINDS || []).filter(function (k) { return k.id === id; })[0];
  }

  // ---- Weapon categories (inventory section) -------------------------------
  function weaponCategories() { return window.WEAPON_CATEGORIES || []; }
  function weaponCategoryById(id) {
    return weaponCategories().filter(function (c) { return c.id === id; })[0];
  }
  // Dice pool for a weapon's attack test: its characteristic score + the
  // character's trained tier in that category (0 if untrained) — talent and
  // circumstantial bonuses are situational and not shown on the static sheet.
  function weaponDicePool(state, categoryId) {
    var cat = weaponCategoryById(categoryId);
    if (!cat) return 0;
    var charScore = (state.characteristics || {})[cat.characteristic] || 0;
    return charScore + profTier(state, cat.label);
  }
  // Damage note for a chosen wielding: two-handed or dual-wielding adds +1 to
  // the number of successes rolled (main.tex "Attacking"). Spelled out with a
  // literal "#" rather than a filled-in number: the actual count depends on
  // the roll, so this is a formula to read at the table, not a precomputed value.
  function weaponDamageNote(wielding) {
    return (wielding === "2h" || wielding === "dual") ? "1 + # successes" : "# successes";
  }

  // ---- Tree-access surcharge ---------------------------------------------
  // Your first tree containing a PURCHASED talent is free; each further tree
  // costs a one-time surcharge from CONFIG.TREE_ACCESS.costs, charged to the
  // pool of the talent that opened it. Granted talents never open a tree, and
  // exempt tree kinds (ancestry) never charge. Because the surcharge ladder is
  // applied in the order trees were opened, the total is the same however you
  // reorder your purchases — refunds stay predictable.
  function treeAccessCharges(state) {
    var conf = CONFIG.TREE_ACCESS || { costs: [], exemptKinds: [] };
    var costs = conf.costs || [];
    var exempt = conf.exemptKinds || [];
    var opened = [], seen = {};

    (state.talents || []).forEach(function (id) {
      if (isGrantedTalent(state, id)) return;
      var t = byId[id];
      if (!t || seen[t.domain]) return;
      var tree = treeById(t.domain);
      if (!tree || exempt.indexOf(tree.kind) >= 0) return;
      seen[t.domain] = true;
      opened.push({
        treeId: t.domain,
        name: tree.name,
        pool: t.pool === "combat" ? "combat" : "noncombat",
      });
    });

    return opened.map(function (o, i) {
      var cost = i === 0 ? 0 : (costs[i - 1] !== undefined ? costs[i - 1] : costs[costs.length - 1] || 0);
      return { treeId: o.treeId, name: o.name, pool: o.pool, cost: cost, index: i, first: i === 0 };
    });
  }

  // What the NEXT new tree would cost (for the UI to warn about).
  function nextTreeCost(state) {
    var conf = CONFIG.TREE_ACCESS || { costs: [] };
    var costs = conf.costs || [];
    var n = treeAccessCharges(state).length;   // trees already opened
    if (n === 0) return 0;
    return costs[n - 1] !== undefined ? costs[n - 1] : (costs[costs.length - 1] || 0);
  }

  // ---- Spent exp ----------------------------------------------------------
  // Recomputed from scratch every render; never stored. Everything in the
  // granted baseline is subtracted out, so creation picks cost nothing.
  function computeSpent(state) {
    var spent = { combat: 0, noncombat: 0, breakdown: { skills: 0, proficiencies: 0, talents: 0, treeAccess: 0, spellcasting: 0, spells: 0 } };

    Object.keys(state.skills || {}).forEach(function (name) {
      var tier = state.skills[name] || 0;
      if (!tier) return;
      var pool = isCombatSkill(name) ? "combat" : "noncombat";
      var free = Math.min(grantedSkillTier(state, name), tier);
      var cost = stepCost(CONFIG.SKILL_COSTS[pool], free, tier);
      spent[pool] += cost;
      spent.breakdown.skills += cost;
    });

    (state.proficiencies || []).forEach(function (p) {
      var kind = findKind(p.kind);
      if (!kind) return;
      var tier = p.tier || 0;
      var free = Math.min(grantedProfTier(state, p.name), tier);
      var cost = stepCost(CONFIG.SKILL_COSTS[kind.costKey], free, tier);
      spent[kind.pool] += cost;
      // A spellcasting proficiency is tracked on its own breakdown line (it
      // feeds maxMana below), separate from ordinary proficiencies.
      if (kind.id === "spellcasting") spent.breakdown.spellcasting += cost;
      else spent.breakdown.proficiencies += cost;
    });

    (state.talents || []).forEach(function (id) {
      if (isGrantedTalent(state, id)) return;
      var t = byId[id];
      if (!t) return;
      spent[t.pool === "combat" ? "combat" : "noncombat"] += (t.cost || 0);
      spent.breakdown.talents += (t.cost || 0);
    });

    treeAccessCharges(state).forEach(function (c) {
      spent[c.pool] += c.cost;
      spent.breakdown.treeAccess += c.cost;
    });

    // Learned spells: each carries its own exp cost drawn from its own pool.
    // A spell handed out by a grant (§4.9) sits in the granted baseline and is
    // free, the same way a granted talent is.
    (state.spells || []).forEach(function (id) {
      var sp = spellsById[id];
      if (!sp || isGrantedSpell(state, id)) return;
      var cost = sp.cost || 0;
      spent[sp.pool === "combat" ? "combat" : "noncombat"] += cost;
      spent.breakdown.spells += cost;
    });

    spent.total = spent.combat + spent.noncombat;
    return spent;
  }

  // Exp spent inside one tree. This is what gates talent tiers, alongside the
  // tier of play. Granted talents are free and don't count; the one-time access
  // surcharge for opening the tree does, since it was spent to get in.
  function treeSpent(state, treeId) {
    var total = 0;
    (state.talents || []).forEach(function (id) {
      if (isGrantedTalent(state, id)) return;
      var t = byId[id];
      if (t && t.domain === treeId) total += (t.cost || 0);
    });
    treeAccessCharges(state).forEach(function (c) {
      if (c.treeId === treeId) total += c.cost;
    });
    return total;
  }

  // ---- Level caps ---------------------------------------------------------
  // Skills, proficiencies and characteristics all top out at 5, but how much of
  // that range is reachable depends on the tier of play — each tier opens one
  // more level. `skillCap` covers proficiencies too (every kind, Spellcasting
  // included): one rule, so there is nothing for the two to drift apart on.
  function skillCap(state) {
    var tier = currentTierIndex(state) + 1;
    return Math.min(CONFIG.MAX_SKILL_TIER, tier + CONFIG.LEVEL_CAPS.skillOffset);
  }
  function characteristicCap(state) {
    var tier = currentTierIndex(state) + 1;
    return Math.min(CONFIG.MAX_CHARACTERISTIC, tier + CONFIG.LEVEL_CAPS.characteristicOffset);
  }

  // ---- Characteristic advancement -----------------------------------------
  // Characteristics are fixed at creation. Every tier of play after the first
  // lets the character raise CHARACTERISTIC_ADVANCES_PER_TIER *different*
  // characteristics by one. Picks are recorded per tier so that "different"
  // can be enforced within each tier's allocation.
  function charAdvanceTiers(state) {
    var tier = currentTierIndex(state) + 1;
    var out = [];
    for (var t = 2; t <= tier; t++) out.push(t);
    return out;
  }
  function charAdvancePicks(state, tier) {
    return ((state.charAdvances || {})[String(tier)] || []).slice();
  }
  function charAdvancesRemaining(state) {
    var per = CONFIG.CHARACTERISTIC_ADVANCES_PER_TIER;
    var left = 0;
    charAdvanceTiers(state).forEach(function (t) {
      left += Math.max(0, per - charAdvancePicks(state, t).length);
    });
    return left;
  }
  function characteristicBase(state, key) {
    var g = (state.granted && state.granted.characteristics) || {};
    return g[key] || 0;
  }

  // ---- Tiers of play ------------------------------------------------------
  function currentTierIndex(state) {
    var total = computeSpent(state).total;
    var idx = 0;
    CONFIG.TIERS.forEach(function (t, i) { if (total >= t.minSpent) idx = i; });
    return idx;
  }
  function tierThreshold(tierNumber) {
    var t = CONFIG.TIERS[tierNumber - 1];
    return t ? t.minSpent : 0;
  }
  function charLabel(key) {
    var c = (CONFIG.CHARACTERISTICS || []).filter(function (x) { return x.key === key; })[0];
    return c ? c.label : key;
  }
  function poolLabel(pool) {
    if (pool === "combat") return "combat";
    if (pool === "noncombat") return "non-combat";
    return "total";
  }
  function profTier(state, name) {
    var p = (state.proficiencies || []).filter(function (x) {
      return (x.name || "").toLowerCase() === String(name).toLowerCase();
    })[0];
    return p ? (p.tier || 0) : 0;
  }

  // ---- Tree visibility ----------------------------------------------------
  function hasTalentInTree(state, treeId) {
    return (state.talents || []).some(function (id) {
      var t = byId[id];
      return t && t.domain === treeId;
    });
  }

  function hasSpellInDomain(state, domainId) {
    return (state.spells || []).some(function (id) { return spellDomainById[id] === domainId; });
  }

  // Investment in one of a combination tree's parents: a talent in that tree,
  // or — for a magical domain — a spell learned from it. Granted ones count.
  function hasInvestmentInTree(state, treeId) {
    return hasTalentInTree(state, treeId) || hasSpellInDomain(state, treeId);
  }

  // A combination tree unlocks once the character has at least one talent OR
  // spell in BOTH of its parent trees. Spells count because a magical domain's
  // content lives largely on the Spells page: requiring a *talent* would make a
  // combination tree unreachable for a caster who had invested heavily in the
  // domain but bought no talent in it.
  function combinationUnlocked(tree, state) {
    if (!tree || tree.kind !== "combination") return true;
    return (tree.parents || []).every(function (pid) { return hasInvestmentInTree(state, pid); });
  }

  // Ancestries form a hierarchy (ancestry → sub → sub-sub) via `parent`. A
  // character of a given ancestry has access to its own tree AND every ancestor
  // tree above it. This returns [self, parent, grandparent, …] ancestry ids.
  function ancestryChain(ancestryId) {
    var chain = [], seen = {}, cur = ancestryId, guard = 0;
    while (cur && !seen[cur] && guard++ < 20) {
      var a = ancestryById(cur);
      if (!a) break;
      chain.push(a.id); seen[a.id] = true;
      cur = a.parent || null;
    }
    return chain;
  }
  function ancestryDepth(ancestryId) { return ancestryChain(ancestryId).length; }
  function accessibleAncestryTreeIds(state) {
    var sel = state.creation && state.creation.ancestry;
    if (!sel) return [];
    return ancestryChain(sel).map(function (aid) {
      var a = ancestryById(aid); return a ? a.treeId : null;
    }).filter(Boolean);
  }

  function treeVisible(tree, state, showAllCombinations) {
    if (tree.hidden) return false;   // marked hidden in the editor — not shown on the user site
    if (tree.kind === "ancestry") {
      // Visible for the character's own ancestry and all of its ancestors.
      return accessibleAncestryTreeIds(state).indexOf(tree.id) >= 0;
    }
    if (tree.kind === "combination") {
      return !!showAllCombinations || combinationUnlocked(tree, state);
    }
    return true;   // core
  }

  function visibleTrees(state, showAllCombinations) {
    return trees.filter(function (t) { return treeVisible(t, state, showAllCombinations); });
  }

  // ---- Requirement evaluation --------------------------------------------
  // The "at least one of these" counterpart to anyTalents, for skills/
  // characteristics/proficiencies — same OR relationship, richer entries
  // since each also carries its own threshold (a bare id isn't enough).
  // Shared by requirementStatus and spellRequirementStatus, which otherwise
  // duplicate the plain AND-map handling for these three kinds.
  function pushAnyReqReasons(reasons, state, reqs) {
    if (reqs.anySkills && reqs.anySkills.length) {
      var anySkillsMet = reqs.anySkills.some(function (s) { return ((state.skills || {})[s.name] || 0) >= s.tier; });
      reqs.anySkills.forEach(function (s) {
        var have = (state.skills || {})[s.name] || 0;
        reasons.push({ type: "skill", mode: "any", groupMet: anySkillsMet,
          label: s.name + " " + s.tier, detail: "have " + have, met: have >= s.tier });
      });
    }
    if (reqs.anyCharacteristics && reqs.anyCharacteristics.length) {
      var anyCharsMet = reqs.anyCharacteristics.some(function (c) { return ((state.characteristics || {})[c.key] || 0) >= c.value; });
      reqs.anyCharacteristics.forEach(function (c) {
        var have = (state.characteristics || {})[c.key] || 0;
        reasons.push({ type: "characteristic", mode: "any", groupMet: anyCharsMet,
          label: charLabel(c.key) + " " + c.value, detail: "have " + have, met: have >= c.value });
      });
    }
    if (reqs.anyProficiencies && reqs.anyProficiencies.length) {
      var anyProfsMet = reqs.anyProficiencies.some(function (p) { return profTier(state, p.name) >= p.tier; });
      reqs.anyProficiencies.forEach(function (p) {
        var have = profTier(state, p.name);
        reasons.push({ type: "proficiency", mode: "any", groupMet: anyProfsMet,
          label: p.name + " " + p.tier, detail: "have " + have, met: have >= p.tier });
      });
    }
  }

  // Returns { owned, granted, met, reasons }. Each reason renders as one
  // requirement line, coloured by reasonMet().
  function requirementStatus(talent, state) {
    var owned = (state.talents || []).indexOf(talent.id) >= 0;
    var reqs = talent.requires || {};
    var reasons = [];
    var spent = computeSpent(state);
    var curTier = currentTierIndex(state) + 1;
    var tree = treeById(talent.domain);

    // The combination tree itself must be unlocked.
    if (tree && tree.kind === "combination") {
      var parentNames = (tree.parents || []).map(function (p) {
        var pt = treeById(p); return pt ? pt.name : p;
      });
      reasons.push({
        type: "combination",
        label: "Talents or spells in " + parentNames.join(" and "),
        detail: "combination tree",
        met: combinationUnlocked(tree, state),
      });
    }

    // A talent's tier has two independent gates: the character's tier of play,
    // and exp spent inside this particular tree.
    var tierNum = talent.tier || 1;
    reasons.push({
      type: "tier",
      label: ((CONFIG.TIERS[tierNum - 1] || {}).name || ("Tier " + tierNum)) + " of play",
      detail: "needs " + tierThreshold(tierNum) + " total exp spent",
      met: curTier >= tierNum,
    });

    // The in-tree exp gate does NOT apply to ancestral trees — heritage talents
    // are gated by tier of play alone, not by investment in the tree.
    var needTree = CONFIG.TALENT_TIER_TREE_EXP[tierNum - 1] || 0;
    if (needTree > 0 && (!tree || tree.kind !== "ancestry")) {
      var haveTree = treeSpent(state, talent.domain);
      reasons.push({
        type: "treeSpent",
        label: needTree + " exp spent in " + ((tree || {}).name || "this tree"),
        detail: "have " + haveTree,
        met: haveTree >= needTree,
      });
    }

    // Prerequisite talents or spells (all required). A prerequisite id may
    // point at either — spells are learnable like talents, so a talent can
    // require a spell the same way a spell can already require a talent.
    (reqs.talents || []).forEach(function (pid) {
      var pre = resolveReqTarget(pid);
      var preDomain = pre ? (pre.domain || spellDomain(pid)) : null;
      reasons.push({
        type: "talent", mode: "all", talentId: pid,
        label: pre ? pre.name : pid,
        crossDomain: pre ? preDomain !== talent.domain : true,
        crossTreeName: pre && preDomain !== talent.domain ? ((treeById(preDomain) || {}).name || preDomain) : null,
        met: isOwnedReqId(state, pid),
      });
    });

    // Any-of prerequisite talents or spells (at least one)
    if (reqs.anyTalents && reqs.anyTalents.length) {
      var anyMet = reqs.anyTalents.some(function (pid) { return isOwnedReqId(state, pid); });
      reqs.anyTalents.forEach(function (pid) {
        var pre = resolveReqTarget(pid);
        var preDomain = pre ? (pre.domain || spellDomain(pid)) : null;
        reasons.push({
          type: "talent", mode: "any", talentId: pid, groupMet: anyMet,
          label: pre ? pre.name : pid,
          crossDomain: pre ? preDomain !== talent.domain : true,
          crossTreeName: pre && preDomain !== talent.domain ? ((treeById(preDomain) || {}).name || preDomain) : null,
          met: isOwnedReqId(state, pid),
        });
      });
    }

    Object.keys(reqs.skills || {}).forEach(function (name) {
      var need = reqs.skills[name], have = (state.skills || {})[name] || 0;
      reasons.push({ type: "skill", label: name + " " + need, detail: "have " + have, met: have >= need });
    });

    Object.keys(reqs.characteristics || {}).forEach(function (key) {
      var need = reqs.characteristics[key], have = (state.characteristics || {})[key] || 0;
      reasons.push({ type: "characteristic", label: charLabel(key) + " " + need, detail: "have " + have, met: have >= need });
    });

    Object.keys(reqs.proficiencies || {}).forEach(function (name) {
      var need = reqs.proficiencies[name], have = profTier(state, name);
      reasons.push({ type: "proficiency", label: name + " " + need, detail: "have " + have, met: have >= need });
    });

    pushAnyReqReasons(reasons, state, reqs);

    if (reqs.spent) {
      Object.keys(reqs.spent).forEach(function (pool) {
        var need = reqs.spent[pool], have = spent[pool] || 0;
        reasons.push({ type: "spent", label: need + " " + poolLabel(pool) + " exp spent", detail: "have " + have, met: have >= need });
      });
    }

    return {
      owned: owned,
      granted: isGrantedTalent(state, talent.id),
      met: reasons.every(reasonMet),
      reasons: reasons,
    };
  }

  // Any reason belonging to an OR-group (anyTalents, anySkills,
  // anyCharacteristics, anyProficiencies) is met when the GROUP is, not when
  // its own individual `met` is true — groupMet is precomputed once per group.
  function reasonMet(r) {
    if (r.mode === "any") return r.groupMet;
    return r.met;
  }

  function canLearn(talent, state) {
    if ((state.talents || []).indexOf(talent.id) >= 0) return false;
    return requirementStatus(talent, state).met;
  }

  // What learning this talent actually costs right now, including a tree-access
  // surcharge if it would open a new tree.
  function learnCost(talent, state) {
    var conf = CONFIG.TREE_ACCESS || { costs: [], exemptKinds: [] };
    var tree = treeById(talent.domain);
    var surcharge = 0;
    var opensTree = false;
    if (tree && (conf.exemptKinds || []).indexOf(tree.kind) < 0) {
      var already = treeAccessCharges(state).some(function (c) { return c.treeId === talent.domain; });
      if (!already) { opensTree = true; surcharge = nextTreeCost(state); }
    }
    return {
      base: talent.cost || 0,
      surcharge: surcharge,
      opensTree: opensTree,
      total: (talent.cost || 0) + surcharge,
      pool: talent.pool === "combat" ? "combat" : "noncombat",
    };
  }

  // Granted talents can never be refunded; otherwise refunding is blocked when
  // another owned TALENT would lose its requirements. Spells are deliberately
  // NOT part of this simulation, in either direction: lowering a Spellcasting
  // proficiency out from under a known spell is allowed, and so is unlearning
  // a spell that a talent (or another spell) requires — matching the sheet's
  // permissive philosophy. Whatever depended on it stays owned but flags red,
  // same as any other owned-but-unmet requirement.
  function canRefund(talentId, state) {
    if ((state.talents || []).indexOf(talentId) < 0) return { ok: false, reason: "not owned" };
    if (isGrantedTalent(state, talentId)) return { ok: false, reason: "granted", granted: true };

    var sim = JSON.parse(JSON.stringify(state));
    // Refunding also takes back whatever this talent granted (§4.9), so the
    // simulation has to run on the post-revocation state — otherwise a talent
    // standing only on a granted prerequisite would look safe to refund.
    revokeGrants(sim, talentId);
    sim.talents = sim.talents.filter(function (id) { return id !== talentId; });
    var broken = [];
    sim.talents.forEach(function (id) {
      var t = byId[id];
      if (t && !requirementStatus(t, sim).met) broken.push(t.name);
    });
    return broken.length ? { ok: false, blockedBy: broken } : { ok: true };
  }

  // ---- Database validation ------------------------------------------------
  var validSpellTargets = { self: true, ally: true, enemy: true, object: true, point: true };
  // Target kinds a `numTargets` count applies to — "self" is always exactly one.
  var countableTargets = { ally: true, enemy: true, object: true, point: true };
  var validDurationUnits = { minutes: true, hours: true, days: true, weeks: true, rounds: true };
  // The only legal aoe.shape values — shared by the raw-entry check below and
  // the modifier validation for "aoe.shape" (§4.8), so the editor's dropdown
  // and both validators can never drift apart.
  var AOE_SHAPES = ["cone", "arc", "line", "circle"];

  // Shared by spells and maneuver talents — both carry the same "castable"
  // fields describing what they affect, for how long, and where. `label` is
  // the message prefix already used by the caller's other problems for this
  // object (e.g. `t.id` for a talent, `"spell '" + sp.id + "'"` for a spell).
  function validateCastableFields(problems, label, obj) {
    if (!(obj.castingTime === "minor_action" || obj.castingTime === "action" || obj.castingTime === "major_action" ||
          obj.castingTime === "reaction" || obj.castingTime === "free" ||
          (typeof obj.castingTime === "number" && obj.castingTime > 0)))
      problems.push(label + ": castingTime must be 'minor_action' (1 action), 'action' (2 actions), 'major_action' (3 actions), 'reaction', 'free', or a positive number of minutes (got " + JSON.stringify(obj.castingTime) + ")");
    if (obj.range != null &&
        !(obj.range === "self" || obj.range === "touch" || obj.range === "weapon" || (typeof obj.range === "number" && obj.range > 0)))
      problems.push(label + ": range must be 'self', 'touch', 'weapon', or a positive number of yards (got " + JSON.stringify(obj.range) + ")");
    if (obj.target != null && (!Array.isArray(obj.target) || obj.target.some(function (t) { return !validSpellTargets[t]; })))
      problems.push(label + ": target must be a list from self/ally/enemy/object/point, or omitted entirely (got " + JSON.stringify(obj.target) + ")");
    if (obj.numTargets != null) {
      if (typeof obj.numTargets !== "number" || obj.numTargets < 1 || Math.floor(obj.numTargets) !== obj.numTargets)
        problems.push(label + ": numTargets must be a whole number of 1 or more (got " + JSON.stringify(obj.numTargets) + ")");
      if (!(obj.target || []).some(function (t) { return countableTargets[t]; }))
        problems.push(label + ": numTargets only applies when target includes ally, enemy, object, or point");
    }
    var dur = obj.duration;
    var durOk = dur === "instantaneous" || dur === "indefinite" ||
      (!!dur && typeof dur === "object" && typeof dur.value === "number" && dur.value > 0 && validDurationUnits[dur.unit]);
    if (!durOk)
      problems.push(label + ": duration must be 'instantaneous', 'indefinite', or { value, unit: minutes|hours|days|weeks|rounds } (got " + JSON.stringify(dur) + ")");
    if (obj.aoe) {
      var aoe = obj.aoe;
      if (AOE_SHAPES.indexOf(aoe.shape) < 0)
        problems.push(label + ": aoe.shape must be 'cone', 'arc', 'line', or 'circle' (got " + JSON.stringify(aoe.shape) + ")");
      if (aoe.origin !== "self" && aoe.origin !== "point")
        problems.push(label + ": aoe.origin must be 'self' or 'point' (got " + JSON.stringify(aoe.origin) + ")");
      if (aoe.origin === "point" && typeof obj.range !== "number")
        problems.push(label + ": aoe.origin can only be 'point' when range is a distance in yards");
      if (typeof aoe.size !== "number" || aoe.size <= 0)
        problems.push(label + ": aoe.size must be a positive number of yards");
      if (aoe.shape === "line") {
        if (typeof aoe.width !== "number" || aoe.width <= 0)
          problems.push(label + ": a line aoe needs a positive 'width' in yards");
      } else if (aoe.width != null) {
        problems.push(label + ": only a line aoe may set 'width'");
      }
      // Cone is fixed at 90°; a 180° wedge is its own shape, "arc" — so there
      // is no longer a variable 'arc' field on any shape.
      if (aoe.arc != null)
        problems.push(label + ": aoe.arc is no longer a field; use shape 'arc' for a 180° wedge (cone is fixed at 90°)");
    }
  }

  function validateDB() {
    var problems = [];
    var seen = {};
    var skillNames = {};
    ["combat", "noncombat"].forEach(function (g) {
      (window.SKILLS[g] || []).forEach(function (s) { skillNames[s.name] = true; });
    });
    var charKeys = (CONFIG.CHARACTERISTICS || []).reduce(function (m, c) { m[c.key] = true; return m; }, {});

    // The any* (OR-group) counterparts to anyTalents, for skills/
    // characteristics/proficiencies — each entry carries its own name/key
    // plus threshold, so (unlike the plain talents/anyTalents id lists) they
    // need their own shape check, not just a lookup.
    function checkAnyReqGroups(label, reqs) {
      (reqs.anySkills || []).forEach(function (s) {
        if (!s || typeof s.name !== "string" || !s.name) { problems.push(label + ": anySkills entry needs a 'name'"); return; }
        if (!skillNames[s.name]) problems.push(label + ": unknown skill '" + s.name + "' in anySkills");
        if (typeof s.tier !== "number") problems.push(label + ": anySkills entry '" + s.name + "' needs a numeric 'tier'");
      });
      (reqs.anyCharacteristics || []).forEach(function (c) {
        if (!c || typeof c.key !== "string" || !c.key) { problems.push(label + ": anyCharacteristics entry needs a 'key'"); return; }
        if (!charKeys[c.key]) problems.push(label + ": unknown characteristic '" + c.key + "' in anyCharacteristics");
        if (typeof c.value !== "number") problems.push(label + ": anyCharacteristics entry '" + c.key + "' needs a numeric 'value'");
      });
      (reqs.anyProficiencies || []).forEach(function (p) {
        if (!p || typeof p.name !== "string" || !p.name) { problems.push(label + ": anyProficiencies entry needs a 'name'"); return; }
        if (typeof p.tier !== "number") problems.push(label + ": anyProficiencies entry '" + p.name + "' needs a numeric 'tier'");
      });
    }

    allTalents.forEach(function (t) {
      if (seen[t.id]) problems.push("Duplicate talent id: " + t.id);
      seen[t.id] = true;

      var tree = treeById(t.domain);
      if (!tree) problems.push(t.id + ": talent in unregistered tree '" + t.domain + "'");
      if (tree && (t.col < 0 || t.col >= tree.cols))
        problems.push(t.id + ": col " + t.col + " out of range 0.." + (tree.cols - 1));
      if (t.pool !== "combat" && t.pool !== "noncombat")
        problems.push(t.id + ": pool must be 'combat' or 'noncombat' (got '" + t.pool + "')");
      if (typeof t.tier !== "number" || t.tier < 1 || t.tier > CONFIG.TIERS.length)
        problems.push(t.id + ": tier " + t.tier + " out of range 1.." + CONFIG.TIERS.length);
      if (t.ability === "maneuver") validateCastableFields(problems, t.id, t);

      var reqs = t.requires || {};
      var prereqs = (reqs.talents || []).concat(reqs.anyTalents || []);
      prereqs.forEach(function (pid) {
        // A prerequisite id may point at either a talent or a spell.
        var pre = byId[pid] || spellsById[pid];
        if (!pre) { problems.push(t.id + ": unknown prerequisite '" + pid + "'"); return; }
        var preDomain = pre.domain || spellDomainById[pid];

        // Cross-tree requirements are legal ONLY inside a combination tree,
        // and only when they point at one of that tree's parents.
        if (preDomain !== t.domain) {
          if (!tree || tree.kind !== "combination") {
            problems.push(t.id + ": cross-tree prerequisite '" + pid + "' is only allowed in combination trees");
          } else if ((tree.parents || []).indexOf(preDomain) < 0) {
            problems.push(t.id + ": cross-tree prerequisite '" + pid + "' is not in a parent tree (" +
              (tree.parents || []).join(", ") + ")");
          }
        }
      });
      Object.keys(reqs.skills || {}).forEach(function (n) {
        if (!skillNames[n]) problems.push(t.id + ": unknown skill '" + n + "'");
      });
      Object.keys(reqs.characteristics || {}).forEach(function (k) {
        if (!charKeys[k]) problems.push(t.id + ": unknown characteristic '" + k + "'");
      });
      checkAnyReqGroups(t.id, reqs);
    });

    // Grants (§4.9). Anything that hands out content must hand out something
    // that exists, and a choice the player can never complete is a dead talent.
    //
    // "Offers enough options" is not the same as "can be fulfilled" — an
    // unknown/self-referencing/duplicated option still counted toward the raw
    // total, which let a grant look complete while nothing a character could
    // actually receive backed it (e.g. a `pick 2` with only one real option).
    // `fulfillable` below only counts options that are real, distinct things;
    // `cheapestCost` catches a `budget` nobody could ever afford to spend.
    function checkGrants(label, entry) {
      var g = grantsOf(entry);
      if (!g) return;
      if (["all", "pick", "budget"].indexOf(g.mode) < 0) {
        problems.push(label + ": unknown grants mode '" + g.mode + "' (all, pick or budget)");
        return;
      }
      if (!g.options.length) { problems.push(label + ": grants nothing (empty options)"); return; }
      if (g.mode !== "all" && (typeof g.count !== "number" || g.count < 1))
        problems.push(label + ": grants mode '" + g.mode + "' needs a count of at least 1");

      var seenKeys = {};
      var fulfillable = 0;
      var cheapestCost = null;
      function addFulfillable(cost) {
        fulfillable++;
        if (cheapestCost === null || cost < cheapestCost) cheapestCost = cost;
      }

      // A rank filter (`tier`, or `tierMin`/`tierMax` for "up to") must land
      // inside 1..MAX_SKILL_TIER and the right way round. Returns the
      // (possibly auto-swapped) [lo, hi] range so the caller can still expand
      // it — an authoring mistake here shouldn't also hide the option.
      function checkTierRange(o) {
        if (typeof o.tierMin === "number" && typeof o.tierMax === "number" && o.tierMin > o.tierMax)
          problems.push(label + ": tierMin " + o.tierMin + " is above tierMax " + o.tierMax);
        var range = optionTierRange(o);
        [range[0], range[1]].forEach(function (t) {
          if (t < 1 || t > CONFIG.MAX_SKILL_TIER || Math.floor(t) !== t)
            problems.push(label + ": rank " + t + " is out of range 1.." + CONFIG.MAX_SKILL_TIER);
        });
        return range;
      }

      g.options.forEach(function (o) {
        if (o.anySkill) {
          if (!(window.SKILLS || {})[o.anySkill]) {
            problems.push(label + ": grants anySkill '" + o.anySkill + "' (expected combat or noncombat)");
          } else {
            var skillRange = checkTierRange(o);
            (window.SKILLS[o.anySkill] || []).forEach(function () {
              for (var st = skillRange[0]; st <= skillRange[1]; st++)
                addFulfillable(stepCost(CONFIG.SKILL_COSTS[o.anySkill], 0, st));
            });
          }
          if (g.mode === "all")
            problems.push(label + ": grants mode 'all' cannot use a category option (nothing picks one)");
          return;
        }
        if (o.anyProficiency) {
          var kinds = Array.isArray(o.anyProficiency) ? o.anyProficiency : [o.anyProficiency];
          var profRange = checkTierRange(o);
          kinds.forEach(function (k) {
            var kind = findKind(k);
            if (!kind) { problems.push(label + ": grants anyProficiency of unknown kind '" + k + "'"); return; }
            (kind.suggestions || []).forEach(function () {
              for (var pt = profRange[0]; pt <= profRange[1]; pt++)
                addFulfillable(stepCost(CONFIG.SKILL_COSTS[kind.costKey], 0, pt));
            });
          });
          if (g.mode === "all")
            problems.push(label + ": grants mode 'all' cannot use a category option (nothing picks one)");
          return;
        }

        // A concrete option: real, distinct things only count toward what the
        // grant can actually deliver. Unknown/self/duplicate entries still get
        // their own diagnostic, but must not inflate the fulfillable count.
        if (o.talent) {
          var t = byId[o.talent];
          if (!t) { problems.push(label + ": grants unknown talent '" + o.talent + "'"); return; }
          if (o.talent === entry.id) { problems.push(label + ": grants itself"); return; }
          if (seenKeys[grantOptionKey(o)]) { problems.push(label + ": grants the same option twice ('" + o.talent + "')"); return; }
          seenKeys[grantOptionKey(o)] = true;
          addFulfillable(t.cost || 0);
        } else if (o.spell) {
          var sp = spellsById[o.spell];
          if (!sp) { problems.push(label + ": grants unknown spell '" + o.spell + "'"); return; }
          if (o.spell === entry.id) { problems.push(label + ": grants itself"); return; }
          if (seenKeys[grantOptionKey(o)]) { problems.push(label + ": grants the same option twice ('" + o.spell + "')"); return; }
          seenKeys[grantOptionKey(o)] = true;
          addFulfillable(sp.cost || 0);
        } else if (o.skill) {
          if (!skillNames[o.skill]) { problems.push(label + ": grants unknown skill '" + o.skill + "'"); return; }
          var skillRange2 = checkTierRange(o);
          for (var st2 = skillRange2[0]; st2 <= skillRange2[1]; st2++) {
            var skillKey = grantOptionKey({ skill: o.skill, tier: st2 });
            if (seenKeys[skillKey]) { problems.push(label + ": grants the same option twice ('" + o.skill + "', rank " + st2 + ")"); continue; }
            seenKeys[skillKey] = true;
            addFulfillable(stepCost(CONFIG.SKILL_COSTS[isCombatSkill(o.skill) ? "combat" : "noncombat"], 0, st2));
          }
        } else if (o.proficiency) {
          var pKind = findKind(o.kind);
          if (!pKind) {
            problems.push(label + ": grants proficiency '" + o.proficiency + "' of unknown kind '" + o.kind + "'");
            return;
          }
          var profRange2 = checkTierRange(o);
          for (var pt2 = profRange2[0]; pt2 <= profRange2[1]; pt2++) {
            var profKey = grantOptionKey({ proficiency: o.proficiency, kind: o.kind, tier: pt2 });
            if (seenKeys[profKey]) { problems.push(label + ": grants the same option twice ('" + o.proficiency + "', rank " + pt2 + ")"); continue; }
            seenKeys[profKey] = true;
            addFulfillable(stepCost(CONFIG.SKILL_COSTS[pKind.costKey], 0, pt2));
          }
        } else {
          problems.push(label + ": a grant option names nothing (talent, spell, skill, " +
            "proficiency, anySkill or anyProficiency)");
        }
      });

      if (g.mode === "pick" && g.count > fulfillable)
        problems.push(label + ": grants asks for " + g.count + " picks but offers only " + fulfillable);
      if (g.mode === "budget") {
        if (fulfillable === 0)
          problems.push(label + ": grants a budget but has no option a character could ever actually receive");
        else if (cheapestCost !== null && cheapestCost > g.count)
          problems.push(label + ": grants a budget of " + g.count + " exp but the cheapest option that could " +
            "ever be picked costs " + cheapestCost + " exp — nothing could ever be picked");
      }
    }
    allTalents.forEach(function (t) { checkGrants("talent '" + t.id + "'", t); });
    Object.keys(window.SPELLS || {}).forEach(function (domainId) {
      (window.SPELLS[domainId] || []).forEach(function (sp) { checkGrants("spell '" + sp.id + "'", sp); });
    });

    // A typo'd `ability` would otherwise fall through to passive-like
    // behaviour everywhere and never be noticed.
    allTalents.forEach(function (t) {
      if (t.ability !== undefined && ["passive", "maneuver", "modifier"].indexOf(t.ability) < 0)
        problems.push(t.id + ": unknown ability '" + t.ability + "' (passive, maneuver or modifier)");
    });

    // Modifiers (§4.8). The `modifies` block is both the field-change spec and
    // the declared target link, so it carries most of the rules.
    allTalents.forEach(function (t) {
      var tree = treeById(t.domain);
      if (t.modifies && !isModifier(t)) {
        problems.push(t.id + ": has a `modifies` block but is not ability: \"modifier\"");
        return;
      }
      if (!isModifier(t)) return;

      ["uses", "usesPer", "castingTime", "range", "target", "duration", "aoe"].forEach(function (f) {
        if (t[f] !== undefined)
          problems.push(t.id + ": a modifier grants nothing itself, so it must not carry '" + f + "'");
      });

      var targets = Object.keys(t.modifies || {});
      if (!targets.length) {
        problems.push(t.id + ": a modifier must name at least one target in `modifies`");
        return;
      }
      targets.forEach(function (targetId) {
        var target = byId[targetId] || spellsById[targetId];
        if (!target) {
          problems.push(t.id + ": modifies unknown talent/spell '" + targetId + "'");
          return;
        }
        if (targetId === t.id) { problems.push(t.id + ": modifies itself"); return; }
        if (isModifier(target)) {
          problems.push(t.id + ": modifies '" + targetId + "', which is itself a modifier " +
            "(modifiers apply to passives, maneuvers and spells only)");
          return;
        }
        // Same cross-tree rule prerequisites follow: only a combination tree
        // may reach outside itself, and only into its own two parents.
        var targetDomain = target.domain || spellDomainById[targetId];
        if (targetDomain !== t.domain) {
          if (!tree || tree.kind !== "combination")
            problems.push(t.id + ": modifies '" + targetId + "' in another tree, which is only allowed in combination trees");
          else if ((tree.parents || []).indexOf(targetDomain) < 0)
            problems.push(t.id + ": modifies '" + targetId + "', not in a parent tree (" +
              (tree.parents || []).join(", ") + ")");
        }

        var spec = t.modifies[targetId] || {};
        Object.keys(spec).forEach(function (field) {
          if (!MODIFIABLE_FIELDS[field]) {
            problems.push(t.id + ": field '" + field + "' is not modifiable (allowed: " +
              Object.keys(MODIFIABLE_FIELDS).join(", ") + ")");
            return;
          }
          var ops = spec[field];
          if (!ops || typeof ops !== "object" || Array.isArray(ops)) {
            problems.push(t.id + ": '" + field + "' must be an op object, e.g. { add: 1 }");
            return;
          }
          var opNames = Object.keys(ops);
          if (!opNames.length)
            problems.push(t.id + ": '" + field + "' names no operation (" + Object.keys(MODIFIER_OPS).join(", ") + ")");
          opNames.forEach(function (op) {
            if (!MODIFIER_OPS[op]) {
              problems.push(t.id + ": unknown operation '" + op + "' on '" + field + "'");
            } else if (op !== "set" && typeof ops[op] !== "number") {
              problems.push(t.id + ": '" + op + "' on '" + field + "' needs a number");
            } else if (field === "aoe.shape" && op !== "set") {
              problems.push(t.id + ": 'aoe.shape' may only be changed with 'set'");
            } else if (field === "aoe.shape" && AOE_SHAPES.indexOf(ops[op]) < 0) {
              problems.push(t.id + ": 'aoe.shape' set to an unknown shape '" + ops[op] +
                "' (must be " + AOE_SHAPES.join(", ") + ")");
            }
          });
        });
      });
    });

    // The next three checks are about the GRID, so they run over entries —
    // talents and spells together — rather than talents alone. A magical
    // domain's spells share its tree's row/col space (§4.6), so two entries can
    // now collide, a spell can break a row's single tier, and a prerequisite
    // line can run the wrong way between kinds.
    var gridEntries = [];
    trees.forEach(function (tree) {
      treeEntries(tree.id).forEach(function (e) { gridEntries.push({ tree: tree, entry: e }); });
    });

    // One entry per cell: two nodes at the same row/col would draw on top of
    // each other, and only one of them could ever be clicked.
    var cellTaken = {};
    gridEntries.forEach(function (g) {
      var key = g.tree.id + ":" + g.entry.row + ":" + g.entry.col;
      if (cellTaken[key])
        problems.push(g.tree.id + " row " + g.entry.row + " col " + g.entry.col +
          ": '" + cellTaken[key] + "' and '" + g.entry.id + "' occupy the same cell");
      else cellTaken[key] = g.entry.id;
    });

    // Each row of a tree holds a single tier — the horizontal dividers are
    // derived from where the tier changes between rows, so a mixed row makes
    // them lie. A spell's tier gates on the Spellcasting proficiency rather
    // than tier of play, but it still shares the band, which is exactly what
    // lets one divider label both gates.
    var rowTier = {};
    gridEntries.forEach(function (g) {
      var key = g.tree.id + ":" + g.entry.row;
      if (rowTier[key] === undefined) rowTier[key] = g.entry.tier;
      else if (rowTier[key] !== g.entry.tier)
        problems.push(g.tree.id + " row " + g.entry.row + " mixes tier " + rowTier[key] + " and tier " + g.entry.tier);
    });

    // Same-tree prerequisites must sit on the same row or a lower one (trees
    // grow upward) — never in a higher row, which would put them in a later
    // tier. A prerequisite may be a talent or a spell, and so may the thing it
    // unlocks, so both ends are resolved through the entry index.
    gridEntries.forEach(function (g) {
      var reqs = g.entry.requires || {};
      (reqs.talents || []).concat(reqs.anyTalents || []).forEach(function (pid) {
        var pre = entryById(pid);
        if (pre && entryTreeId(pre) === g.tree.id && pre.row > g.entry.row)
          problems.push(g.entry.id + ": prerequisite '" + pid + "' is above it (row " + pre.row + " > " + g.entry.row + ")");
      });
    });

    // A talent tier is gated on exp spent in its own tree, so a tree must
    // actually contain enough cheaper talents to fund reaching that tier —
    // otherwise those talents can never be taken by anyone. Ancestral trees are
    // exempt from the in-tree exp gate, so this check does not apply to them.
    trees.forEach(function (tree) {
      if (tree.kind === "ancestry") return;
      var talents = talentsForDomain(tree.id);
      if (!talents.length) return;
      [2, 3, 4].forEach(function (n) {
        var need = CONFIG.TALENT_TIER_TREE_EXP[n - 1] || 0;
        if (!need) return;
        if (!talents.some(function (t) { return t.tier === n; })) return;
        var fundable = talents
          .filter(function (t) { return t.tier < n; })
          .reduce(function (a, t) { return a + (t.cost || 0); }, 0);
        if (fundable < need) {
          problems.push(tree.id + ": tier " + n + " talents are unreachable — they need " + need +
            " exp spent in this tree, but only " + fundable + " exp of lower-tier talents exist here");
        }
      });
    });

    // A tree's width has no upper bound — a wide tree scrolls sideways rather
    // than squeezing its nodes — but it still has to be a whole number of
    // columns, or every `col` in it is checked against nonsense.
    trees.forEach(function (tree) {
      if (typeof tree.cols !== "number" || !isFinite(tree.cols) || tree.cols < 1 || Math.floor(tree.cols) !== tree.cols)
        problems.push(tree.id + ": cols must be a whole number of at least 1 (got " + JSON.stringify(tree.cols) + ")");
    });

    // Combination trees need exactly two registered parents.
    treesOfKind("combination").forEach(function (tree) {
      (tree.parents || []).forEach(function (p) {
        if (!treeById(p)) problems.push(tree.id + ": unknown parent tree '" + p + "'");
      });
      if ((tree.parents || []).length !== 2)
        problems.push(tree.id + ": combination trees need exactly 2 parents (has " + (tree.parents || []).length + ")");
    });

    // Each ancestry a player can PICK needs at least `ancestralTalentPicks` base
    // talents to choose from at creation — counting its own tree AND any ancestor
    // trees. Grouping-only (unpickable) ancestries are skipped: you never pick
    // them, and their talents count towards their children's chains instead.
    var picks = (window.CREATION || {}).ancestralTalentPicks || 1;
    var ancIds = (window.ANCESTRIES || []).reduce(function (m, a) { m[a.id] = true; return m; }, {});
    (window.ANCESTRIES || []).forEach(function (a) {
      if (ancestryPickable(a)) {
        var base = creationPicksForChain(a.id);
        if (base.length < picks)
          problems.push("ancestry '" + a.id + "': only " + base.length + " base talent(s) to pick from " +
            "(own tree + ancestors), needs " + picks);
      }
      // Parent must exist, form no cycle, and stay within 3 levels (sub-sub max).
      if (a.parent) {
        if (!ancIds[a.parent]) problems.push("ancestry '" + a.id + "': unknown parent ancestry '" + a.parent + "'");
        else {
          var chain = ancestryChain(a.id);
          if (chain.indexOf(a.id) !== chain.lastIndexOf(a.id))
            problems.push("ancestry '" + a.id + "': parent chain contains a cycle");
          if (chain.length > 3)
            problems.push("ancestry '" + a.id + "': nested " + chain.length + " deep (max 3: ancestry → sub → sub-sub)");
        }
      }
    });
    if ((window.ANCESTRIES || []).length && !(window.ANCESTRIES || []).some(ancestryPickable))
      problems.push("no ancestry is selectable at character creation (every one is hidden)");

    // Sources of power and ancestries must never hand out skills or proficiencies,
    // and ancestries never grant talents. A source MAY define one unique talent
    // per tier of play (feature): validate those instead of forbidding them.
    (window.SOURCES || []).forEach(function (src) {
      var g = src.grants || {};
      if (Object.keys(g.skills || {}).length)
        problems.push("source '" + src.id + "': sources of power must not grant skills");
      if ((g.proficiencies || []).length)
        problems.push("source '" + src.id + "': sources of power must not grant proficiencies");
      var byTier = {};
      (src.talents || []).forEach(function (st) {
        var tier = st.tier;
        if (typeof tier !== "number" || tier < 1 || tier > CONFIG.TIERS.length)
          problems.push("source '" + src.id + "': talent tier " + tier + " out of range 1.." + CONFIG.TIERS.length);
        else if (byTier[tier])
          problems.push("source '" + src.id + "': more than one talent at tier " + tier + " (one per tier of play)");
        byTier[tier] = true;
        if (!st.name || !String(st.name).trim())
          problems.push("source '" + src.id + "': a tier-" + tier + " talent is missing a name");
        if (st.ability === "maneuver")
          validateCastableFields(problems, "source '" + src.id + "' tier-" + tier + " talent", st);
      });
    });
    (window.ANCESTRIES || []).forEach(function (a) {
      var g = a.grants || {};
      if ((g.talents || []).length || Object.keys(g.skills || {}).length || (g.proficiencies || []).length)
        problems.push("ancestry '" + a.id + "': ancestries must not grant skills or talents " +
          "(the player picks an ancestral talent at creation instead)");
    });

    // Spells must live on an existing magical domain, carry a tier in range, a
    // name, and a unique id that doesn't collide with a talent.
    var maxSpellTier = CONFIG.MAX_SPELL_TIER || 5;
    var seenSpell = {};
    Object.keys(window.SPELLS || {}).forEach(function (domainId) {
      var tree = treeById(domainId);
      if (!tree) problems.push("spells: domain '" + domainId + "' does not exist");
      else if (tree.kind !== "core" || !tree.magical)
        problems.push("spells: domain '" + domainId + "' is not a magical domain (set magical: true)");
      (window.SPELLS[domainId] || []).forEach(function (sp) {
        if (seenSpell[sp.id]) problems.push("duplicate spell id: " + sp.id);
        seenSpell[sp.id] = true;
        if (byId[sp.id]) problems.push("spell '" + sp.id + "' collides with a talent id");
        if (!sp.name || !String(sp.name).trim()) problems.push("spell '" + sp.id + "': missing name");
        if (typeof sp.tier !== "number" || sp.tier < 1 || sp.tier > maxSpellTier)
          problems.push("spell '" + sp.id + "': tier " + sp.tier + " out of range 1.." + maxSpellTier);
        if (sp.pool !== "combat" && sp.pool !== "noncombat")
          problems.push("spell '" + sp.id + "': pool must be 'combat' or 'noncombat' (got '" + sp.pool + "')");
        if (typeof sp.cost !== "number" || sp.cost < 0)
          problems.push("spell '" + sp.id + "': cost must be a non-negative number");
        validateCastableFields(problems, "spell '" + sp.id + "'", sp);

        // Spells are placed in their domain's TALENT grid, sharing the row/col
        // space with its talents (§4.6) — the collision, single-tier-per-row
        // and prerequisite-direction checks over `gridEntries` above cover both
        // kinds together; this is just the per-spell range check.
        if (tree) {
          if (typeof sp.col !== "number" || sp.col < 0 || sp.col >= tree.cols)
            problems.push("spell '" + sp.id + "': col " + sp.col + " out of range 0.." + (tree.cols - 1));
          if (typeof sp.row !== "number" || sp.row < 0)
            problems.push("spell '" + sp.id + "': row must be a number ≥ 0 (got " + JSON.stringify(sp.row) + ")");
        }

        // Spells may carry the same optional requirement kinds a talent can
        // (in addition to the automatic "holds the matching Spellcasting
        // proficiency tier" gate, which the engine enforces itself and isn't
        // authored data).
        var sreqs = sp.requires || {};
        (sreqs.talents || []).concat(sreqs.anyTalents || []).forEach(function (pid) {
          if (!byId[pid] && !spellsById[pid])
            problems.push("spell '" + sp.id + "': unknown prerequisite '" + pid + "'");
        });
        Object.keys(sreqs.skills || {}).forEach(function (n) {
          if (!skillNames[n]) problems.push("spell '" + sp.id + "': unknown skill '" + n + "'");
        });
        Object.keys(sreqs.characteristics || {}).forEach(function (k) {
          if (!charKeys[k]) problems.push("spell '" + sp.id + "': unknown characteristic '" + k + "'");
        });
        checkAnyReqGroups("spell '" + sp.id + "'", sreqs);
      });
    });

    // Text hooks (§4.7). A hook that doesn't parse, or that names an id no
    // talent/spell has, renders as dead text a player would never see resolve
    // — both are typos, not content gaps, so they're reported structurally.
    function checkHookGroups(label, fieldName, groups) {
      groups.forEach(function (group) {
        group.forEach(function (clause) {
          clause.ids.forEach(function (id) {
            if (!byId[id] && !spellsById[id])
              problems.push(label + ": text hook in " + fieldName +
                " names unknown talent/spell '" + id + "'");
          });
          clause.segments.forEach(function (seg) {
            if (seg.type === "hook") checkHookGroups(label, fieldName, seg.node.groups);
          });
        });
      });
    }
    function checkHooks(label, obj) {
      ["description", "flavour"].forEach(function (fieldName) {
        scanHooks(obj[fieldName]).forEach(function (h) {
          if (!h.groups) {
            problems.push(label + ": malformed text hook {" + h.body + "} in " + fieldName +
              " (expected {id:\"text\"}, ids optionally combined with &, groups joined with | or >)");
            return;
          }
          checkHookGroups(label, fieldName, h.groups);
        });
      });
    }
    allTalents.forEach(function (t) { checkHooks("talent '" + t.id + "'", t); });
    Object.keys(window.SPELLS || {}).forEach(function (domainId) {
      (window.SPELLS[domainId] || []).forEach(function (sp) { checkHooks("spell '" + sp.id + "'", sp); });
    });

    // Talent groups (§6b). A group is drawn as one box with one arrow into it,
    // so the claim it makes — these talents sit together and share this
    // requirement — has to actually hold, or the single arrow would be lying
    // about what the members need.
    var groupOwner = {};
    trees.forEach(function (tree) {
      var seenGroup = {};
      (tree.groups || []).forEach(function (g) {
        var label = "group '" + (g.id || "(unnamed)") + "' in " + tree.id;
        if (!g.id) problems.push(tree.id + ": a talent group has no id");
        else if (seenGroup[g.id]) problems.push(tree.id + ": duplicate talent group id '" + g.id + "'");
        seenGroup[g.id] = true;
        if (!g.name || !String(g.name).trim()) problems.push(label + ": missing name");

        var members = g.members || [];
        if (members.length < 2) {
          problems.push(label + ": needs at least 2 members (has " + members.length + ")");
          return;
        }
        var cells = [], ok = true, seenMember = {};
        members.forEach(function (id) {
          var t = entryById(id);
          if (!t) { problems.push(label + ": unknown member '" + id + "'"); ok = false; return; }
          if (entryTreeId(t) !== tree.id) {
            problems.push(label + ": member '" + id + "' is in tree '" + entryTreeId(t) + "'");
            ok = false; return;
          }
          if (seenMember[id]) { problems.push(label + ": lists '" + id + "' twice"); ok = false; return; }
          seenMember[id] = true;
          if (groupOwner[id]) {
            problems.push(label + ": '" + id + "' is already in group '" + groupOwner[id] + "'");
            ok = false; return;
          }
          groupOwner[id] = g.id;
          cells.push({ id: id, row: t.row, col: t.col });
          // Every member must actually carry what the group says they share.
          if (g.requires && !requirementsCover(t.requires, g.requires)) {
            problems.push(label + ": member '" + id + "' does not carry the group's shared requirement");
          }
        });
        if (!ok || !cells.length) return;

        // Members must form one orthogonally connected block, or a box drawn
        // round them would swallow talents that are not in the group.
        var key = function (c) { return c.row + "," + c.col; };
        var inGroup = {};
        cells.forEach(function (c) { inGroup[key(c)] = true; });
        var seenCell = {}, stack = [cells[0]];
        seenCell[key(cells[0])] = true;
        while (stack.length) {
          var c = stack.pop();
          [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
            var n = { row: c.row + d[0], col: c.col + d[1] };
            if (inGroup[key(n)] && !seenCell[key(n)]) { seenCell[key(n)] = true; stack.push(n); }
          });
        }
        if (Object.keys(seenCell).length !== cells.length) {
          problems.push(label + ": members are not adjacent — a group has to be one connected block");
        }
        // Nothing outside the group may sit inside its bounding box.
        var rows = cells.map(function (c) { return c.row; });
        var cols = cells.map(function (c) { return c.col; });
        var r0 = Math.min.apply(null, rows), r1 = Math.max.apply(null, rows);
        var c0 = Math.min.apply(null, cols), c1 = Math.max.apply(null, cols);
        // Spells share the grid, so the box can swallow one of those too.
        treeEntries(tree.id).forEach(function (t) {
          if (inGroup[t.row + "," + t.col]) return;
          if (t.row >= r0 && t.row <= r1 && t.col >= c0 && t.col <= c1) {
            problems.push(label + ": '" + t.id + "' sits inside the group's box but is not a member");
          }
        });
      });
    });

    // Manual link anchors (§6b). An anchor that names a line the tree does not
    // draw is not a content gap but a typo, and a silent one: nothing appears,
    // and the author has no way to tell a mis-typed id from a route that just
    // ignored them.
    trees.forEach(function (tree) {
      var seenPair = {};
      var groupIds = {};
      (tree.groups || []).forEach(function (g) { if (g.id) groupIds[g.id] = g; });

      (tree.anchors || []).forEach(function (a) {
        var pair = (a.from || "?") + " → " + (a.to || "?");
        var label = "anchor " + pair + " in " + tree.id;
        if (seenPair[pair]) problems.push(tree.id + ": two anchors for the same line, " + pair);
        seenPair[pair] = true;

        // Either end may be a spell now that spells are nodes in the tree.
        var pre = entryById(a.from);
        if (!pre || entryTreeId(pre) !== tree.id) {
          problems.push(label + ": '" + a.from + "' is not a talent or spell in this tree");
        }
        // The far end is whatever the arrow points at: an entry, or the box
        // round a group when the shared requirement is drawn once into it.
        var grp = groupIds[a.to], child = entryById(a.to);
        if (!grp && (!child || entryTreeId(child) !== tree.id)) {
          problems.push(label + ": '" + a.to + "' is not a talent, spell or group in this tree");
        } else if (pre) {
          var reqs = (grp ? grp.requires : child.requires) || {};
          var named = (reqs.talents || []).concat(reqs.anyTalents || []);
          if (named.indexOf(a.from) < 0) {
            problems.push(label + ": '" + a.to + "' does not require '" + a.from + "', so there is no line to anchor");
          }
        }

        var via = a.via || [];
        if (!via.length) problems.push(label + ": has no waypoints");
        via.forEach(function (w, i) {
          if (!w || typeof w.col !== "number" || typeof w.row !== "number")
            problems.push(label + ": waypoint " + (i + 1) + " needs a numeric col and row");
          else if (w.col < -1 || w.col > (tree.cols || 0) + 1)
            problems.push(label + ": waypoint " + (i + 1) + " sits at column " + w.col +
              ", outside a tree " + (tree.cols || 0) + " columns wide");
        });
      });
    });

    // Crossing prerequisite lines are a layout mistake, not a content gap —
    // the tree/spell grid renderer draws a straight-ish line between a
    // prerequisite and what it unlocks, so two links that cross read as
    // tangled on-screen and are almost always fixed by swapping columns.
    // Approximated with straight segments between each link's (col, row)
    // endpoints, same as the renderer's own anchor points.
    function segmentsCross(p1, p2, p3, p4) {
      function orient(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
      function onSeg(a, b, c) {
        return Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x) &&
               Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y);
      }
      var o1 = orient(p1, p2, p3), o2 = orient(p1, p2, p4);
      var o3 = orient(p3, p4, p1), o4 = orient(p3, p4, p2);
      if (o1 === 0 && onSeg(p1, p2, p3)) return true;
      if (o2 === 0 && onSeg(p1, p2, p4)) return true;
      if (o3 === 0 && onSeg(p3, p4, p1)) return true;
      if (o4 === 0 && onSeg(p3, p4, p2)) return true;
      return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
    }
    function checkCrossings(label, links) {
      for (var i = 0; i < links.length; i++) {
        for (var j = i + 1; j < links.length; j++) {
          var a = links[i], b = links[j];
          // Two links sharing an endpoint meet there, which is normal — not a crossing.
          if (a.fromId === b.fromId || a.fromId === b.toId ||
              a.toId === b.fromId || a.toId === b.toId) continue;
          if (segmentsCross(a.from, a.to, b.from, b.to))
            problems.push(label + ": prerequisite line '" + a.fromId + "' → '" + a.toId +
              "' crosses '" + b.fromId + "' → '" + b.toId + "' — rearrange columns to avoid the overlap");
        }
      }
    }

    // One set of links per TREE, talents and spells together: they share a grid,
    // so a talent's arrow and a spell's arrow can cross each other and the pair
    // is only visible when both kinds are measured in the same coordinates.
    var treeLinks = {};
    gridEntries.forEach(function (g) {
      var reqs = g.entry.requires || {};
      (reqs.talents || []).concat(reqs.anyTalents || []).forEach(function (pid) {
        var pre = entryById(pid);
        if (!pre || entryTreeId(pre) !== g.tree.id) return;   // only same-tree links are ever drawn
        (treeLinks[g.tree.id] = treeLinks[g.tree.id] || []).push({
          fromId: pre.id, toId: g.entry.id,
          from: { x: pre.col, y: pre.row }, to: { x: g.entry.col, y: g.entry.row }
        });
      });
    });
    Object.keys(treeLinks).forEach(function (treeId) {
      checkCrossings("tree '" + treeId + "'", treeLinks[treeId]);
    });

    return problems;
  }

  // Talents offered as the free ancestral pick at creation: the base row of the
  // ancestry's tree (tier 1, no talent prerequisites).
  function creationPicksFor(ancestryId) {
    var a = (window.ANCESTRIES || []).filter(function (x) { return x.id === ancestryId; })[0];
    if (!a) return [];
    return (a.talents || []).filter(function (t) {
      var r = t.requires || {};
      return t.tier === 1 && !(r.talents || []).length && !(r.anyTalents || []).length;
    });
  }
  // With sub-ancestries, the free pick may come from the chosen ancestry OR any
  // of its ancestors (a child has access to all of the parent tree's talents).
  function creationPicksForChain(ancestryId) {
    var out = [];
    ancestryChain(ancestryId).forEach(function (aid) {
      creationPicksFor(aid).forEach(function (t) { out.push(t); });
    });
    return out;
  }
  function ancestryById(id) {
    return (window.ANCESTRIES || []).filter(function (a) { return a.id === id; })[0];
  }
  // Can a player choose this ancestry at creation? Grouping-only ancestries
  // (e.g. a parent "Elf" that exists only to hold sub-ancestries) set
  // `pickable: false`; everything else is pickable by default.
  function ancestryPickable(a) {
    if (typeof a === "string") a = ancestryById(a);
    return !!a && a.pickable !== false;
  }
  function sourceById(id) {
    return (window.SOURCES || []).filter(function (s) { return s.id === id; })[0];
  }

  // ---- Source-of-power talents -------------------------------------------
  // A source of power may grant a single unique talent per tier of play. Each is
  // gained free (no exp) the moment the character reaches that tier. They are
  // not tree talents; they live on the source and are surfaced on the sheet.
  function sourceTalentId(sourceId, tier) { return "src_" + sourceId + "_t" + tier; }
  function sourceTalents(state) {
    var src = sourceById(state.creation && state.creation.source);
    if (!src || !src.talents) return [];
    var cur = currentTierIndex(state) + 1;
    return src.talents.slice()
      .sort(function (a, b) { return (a.tier || 1) - (b.tier || 1); })
      .map(function (t) {
        return {
          id: t.id || sourceTalentId(src.id, t.tier || 1),
          tier: t.tier || 1, name: t.name, icon: t.icon || "",
          description: t.description || "", flavour: t.flavour || "",
          ability: t.ability || "passive", uses: t.uses, usesPer: t.usesPer,
          castingTime: t.castingTime, range: t.range, target: t.target, numTargets: t.numTargets,
          duration: t.duration, aoe: t.aoe,
          sourceName: src.name,
          unlocked: cur >= (t.tier || 1),
        };
      });
  }

  // All talents a character currently has: owned tree talents plus any source-
  // of-power talents unlocked by tier of play. Normalized to one shape so the
  // sheet can group both by `ability` (Abilities vs Maneuvers) without caring
  // which kind a given entry is.
  // Modifiers are included here — this is "everything the character owns", not
  // "everything the sheet shows". The sheet drops them (Engine.isModifier),
  // because a modifier's effect is already visible inside the entry it
  // modifies; showing both would make the player merge the two by hand.
  function ownedTalents(state) {
    var tree = (state.talents || []).map(talentById).filter(Boolean)
      .map(function (t) { return effective(t, state); });
    var src = sourceTalents(state).filter(function (t) { return t.unlocked; })
      .map(function (t) {
        return {
          id: t.id, name: t.name, icon: t.icon, description: t.description, flavour: t.flavour,
          tier: t.tier, ability: t.ability, uses: t.uses, usesPer: t.usesPer,
          castingTime: t.castingTime, range: t.range, target: t.target, numTargets: t.numTargets,
          duration: t.duration, aoe: t.aoe,
          fromSource: true, sourceName: t.sourceName,
        };
      });
    return tree.concat(src);
  }

  // ---- Spellcasting -------------------------------------------------------
  // Magical domains (core trees flagged `magical`) grant access to a
  // "Spellcasting" proficiency (kind "spellcasting", named after the domain)
  // that adds +1 per tier to spell test rolls, plus a per-domain Spells tab
  // (§4.6 of DESIGN.md) where spells are placed and learned like talents. A
  // spell's tier gates it on holding a matching-or-higher proficiency tier —
  // enforced by spellRequirementStatus, not stored as authored data.
  function isMagicalDomain(treeId) {
    var t = treeById(treeId);
    return !!(t && t.kind === "core" && t.magical);
  }
  function magicalDomains() {
    return trees.filter(function (t) { return t.kind === "core" && t.magical; });
  }
  // The ladder level is the character's Spellcasting proficiency tier for this
  // domain (a proficiency named after the domain, kind "spellcasting") — it
  // naturally caps via the ordinary skillCap formula, same as any proficiency.
  function spellcastingLevel(state, domainId) {
    var domain = treeById(domainId);
    return domain ? profTier(state, domain.name) : 0;
  }
  // The characteristic a caster adds to spell rolls comes from the source of
  // power (may be unset until the designer assigns one).
  function casterCharacteristic(state) {
    var src = sourceById(state.creation && state.creation.source);
    return (src && src.characteristic) ? src.characteristic : null;
  }
  // Spell test die pool for a domain: source characteristic + ladder level.
  function spellPool(state, domainId) {
    var key = casterCharacteristic(state);
    var charVal = key ? ((state.characteristics || {})[key] || 0) : 0;
    var ladder = spellcastingLevel(state, domainId);
    return { charKey: key, charVal: charVal, ladder: ladder, total: charVal + ladder };
  }
  function spellOwned(state, id) { return (state.spells || []).indexOf(id) >= 0; }

  // A prerequisite id on a spell may point at either a talent or another
  // spell — spells are learnable like talents, so they can chain off each
  // other (e.g. "Ember II" requiring "Ember").
  function resolveReqTarget(id) { return byId[id] || spellsById[id]; }
  function isOwnedReqId(state, id) {
    return (state.talents || []).indexOf(id) >= 0 || (state.spells || []).indexOf(id) >= 0;
  }

  // ---- Text hooks ---------------------------------------------------------
  // A description (or flavour) may carry inline hooks that resolve against
  // what the character actually owns, so a *modifier* talent can rewrite the
  // text of the ability it modifies rather than adding a second entry the
  // player has to mentally merge (see DESIGN.md §4.7). One grammar, four
  // shapes it covers:
  //
  //   {id:"text"}                       insertion — appears once `id` is owned
  //   {new:"replacement">old:"text"}    supersession — the first owned GROUP wins
  //   {a:"fire"|b:"ice"|c:"lightning"}  alternatives — every owned clause, listed
  //   {a&b:"text"}                      conjunction — needs BOTH a and b owned
  //
  // `|` joins clauses within a group, `>` starts the next fallback group, `&`
  // joins ids within one clause (all of them required). A group wins as soon
  // as any clause in it is owned, so all three compose (`{a:"x"|b&c:"y">d:"z"}`).
  // A clause's own text may nest further hooks — e.g.
  // `{a:"...{b:"c"}..."}` — which resolve the same way, recursively, against
  // the same owned set; a brace that doesn't parse as a hook there just falls
  // back to being literal text, same as at the top level. Nothing owned
  // anywhere → the hook renders empty.
  //
  // Ownership is talents + spells (isOwnedReqId). Source-of-power talents are
  // deliberately not hook-referenceable: resolving their tier gate needs
  // computeSpent, which would put an exp recount inside every text render.
  var HOOK_ID_RE = /^[A-Za-z0-9_]+$/;
  var HOOK_IDLIST_CHAR_RE = /[A-Za-z0-9_&]/;
  // A brace that opened like a hook. Used to tell "the author meant a hook and
  // fumbled it" (report it) from "this is prose containing a brace" (leave it).
  var HOOK_START_RE = /^\{\s*[A-Za-z0-9_]+(\s*&\s*[A-Za-z0-9_]+)*\s*:\s*"/;

  // Parses one hook starting at text[at] (which must be '{'). Returns
  // {node: {groups}, end} — `end` is the index just past the hook's closing
  // '}' — or null if this brace doesn't open a well-formed hook, in which
  // case the caller falls back to treating '{' as a literal character. Each
  // clause's `ids` is the `&`-split list a single owner-check must all pass;
  // its `segments` alternate literal text and nested hook nodes, so resolving
  // a clause means walking its segments rather than reading a plain string.
  function parseHookAt(text, at) {
    var i = at + 1, len = text.length;
    function skipWs() { while (i < len && /\s/.test(text.charAt(i))) i++; }
    var groups = [[]];
    while (true) {
      skipWs();
      var idStart = i;
      while (i < len && HOOK_IDLIST_CHAR_RE.test(text.charAt(i))) i++;
      if (i === idStart) return null;
      var ids = text.slice(idStart, i).split("&");
      if (ids.some(function (id) { return !HOOK_ID_RE.test(id); })) return null;
      skipWs();
      if (text.charAt(i) !== ":") return null;
      i++;
      skipWs();
      if (text.charAt(i) !== '"') return null;
      i++;
      var segments = [], lit = "", closed = false;
      while (i < len) {
        var ch = text.charAt(i);
        if (ch === "\\" && i + 1 < len) { lit += text.charAt(i + 1); i += 2; continue; }
        if (ch === '"') { i++; closed = true; break; }
        if (ch === "{") {
          var nested = parseHookAt(text, i);
          if (nested) {
            if (lit) { segments.push({ type: "lit", value: lit }); lit = ""; }
            segments.push({ type: "hook", node: nested.node });
            i = nested.end;
            continue;
          }
          // Doesn't parse as a hook here either — keep it as literal prose,
          // same rule as the top level.
        }
        lit += ch; i++;
      }
      if (!closed) return null;              // unterminated clause text
      if (lit) segments.push({ type: "lit", value: lit });
      groups[groups.length - 1].push({ ids: ids, segments: segments });
      skipWs();
      var sep = text.charAt(i);
      if (sep === "|") { i++; continue; }
      if (sep === ">") { groups.push([]); i++; continue; }
      if (sep === "}") { i++; return { node: { groups: groups }, end: i }; }
      return null;
    }
  }

  // "fire" · "fire or ice" · "fire, ice, or lightning"
  function joinAlternatives(parts) {
    if (parts.length <= 1) return parts[0] || "";
    if (parts.length === 2) return parts[0] + " or " + parts[1];
    return parts.slice(0, -1).join(", ") + ", or " + parts[parts.length - 1];
  }

  function resolveSegments(segments, state) {
    return segments.map(function (seg) {
      return seg.type === "lit" ? seg.value : resolveHookNode(seg.node, state);
    }).join("");
  }

  function resolveHookNode(node, state) {
    var groups = node.groups;
    for (var g = 0; g < groups.length; g++) {
      var hits = [];
      for (var c = 0; c < groups[g].length; c++) {
        var clause = groups[g][c];
        // Conjunction: every id in the clause has to be owned, not just one.
        if (clause.ids.every(function (id) { return isOwnedReqId(state, id); }))
          hits.push(resolveSegments(clause.segments, state));
      }
      // A group wins on ownership, not on having produced text — a clause
      // resolving to "" is how the un-modified base case is authored.
      if (hits.length) return joinAlternatives(hits);
    }
    return "";
  }

  // Cleans up the seams an empty hook leaves behind (". {…}" collapsing to
  // ". " then " ."). Only ever runs on text that actually contained a hook.
  function tidyResolved(s) {
    return s.replace(/[ \t]{2,}/g, " ")
            .replace(/[ \t]+([,.;:!?])/g, "$1")
            .replace(/[ \t]+$/gm, "");
  }

  // Every top-level hook span in `text`, as {open, close, groups}. `groups`
  // is null for a span that opened like a hook but didn't parse — the
  // validator reports those; rendering leaves them verbatim. A hook nested
  // inside another hook's clause text is not reported separately here — it
  // lives inside the outer hook's `groups` tree, and both the validator and
  // the resolver walk into it from there.
  function scanHooks(text) {
    var out = [], i = 0;
    if (typeof text !== "string") return out;
    while (i < text.length) {
      var open = text.indexOf("{", i);
      if (open < 0) break;
      var parsed = parseHookAt(text, open);
      if (parsed) {
        out.push({ open: open, close: parsed.end - 1, groups: parsed.node.groups });
        i = parsed.end;
      } else {
        if (HOOK_START_RE.test(text.slice(open)))
          out.push({ open: open, close: -1, body: text.slice(open + 1).split("\n")[0], groups: null });
        i = open + 1;
      }
    }
    return out;
  }

  function resolveText(text, state) {
    if (typeof text !== "string" || text.indexOf("{") < 0) return text;
    var hooks = scanHooks(text).filter(function (h) { return h.groups; });
    if (!hooks.length) return text;
    var out = "", at = 0;
    hooks.forEach(function (h) {
      out += text.slice(at, h.open) + resolveHookNode({ groups: h.groups }, state || {});
      at = h.close + 1;
    });
    return tidyResolved(out + text.slice(at));
  }

  // ---- Grants -------------------------------------------------------------
  // Any talent or spell may hand out other content: `grants` (§4.9).
  //
  //   { mode: "all" }                       everything in `options`, outright
  //   { mode: "pick",   count: 2, options } N of the options
  //   { mode: "budget", count: 5, options } up to N exp spent among the options
  //
  // An option is either a concrete thing — { talent }, { spell },
  // { skill, tier }, { proficiency, kind, tier } — or a CATEGORY that expands
  // into concrete choices at pick time: { anySkill: "noncombat" },
  // { anyProficiency: ["crafting", "instrument"] }. The category form is what
  // lets "any 2 non-combat skill, instrument, or crafting proficiencies" stay
  // correct when a new skill is added to the database.
  //
  // Everything handed out lands in the granted baseline (§4.5), so it costs
  // nothing — and picking something already paid for refunds it, because the
  // baseline subtraction in computeSpent stops charging for it. That is the
  // whole of the "warn, then refund" rule; there is no separate bookkeeping.
  function grantsOf(entry) {
    var g = entry && entry.grants;
    if (!g || typeof g !== "object") return null;
    var mode = g.mode || "all";
    return {
      mode: mode,
      count: typeof g.count === "number" ? g.count : (mode === "all" ? 0 : 1),
      options: (g.options || []).slice(),
    };
  }
  // Does taking this entry require the player to choose something?
  function grantNeedsChoice(entry) {
    var g = grantsOf(entry);
    return !!g && (g.mode === "pick" || g.mode === "budget") && g.options.length > 0;
  }

  function grantOptionKey(o) {
    if (o.talent) return "talent:" + o.talent;
    if (o.spell) return "spell:" + o.spell;
    var tier = o.tier || 1;
    // The rank only joins the key once it stops being the default — an
    // ordinary rank-1 grant keeps the key it always had, so old save data and
    // in-flight grantChoices records never see a format change.
    if (o.skill) return "skill:" + o.skill + (tier === 1 ? "" : ":" + tier);
    if (o.proficiency) return "proficiency:" + (o.kind || "") + ":" + o.proficiency + (tier === 1 ? "" : ":" + tier);
    return "";
  }

  // A skill/proficiency option's rank filter: an exact `tier` (default 1), or
  // a `tierMin`..`tierMax` range — "up to rank N" is authored as tierMin: 1,
  // tierMax: N — which `grantOptions` expands into one choice per rank, so a
  // `budget` grant can weigh a shallow, cheap pick against a deeper, pricier
  // one for the same skill, and a `pick` grant lets the player choose depth.
  function optionTierRange(o) {
    if (typeof o.tierMin === "number" || typeof o.tierMax === "number") {
      var lo = typeof o.tierMin === "number" ? o.tierMin : o.tierMax;
      var hi = typeof o.tierMax === "number" ? o.tierMax : o.tierMin;
      if (hi < lo) { var t = lo; lo = hi; hi = t; }
      return [lo, hi];
    }
    var exact = typeof o.tier === "number" ? o.tier : 1;
    return [exact, exact];
  }

  // One authored option → a display record, or null if it points at nothing.
  // `owned` drives the duplicate warning; `available` reflects "for which you
  // must qualify" — a granted talent still has to meet its own requirements.
  function describeGrantOption(o, state) {
    var tier = o.tier || 1;
    var rec = { key: grantOptionKey(o), option: o, tier: tier, owned: false, cost: 0,
                label: "", note: "", available: true, blocked: null };
    if (o.talent) {
      var t = byId[o.talent];
      if (!t) return null;
      var st = requirementStatus(t, state);
      rec.kind = "talent"; rec.label = t.name; rec.cost = t.cost || 0;
      rec.note = (treeById(t.domain) || {}).name || t.domain;
      rec.owned = (state.talents || []).indexOf(t.id) >= 0;
      rec.available = st.met;
      if (!st.met) rec.blocked = unmetLabels(st);
    } else if (o.spell) {
      var sp = spellsById[o.spell];
      if (!sp) return null;
      var sst = spellRequirementStatus(sp, state);
      rec.kind = "spell"; rec.label = sp.name; rec.cost = sp.cost || 0;
      rec.note = (treeById(spellDomain(sp.id)) || {}).name || "";
      rec.owned = spellOwned(state, sp.id);
      rec.available = sst.met;
      if (!sst.met) rec.blocked = unmetLabels(sst);
    } else if (o.skill) {
      var cur = (state.skills || {})[o.skill] || 0;
      rec.kind = "skill"; rec.label = o.skill;
      rec.note = "skill" + (tier > 1 ? " · rank " + tier : "");
      rec.owned = cur >= tier;
      rec.cost = stepCost(CONFIG.SKILL_COSTS[isCombatSkill(o.skill) ? "combat" : "noncombat"],
                          Math.min(cur, tier - 1), tier);
    } else if (o.proficiency) {
      var kind = findKind(o.kind);
      if (!kind) return null;
      var pcur = profTier(state, o.proficiency);
      rec.kind = "proficiency"; rec.label = o.proficiency;
      rec.note = kind.label + (tier > 1 ? " · rank " + tier : "");
      rec.owned = pcur >= tier;
      rec.cost = stepCost(CONFIG.SKILL_COSTS[kind.costKey], Math.min(pcur, tier - 1), tier);
    } else return null;
    return rec;
  }

  function unmetLabels(status) {
    return (status.reasons || []).filter(function (r) { return !reasonMet(r); })
      .map(function (r) { return r.label; }).join(", ") || null;
  }

  // Every concrete choice this entry offers, categories AND rank ranges
  // expanded, de-duped. "Up to rank N" is one authored option but several
  // real choices — a rank-1 and a rank-2 version of the same skill are
  // different keys, different costs, and compete separately for a budget.
  function grantOptions(entry, state) {
    var g = grantsOf(entry);
    if (!g) return [];
    // Options are qualified as though the granting entry is already owned.
    // The picker runs on a pre-purchase snapshot (learning pushes the talent
    // to state.talents only after the grant choice is confirmed), so without
    // this exception an option that requires the very talent granting it —
    // e.g. Arsenal's own Material Knowledge choices — could never be checked.
    var qualifyState = state;
    if (entry.id && !isOwnedReqId(state, entry.id)) {
      qualifyState = {};
      for (var sk in state) qualifyState[sk] = state[sk];
      if (byId[entry.id]) qualifyState.talents = (state.talents || []).concat(entry.id);
      else if (spellsById[entry.id]) qualifyState.spells = (state.spells || []).concat(entry.id);
    }
    var out = [], seen = {};
    function push(o) {
      var key = grantOptionKey(o);
      if (!key || seen[key]) return;
      var rec = describeGrantOption(o, qualifyState);
      if (!rec) return;
      seen[key] = true;
      out.push(rec);
    }
    // `base` names a skill or a proficiency (with its kind) plus whatever
    // rank filter the authored option carried; pushes one option per rank.
    function pushRanked(base) {
      var range = optionTierRange(base);
      for (var t = range[0]; t <= range[1]; t++) {
        push({ skill: base.skill, proficiency: base.proficiency, kind: base.kind, tier: t });
      }
    }
    g.options.forEach(function (o) {
      if (o.anySkill) {
        ((window.SKILLS || {})[o.anySkill] || []).forEach(function (s) {
          pushRanked({ skill: s.name, tier: o.tier, tierMin: o.tierMin, tierMax: o.tierMax });
        });
      } else if (o.anyProficiency) {
        var kinds = Array.isArray(o.anyProficiency) ? o.anyProficiency : [o.anyProficiency];
        kinds.forEach(function (kindId) {
          var kind = findKind(kindId);
          if (!kind) return;
          // The kind's suggestions, plus anything of that kind the character
          // already named on the sheet (so a grant can advance it).
          var names = (kind.suggestions || []).slice();
          (state.proficiencies || []).forEach(function (p) {
            if (p.kind === kindId && names.indexOf(p.name) < 0) names.push(p.name);
          });
          names.forEach(function (n) {
            pushRanked({ proficiency: n, kind: kindId, tier: o.tier, tierMin: o.tierMin, tierMax: o.tierMax });
          });
        });
      } else if (o.skill) {
        pushRanked({ skill: o.skill, tier: o.tier, tierMin: o.tierMin, tierMax: o.tierMax });
      } else if (o.proficiency) {
        pushRanked({ proficiency: o.proficiency, kind: o.kind, tier: o.tier, tierMin: o.tierMin, tierMax: o.tierMax });
      } else push(o);
    });
    return out;
  }

  // Is this set of picks a legal answer to the grant?
  function grantSelectionValid(entry, state, keys) {
    var g = grantsOf(entry);
    if (!g) return { ok: false, reason: "nothing is granted" };
    var opts = grantOptions(entry, state);
    var byKey = {};
    opts.forEach(function (o) { byKey[o.key] = o; });
    var chosen = [];
    for (var i = 0; i < keys.length; i++) {
      var o = byKey[keys[i]];
      if (!o) return { ok: false, reason: "unknown choice" };
      if (!o.available) return { ok: false, reason: o.label + " does not qualify yet" };
      chosen.push(o);
    }
    if (g.mode === "pick") {
      if (chosen.length !== g.count)
        return { ok: false, reason: "choose " + g.count, remaining: g.count - chosen.length };
    } else if (g.mode === "budget") {
      var used = chosen.reduce(function (n, o) { return n + o.cost; }, 0);
      if (used > g.count) return { ok: false, reason: "over budget", used: used, budget: g.count };
    }
    return { ok: true };
  }

  function applyOneGrant(state, opt) {
    var g = state.granted = state.granted || {};
    var rec = { key: opt.key, kind: opt.kind };
    if (opt.kind === "talent" || opt.kind === "spell") {
      var isSpell = opt.kind === "spell";
      var listKey = isSpell ? "spells" : "talents";
      var id = isSpell ? opt.option.spell : opt.option.talent;
      g[listKey] = g[listKey] || [];
      state[listKey] = state[listKey] || [];
      rec.id = id;
      rec.wasOwned = state[listKey].indexOf(id) >= 0;
      rec.wasGranted = g[listKey].indexOf(id) >= 0;
      if (!rec.wasOwned) state[listKey].push(id);
      if (!rec.wasGranted) g[listKey].push(id);
    } else if (opt.kind === "skill") {
      var name = opt.option.skill;
      g.skills = g.skills || {};
      state.skills = state.skills || {};
      rec.name = name;
      rec.prevGranted = g.skills[name] || 0;
      rec.prevTier = state.skills[name] || 0;
      g.skills[name] = Math.max(rec.prevGranted, opt.tier);
      state.skills[name] = Math.max(rec.prevTier, opt.tier);
      rec.setTier = state.skills[name];
    } else if (opt.kind === "proficiency") {
      var pname = opt.option.proficiency;
      g.proficiencies = g.proficiencies || {};
      state.proficiencies = state.proficiencies || [];
      var row = state.proficiencies.filter(function (p) { return p.name === pname; })[0];
      rec.name = pname; rec.profKind = opt.option.kind;
      rec.prevGranted = g.proficiencies[pname] || 0;
      rec.prevTier = row ? (row.tier || 0) : 0;
      rec.created = !row;
      g.proficiencies[pname] = Math.max(rec.prevGranted, opt.tier);
      if (!row) { row = { name: pname, kind: opt.option.kind, tier: 0 }; state.proficiencies.push(row); }
      row.tier = Math.max(rec.prevTier, opt.tier);
      rec.setTier = row.tier;
    }
    return rec;
  }

  // Records what was handed out so refunding the granting entry can undo it.
  function applyGrants(state, grantingId, keys) {
    var entry = byId[grantingId] || spellsById[grantingId];
    if (!entry) return;
    var g = grantsOf(entry);
    if (!g) return;
    var opts = grantOptions(entry, state);
    var chosen = g.mode === "all"
      ? opts
      : keys.map(function (k) { return opts.filter(function (o) { return o.key === k; })[0]; }).filter(Boolean);
    var records = chosen.map(function (o) { return applyOneGrant(state, o); });
    state.grantChoices = state.grantChoices || {};
    state.grantChoices[grantingId] = records;
  }

  // The inverse. Talents/spells the grant introduced are removed; ones the
  // character already had stay owned (and go back to being paid for). A free
  // skill/proficiency step is only dropped when nothing was built on top of it.
  function revokeGrants(state, grantingId) {
    var recs = (state.grantChoices || {})[grantingId] || [];
    var g = state.granted || {};
    recs.slice().reverse().forEach(function (rec) {
      if (rec.kind === "talent" || rec.kind === "spell") {
        var listKey = rec.kind === "spell" ? "spells" : "talents";
        if (!rec.wasGranted && g[listKey])
          g[listKey] = g[listKey].filter(function (id) { return id !== rec.id; });
        if (!rec.wasOwned && state[listKey])
          state[listKey] = state[listKey].filter(function (id) { return id !== rec.id; });
      } else if (rec.kind === "skill") {
        if (rec.prevGranted) (g.skills || {})[rec.name] = rec.prevGranted;
        else if (g.skills) delete g.skills[rec.name];
        if (state.skills && state.skills[rec.name] === rec.setTier)
          state.skills[rec.name] = rec.prevTier;
      } else if (rec.kind === "proficiency") {
        if (rec.prevGranted) (g.proficiencies || {})[rec.name] = rec.prevGranted;
        else if (g.proficiencies) delete g.proficiencies[rec.name];
        var row = (state.proficiencies || []).filter(function (p) { return p.name === rec.name; })[0];
        if (row && row.tier === rec.setTier) {
          if (rec.created) state.proficiencies = state.proficiencies.filter(function (p) { return p !== row; });
          else row.tier = rec.prevTier;
        }
      }
    });
    if (state.grantChoices) delete state.grantChoices[grantingId];
  }

  // Which talent or spell's grant handed this item out, if any — as opposed
  // to the creation-wizard baseline directly (the ancestry pick, the free
  // skill/proficiency allocation), which never goes through applyGrants and
  // so leaves no grantChoices record. `kind` matches an applyOneGrant
  // record's `kind` ("talent" | "spell" | "skill" | "proficiency"); `id` is
  // the talent/spell id for those two kinds, the skill/proficiency name for
  // the other two. Null means "granted at creation directly", not "not
  // granted" — callers already know the item is granted before asking this.
  function grantSource(state, kind, id) {
    var gc = state.grantChoices || {};
    for (var grantingId in gc) {
      var recs = gc[grantingId] || [];
      for (var i = 0; i < recs.length; i++) {
        var rec = recs[i];
        if (rec.kind !== kind) continue;
        if ((kind === "talent" || kind === "spell") ? rec.id === id : rec.name === id)
          return byId[grantingId] || spellsById[grantingId] || null;
      }
    }
    return null;
  }

  // ---- Modifiers ----------------------------------------------------------
  // A talent with `ability: "modifier"` changes another talent or spell rather
  // than granting anything itself. Text changes go through hooks in the
  // target (§4.7); numeric and categorical changes are declared here, on the
  // modifier, as `modifies: { <targetId>: { <field>: { <op>: value } } }`.
  // That block doubles as the explicit target link the validator and editor
  // need — a modifier that only rewrites text still declares `{ target: {} }`.
  var MODIFIABLE_FIELDS = {
    name: 1, icon: 1, flavour: 1, description: 1,
    uses: 1, usesPer: 1, castingTime: 1, range: 1, target: 1, numTargets: 1, duration: 1, aoe: 1,
    "aoe.shape": 1,
  };
  // Deliberately NOT modifiable, and each for a specific reason:
  //   id/row/col   — identity and layout; a moving node breaks the drawn lines
  //   cost/pool    — computeSpent reads the RAW talent, so a modified cost
  //                  would display one price and charge another
  //   tier         — it gates both the tier-of-play and in-tree exp checks
  //   requires     — a modifier that re-gated its target would make the tree
  //                  unreadable (and could invalidate an owned talent)
  //   ability      — reclassifying a maneuver as a passive moves it between
  //                  sheet sections mid-render
  var MODIFIER_OPS = { set: 1, add: 1, mul: 1, min: 1, max: 1 };

  function isModifier(t) { return !!t && t.ability === "modifier"; }

  function numOr0(v) { return typeof v === "number" ? v : 0; }

  // Applied in a fixed order so that one modifier's ops are order-independent:
  // replace, then scale, then offset, then clamp.
  function applyFieldOps(value, ops) {
    var v = value;
    if (ops.set !== undefined) v = ops.set;
    if (ops.mul !== undefined) v = numOr0(v) * ops.mul;
    if (ops.add !== undefined) v = numOr0(v) + ops.add;
    if (ops.min !== undefined && numOr0(v) < ops.min) v = ops.min;
    if (ops.max !== undefined && numOr0(v) > ops.max) v = ops.max;
    return v;
  }

  // Owned modifiers pointing at `targetId`, in database order — deterministic
  // and author-controlled, so two modifiers touching one field stack the same
  // way every render (last `set` wins; `add`s accumulate).
  function modifiersFor(state, targetId) {
    var owned = (state && state.talents) || [];
    if (!owned.length) return [];
    return allTalents.filter(function (t) {
      return isModifier(t) && t.modifies && t.modifies[targetId] && owned.indexOf(t.id) >= 0;
    });
  }

  // The talent or spell as the character actually has it. Returns the entry
  // untouched when nothing modifies it, so the common case allocates nothing.
  // Text hooks are NOT resolved here — they resolve at render time against the
  // same state, which lets a modifier `set` a description that itself carries
  // hooks.
  //
  // Pass the AUTHORED entry. This is not idempotent: feeding its own output
  // back in applies every `add`/`mul` a second time. Callers that need both
  // (a node and its tooltip, say) keep the authored entry around and derive
  // from it twice rather than chaining.
  function effective(entry, state) {
    if (!entry || !entry.id) return entry;
    var mods = modifiersFor(state, entry.id);
    if (!mods.length) return entry;
    var out = {};
    Object.keys(entry).forEach(function (k) { out[k] = entry[k]; });
    mods.forEach(function (m) {
      var spec = m.modifies[entry.id] || {};
      Object.keys(spec).forEach(function (field) {
        if (!MODIFIABLE_FIELDS[field]) return;      // validator reports these
        // A dotted field ("aoe.shape") reaches one step into a nested object
        // instead of replacing the whole thing, so a modifier can change just
        // that sub-field (e.g. Cone → Circle) without re-authoring size/origin.
        var dot = field.indexOf(".");
        if (dot < 0) {
          out[field] = applyFieldOps(out[field], spec[field]);
        } else {
          var top = field.slice(0, dot), sub = field.slice(dot + 1);
          var base = {};
          if (out[top]) Object.keys(out[top]).forEach(function (k) { base[k] = out[top][k]; });
          base[sub] = applyFieldOps(base[sub], spec[field]);
          out[top] = base;
        }
      });
    });
    out.modifiedBy = mods.map(function (m) { return m.id; });
    return out;
  }

  // Requirement evaluation for a spell — the same shape as requirementStatus
  // (a `reasons` list, each coloured red/black by reasonMet), so the Spells
  // tab can reuse the exact same tooltip/requirement rendering as talents.
  // The first reason is always automatic: you must hold the domain's
  // Spellcasting proficiency at a tier ≥ the spell's own tier. Everything
  // after that is the spell's own optional `requires` block (talents/
  // anyTalents/skills/characteristics/spent — identical schema to a talent's).
  function spellRequirementStatus(spell, state) {
    var domainId = spellDomain(spell.id);
    var tierNum = spell.tier || 1;
    var domain = treeById(domainId);
    var haveTier = domain ? profTier(state, domain.name) : 0;
    var reqs = spell.requires || {};
    var reasons = [];
    var spent;

    reasons.push({
      type: "proficiency",
      label: (domain ? domain.name : domainId) + " Spellcasting " + tierNum,
      detail: "have " + haveTier,
      met: haveTier >= tierNum,
    });

    (reqs.talents || []).forEach(function (pid) {
      var pre = resolveReqTarget(pid);
      var preDomain = pre ? (pre.domain || spellDomain(pid)) : null;
      reasons.push({
        type: "talent", mode: "all", talentId: pid,
        label: pre ? pre.name : pid,
        crossDomain: pre ? preDomain !== domainId : true,
        crossTreeName: pre && preDomain !== domainId ? ((treeById(preDomain) || {}).name || preDomain) : null,
        met: isOwnedReqId(state, pid),
      });
    });
    if (reqs.anyTalents && reqs.anyTalents.length) {
      var anyMet = reqs.anyTalents.some(function (pid) { return isOwnedReqId(state, pid); });
      reqs.anyTalents.forEach(function (pid) {
        var pre = resolveReqTarget(pid);
        var preDomain = pre ? (pre.domain || spellDomain(pid)) : null;
        reasons.push({
          type: "talent", mode: "any", talentId: pid, groupMet: anyMet,
          label: pre ? pre.name : pid,
          crossDomain: pre ? preDomain !== domainId : true,
          crossTreeName: pre && preDomain !== domainId ? ((treeById(preDomain) || {}).name || preDomain) : null,
          met: isOwnedReqId(state, pid),
        });
      });
    }
    Object.keys(reqs.skills || {}).forEach(function (name) {
      var need = reqs.skills[name], have = (state.skills || {})[name] || 0;
      reasons.push({ type: "skill", label: name + " " + need, detail: "have " + have, met: have >= need });
    });
    Object.keys(reqs.characteristics || {}).forEach(function (key) {
      var need = reqs.characteristics[key], have = (state.characteristics || {})[key] || 0;
      reasons.push({ type: "characteristic", label: charLabel(key) + " " + need, detail: "have " + have, met: have >= need });
    });
    pushAnyReqReasons(reasons, state, reqs);
    if (reqs.spent) {
      spent = spent || computeSpent(state);
      Object.keys(reqs.spent).forEach(function (pool) {
        var need = reqs.spent[pool], have = spent[pool] || 0;
        reasons.push({ type: "spent", label: need + " " + poolLabel(pool) + " exp spent", detail: "have " + have, met: have >= need });
      });
    }

    return {
      owned: spellOwned(state, spell.id),
      met: reasons.every(reasonMet),
      reasons: reasons,
    };
  }
  // Is an (owned or offered) spell currently usable? Requirements (the
  // proficiency gate plus any authored requires) must still be met — sheet
  // edits can break this after the fact, same as a talent going owned-invalid.
  function spellCastable(state, spell) {
    if (!spell) return false;
    return spellRequirementStatus(spell, state).met;
  }
  // Can this spell be learned right now? Requirements met and not already owned.
  function canLearnSpell(state, spell) {
    if (!spell || spellOwned(state, spell.id)) return false;
    return spellRequirementStatus(spell, state).met;
  }
  // Mana to cast a spell: always the spell's tier minus one, so tier-1 spells
  // are free, repeatable cantrips.
  function spellManaCost(spell) {
    if (!spell) return 0;
    return Math.max(0, (spell.tier || 1) - 1);
  }
  // Human-readable casting time: "1 action", "2 actions", "3 actions",
  // "reaction", "free", or "N min" for a longer ritual cast (castingTime
  // holds a number of minutes in that case).
  function castingTimeLabel(spell) {
    var ct = spell && spell.castingTime;
    if (ct === "minor_action") return "1 action";
    if (ct === "major_action") return "3 actions";
    if (ct === "reaction") return "reaction";
    if (ct === "free") return "free";
    if (typeof ct === "number") return ct + " min";
    return "2 actions";
  }
  // Human-readable range: "Self", "Melee (2y)", "Weapon Range", "Ny", or ""
  // when not applicable.
  function rangeLabel(spell) {
    var r = spell && spell.range;
    if (r === "self") return "Self";
    if (r === "touch") return "Melee (2y)";
    if (r === "weapon") return "Weapon Range";
    if (typeof r === "number") return r + "y";
    return "";
  }
  var TARGET_LABELS = { self: "Self", ally: "Ally", enemy: "Enemy", object: "Object", point: "Point" };
  // Human-readable target list, e.g. "Enemy" or "Self, Ally". A `numTargets`
  // above 1 appends a "×N" count, the same convention a maneuver's uses badge
  // uses ("Maneuver ×N").
  function targetLabel(spell) {
    var base = ((spell && spell.target) || []).map(function (t) { return TARGET_LABELS[t] || t; }).join(", ");
    var n = spell && spell.numTargets;
    return (base && n > 1) ? base + " ×" + n : base;
  }
  // Human-readable duration: "Instantaneous", "Indefinite", or "N unit".
  function durationLabel(spell) {
    var d = spell && spell.duration;
    if (d === "instantaneous") return "Instantaneous";
    if (d === "indefinite") return "Indefinite";
    if (d && typeof d === "object") return d.value + " " + d.unit;
    return "";
  }
  // Human-readable area of effect, or "" when the spell has none. Cone (90°)
  // and Arc (180°) are separate shapes, not variants of one another.
  function aoeLabel(spell) {
    var a = spell && spell.aoe;
    if (!a) return "";
    var originLabel = a.origin === "self" ? "self" : "point in range";
    if (a.shape === "line") return a.size + "y x " + a.width + "y Line (" + originLabel + ")";
    if (a.shape === "cone") return a.size + "y Cone (" + originLabel + ")";
    if (a.shape === "arc") return a.size + "y Arc (" + originLabel + ")";
    return a.size + "y Circle (" + originLabel + ")";
  }

  // ---- Max HP / Max Mana ---------------------------------------------------
  // Max HP: 5 + Body at creation, +1 per 10 combat exp spent (any pool use),
  // and +Body again each time the tier of play advances past tier 1.
  function maxHP(state) {
    var body = (state.characteristics || {}).body || 0;
    var spent = computeSpent(state);
    var tierIncreases = currentTierIndex(state); // 0 at tier 1, 1 at tier 2, ...
    return 5 + body + Math.floor(spent.combat / 10) + body * tierIncreases;
  }
  // Max Mana: the caster characteristic (from source of power) + 1 per 10 exp
  // spent on Spellcasting proficiencies, and +that characteristic again each
  // time the tier of play advances past tier 1.
  function maxMana(state) {
    var charKey = casterCharacteristic(state);
    var charVal = charKey ? ((state.characteristics || {})[charKey] || 0) : 0;
    var spent = computeSpent(state);
    var tierIncreases = currentTierIndex(state);
    return charVal + Math.floor(spent.breakdown.spellcasting / 10) + charVal * tierIncreases;
  }

  window.Engine = {
    reindex: indexTalents,
    // trees
    allTrees: allTrees, treeById: treeById, treesOfKind: treesOfKind,
    visibleTrees: visibleTrees, treeVisible: treeVisible,
    combinationUnlocked: combinationUnlocked, hasTalentInTree: hasTalentInTree,
    hasSpellInDomain: hasSpellInDomain, hasInvestmentInTree: hasInvestmentInTree,
    // ancestry hierarchy
    ancestryChain: ancestryChain, ancestryDepth: ancestryDepth,
    accessibleAncestryTreeIds: accessibleAncestryTreeIds,
    // talents
    talentById: talentById, talentsForDomain: talentsForDomain,
    allTalents: function () { return allTalents; },
    // tree entries — talents and spells in one grid (§4.6)
    treeEntries: treeEntries, entryById: entryById, entryTreeId: entryTreeId,
    entryKind: entryKind, entryKindMark: entryKindMark, entryKindName: entryKindName,
    isSpellEntry: isSpellEntry, entryOwned: entryOwned,
    entryRequirementStatus: entryRequirementStatus,
    // talent groups (§6b)
    treeGroups: treeGroups, groupOf: groupOf, requirementsCover: requirementsCover,
    treeAnchors: treeAnchors, anchorFor: anchorFor,
    // costs & tiers
    computeSpent: computeSpent, currentTierIndex: currentTierIndex, tierThreshold: tierThreshold,
    treeAccessCharges: treeAccessCharges, nextTreeCost: nextTreeCost, learnCost: learnCost,
    treeSpent: treeSpent, sumSteps: sumSteps, stepCost: stepCost,
    // level caps & characteristic advancement
    skillCap: skillCap, characteristicCap: characteristicCap,
    charAdvanceTiers: charAdvanceTiers, charAdvancePicks: charAdvancePicks,
    charAdvancesRemaining: charAdvancesRemaining, characteristicBase: characteristicBase,
    // requirements
    requirementStatus: requirementStatus, reasonMet: reasonMet,
    canLearn: canLearn, canRefund: canRefund,
    // granted baseline
    isGrantedTalent: isGrantedTalent, grantedSkillTier: grantedSkillTier, grantedProfTier: grantedProfTier,
    // creation helpers
    creationPicksFor: creationPicksFor, creationPicksForChain: creationPicksForChain,
    ancestryById: ancestryById, ancestryPickable: ancestryPickable,
    sourceById: sourceById, sourceTalents: sourceTalents, ownedTalents: ownedTalents,
    // spells & spellcasting
    spellById: spellById, spellsForDomain: spellsForDomain, spellDomain: spellDomain, allSpells: allSpells,
    isMagicalDomain: isMagicalDomain, magicalDomains: magicalDomains,
    spellcastingLevel: spellcastingLevel,
    casterCharacteristic: casterCharacteristic,
    spellPool: spellPool, spellOwned: spellOwned, canLearnSpell: canLearnSpell, spellCastable: spellCastable,
    spellRequirementStatus: spellRequirementStatus,
    // text hooks & modifiers
    resolveText: resolveText, scanHooks: scanHooks,
    effective: effective, isModifier: isModifier, modifiersFor: modifiersFor,
    MODIFIABLE_FIELDS: MODIFIABLE_FIELDS, MODIFIER_OPS: MODIFIER_OPS, AOE_SHAPES: AOE_SHAPES,
    // grants
    grantsOf: grantsOf, grantNeedsChoice: grantNeedsChoice, grantOptions: grantOptions,
    grantOptionKey: grantOptionKey, optionTierRange: optionTierRange,
    grantSelectionValid: grantSelectionValid, applyGrants: applyGrants, revokeGrants: revokeGrants,
    grantSource: grantSource, isGrantedSpell: isGrantedSpell,
    spellManaCost: spellManaCost, castingTimeLabel: castingTimeLabel,
    rangeLabel: rangeLabel, targetLabel: targetLabel, durationLabel: durationLabel, aoeLabel: aoeLabel,
    maxHP: maxHP, maxMana: maxMana,
    // misc
    validateDB: validateDB, isCombatSkill: isCombatSkill, findKind: findKind,
    profTier: profTier, charLabel: charLabel, poolLabel: poolLabel,
    // weapon categories (inventory section)
    weaponCategories: weaponCategories, weaponCategoryById: weaponCategoryById,
    weaponDicePool: weaponDicePool, weaponDamageNote: weaponDamageNote,
  };
})();
