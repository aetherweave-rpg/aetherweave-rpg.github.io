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
      trees.push({ id: d.id, name: d.name, icon: d.icon, accent: d.accent, cols: d.cols, kind: d.kind || "core", magical: !!d.magical, hidden: !!d.hidden });
    });
    (window.ANCESTRIES || []).forEach(function (a) {
      trees.push({ id: a.treeId, name: a.name, icon: a.icon, accent: a.accent, cols: a.cols || 3,
        kind: "ancestry", ancestry: a.id, parent: a.parent || null, description: a.description, hidden: !!a.hidden });
    });
    (window.COMBINATIONS || []).forEach(function (c) {
      trees.push({ id: c.id, name: c.name, icon: c.icon, accent: c.accent, cols: c.cols || 3,
        kind: "combination", parents: c.parents || [], description: c.description });
    });
    treeIndex = {};
    trees.forEach(function (t) { treeIndex[t.id] = t; });
  }

  function allTrees() { return trees; }
  function treeById(id) { return treeIndex[id]; }
  function treesOfKind(kind) { return trees.filter(function (t) { return t.kind === kind; }); }

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

  // ---- Granted (free) baseline -------------------------------------------
  function grantedOf(state) {
    return state.granted || { talents: [], skills: {}, proficiencies: {} };
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
  // Splits a total cost evenly between the combat and non-combat pools (an odd
  // total, should the data ever produce one, rounds the combat half up).
  function splitCost(total) {
    var combat = Math.ceil(total / 2);
    return { combat: combat, noncombat: total - combat };
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
      spent.breakdown.proficiencies += cost;
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

    // Spellcasting ladder: priced like a combat skill, split evenly between
    // both pools (spells serve combat and non-combat purposes alike).
    Object.keys(state.spellcasting || {}).forEach(function (domainId) {
      var lvl = state.spellcasting[domainId] || 0;
      if (!lvl) return;
      var split = spellcastingCostSplit(lvl);
      spent.combat += split.combat;
      spent.noncombat += split.noncombat;
      spent.breakdown.spellcasting += split.total;
    });

    // Learned spells: each carries its own exp cost drawn from its own pool.
    (state.spells || []).forEach(function (id) {
      var sp = spellsById[id];
      if (!sp) return;
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
  // Skills and characteristics both top out at 5, but how much of that range is
  // reachable depends on the tier of play — each tier opens one more level.
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

  // A combination tree unlocks once the character has at least one talent
  // (granted talents count) in BOTH of its parent trees.
  function combinationUnlocked(tree, state) {
    if (!tree || tree.kind !== "combination") return true;
    return (tree.parents || []).every(function (pid) { return hasTalentInTree(state, pid); });
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
        label: "Talents in " + parentNames.join(" and "),
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

    // Prerequisite talents (all required)
    (reqs.talents || []).forEach(function (pid) {
      var pre = byId[pid];
      reasons.push({
        type: "talent", mode: "all", talentId: pid,
        label: pre ? pre.name : pid,
        crossDomain: pre ? pre.domain !== talent.domain : true,
        crossTreeName: pre && pre.domain !== talent.domain ? (treeById(pre.domain) || {}).name : null,
        met: (state.talents || []).indexOf(pid) >= 0,
      });
    });

    // Any-of prerequisite talents (at least one)
    if (reqs.anyTalents && reqs.anyTalents.length) {
      var anyMet = reqs.anyTalents.some(function (pid) {
        return (state.talents || []).indexOf(pid) >= 0;
      });
      reqs.anyTalents.forEach(function (pid) {
        var pre = byId[pid];
        reasons.push({
          type: "talent", mode: "any", talentId: pid, groupMet: anyMet,
          label: pre ? pre.name : pid,
          crossDomain: pre ? pre.domain !== talent.domain : true,
          crossTreeName: pre && pre.domain !== talent.domain ? (treeById(pre.domain) || {}).name : null,
          met: (state.talents || []).indexOf(pid) >= 0,
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

  function reasonMet(r) {
    if (r.type === "talent" && r.mode === "any") return r.groupMet;
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
  // another owned talent would lose its requirements.
  function canRefund(talentId, state) {
    if ((state.talents || []).indexOf(talentId) < 0) return { ok: false, reason: "not owned" };
    if (isGrantedTalent(state, talentId)) return { ok: false, reason: "granted", granted: true };

    var sim = JSON.parse(JSON.stringify(state));
    sim.talents = sim.talents.filter(function (id) { return id !== talentId; });
    var broken = [];
    sim.talents.forEach(function (id) {
      var t = byId[id];
      if (t && !requirementStatus(t, sim).met) broken.push(t.name);
    });
    return broken.length ? { ok: false, blockedBy: broken } : { ok: true };
  }

  // ---- Database validation ------------------------------------------------
  function validateDB() {
    var problems = [];
    var seen = {};
    var skillNames = {};
    ["combat", "noncombat"].forEach(function (g) {
      (window.SKILLS[g] || []).forEach(function (s) { skillNames[s.name] = true; });
    });
    var charKeys = (CONFIG.CHARACTERISTICS || []).reduce(function (m, c) { m[c.key] = true; return m; }, {});

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

      var reqs = t.requires || {};
      var prereqs = (reqs.talents || []).concat(reqs.anyTalents || []);
      prereqs.forEach(function (pid) {
        var pre = byId[pid];
        if (!pre) { problems.push(t.id + ": unknown prerequisite talent '" + pid + "'"); return; }

        // Cross-tree requirements are legal ONLY inside a combination tree,
        // and only when they point at one of that tree's parents.
        if (pre.domain !== t.domain) {
          if (!tree || tree.kind !== "combination") {
            problems.push(t.id + ": cross-tree prerequisite '" + pid + "' is only allowed in combination trees");
          } else if ((tree.parents || []).indexOf(pre.domain) < 0) {
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
    });

    // Each row of a tree should hold a single tier.
    var rowTier = {};
    allTalents.forEach(function (t) {
      var key = t.domain + ":" + t.row;
      if (rowTier[key] === undefined) rowTier[key] = t.tier;
      else if (rowTier[key] !== t.tier)
        problems.push(t.domain + " row " + t.row + " mixes tier " + rowTier[key] + " and tier " + t.tier);
    });

    // Same-tree prerequisites must sit on a lower row (trees grow upward).
    allTalents.forEach(function (t) {
      var reqs = t.requires || {};
      (reqs.talents || []).concat(reqs.anyTalents || []).forEach(function (pid) {
        var pre = byId[pid];
        if (pre && pre.domain === t.domain && pre.row >= t.row)
          problems.push(t.id + ": prerequisite '" + pid + "' is not below it (row " + pre.row + " ≥ " + t.row + ")");
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
        if (!(sp.castingTime === "action" || sp.castingTime === "minor_action" ||
              (typeof sp.castingTime === "number" && sp.castingTime > 0)))
          problems.push("spell '" + sp.id + "': castingTime must be 'action', 'minor_action', or a positive number of minutes (got " + JSON.stringify(sp.castingTime) + ")");
      });
    });

    // Magical domains reserve the two centre columns for the auto-generated
    // spellcasting spine + Spells Known gateways; authored talents must not sit there.
    magicalDomains().forEach(function (tree) {
      var cols = tree.cols || 5;
      var c = Math.floor(cols / 2);
      var side = c + 1 < cols ? c + 1 : c - 1;
      talentsForDomain(tree.id).forEach(function (t) {
        if (t.col === c || t.col === side)
          problems.push(tree.id + ": talent '" + t.id + "' sits in a centre column (" + t.col +
            ") reserved for the spellcasting spine — move it to a side column");
      });
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
          tier: t.tier || 1, name: t.name, icon: t.icon || "", description: t.description || "",
          ability: t.ability || "passive", uses: t.uses, usesPer: t.usesPer,
          sourceName: src.name,
          unlocked: cur >= (t.tier || 1),
        };
      });
  }

  // All talents a character currently has: owned tree talents plus any source-
  // of-power talents unlocked by tier of play. Normalized to one shape so the
  // sheet can group both by `ability` (Abilities vs Maneuvers) without caring
  // which kind a given entry is.
  function ownedTalents(state) {
    var tree = (state.talents || []).map(talentById).filter(Boolean);
    var src = sourceTalents(state).filter(function (t) { return t.unlocked; })
      .map(function (t) {
        return {
          id: t.id, name: t.name, icon: t.icon, description: t.description,
          tier: t.tier, ability: t.ability, uses: t.uses, usesPer: t.usesPer,
          fromSource: true, sourceName: t.sourceName,
        };
      });
    return tree.concat(src);
  }

  // ---- Spellcasting -------------------------------------------------------
  // Magical domains (core trees flagged `magical`) grant spellcasting instead
  // of hand-authored gateway talents: a per-domain ladder that adds +1 per rung
  // to spell test rolls, and a pool of individually-learned spells. Both the
  // ladder height and the learnable spell tier are gated by the tier of play.
  function isMagicalDomain(treeId) {
    var t = treeById(treeId);
    return !!(t && t.kind === "core" && t.magical);
  }
  function magicalDomains() {
    return trees.filter(function (t) { return t.kind === "core" && t.magical; });
  }
  // Highest spell tier / ladder rung reachable at the current tier of play.
  function maxCasterTier(state) {
    var conf = CONFIG.SPELL_TIER_UNLOCK || { offset: 1, max: CONFIG.MAX_SPELL_TIER || 5 };
    var top = currentTierIndex(state) + 1;
    return Math.min(conf.max, top + conf.offset);
  }
  function spellcastingLevel(state, domainId) {
    return (state.spellcasting || {})[domainId] || 0;
  }
  // Cumulative exp to reach `level`, priced like a combat skill (total, before
  // the pool split below).
  function spellcastingCost(level) {
    return sumSteps(CONFIG.SKILL_COSTS.combat, level);
  }
  // As spellcastingCost, but broken into what each pool actually pays — each
  // rung's total cost is split evenly between combat and non-combat.
  function spellcastingCostSplit(level) {
    var costs = CONFIG.SKILL_COSTS.combat || [];
    var combat = 0, noncombat = 0;
    for (var i = 0; i < level; i++) {
      var step = costs[i] !== undefined ? costs[i] : (costs[costs.length - 1] || 0);
      var half = splitCost(step);
      combat += half.combat; noncombat += half.noncombat;
    }
    return { combat: combat, noncombat: noncombat, total: combat + noncombat };
  }
  // Exp for the NEXT rung (for the UI hint), total across both pools.
  function spellcastingStepCost(level) {
    var costs = CONFIG.SKILL_COSTS.combat;
    return costs[level] !== undefined ? costs[level] : (costs[costs.length - 1] || 0);
  }
  function canRaiseSpellcasting(state, domainId) {
    return spellcastingLevel(state, domainId) < maxCasterTier(state);
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
  // Is an (owned or offered) spell currently usable? You must have raised the
  // domain's Spellcasting spine to at least the spell's tier (owning rung T
  // unlocks tier-T casting).
  function spellCastable(state, spell) {
    if (!spell) return false;
    var domainId = spellDomain(spell.id);
    if (!isMagicalDomain(domainId)) return false;
    return spellcastingLevel(state, domainId) >= (spell.tier || 1);
  }
  // Can this spell be learned right now? Castable and not already owned.
  function canLearnSpell(state, spell) {
    if (!spell || spellOwned(state, spell.id)) return false;
    return spellCastable(state, spell);
  }
  // Mana to cast a spell: always the spell's tier minus one, so tier-1 spells
  // are free, repeatable cantrips.
  function spellManaCost(spell) {
    if (!spell) return 0;
    return Math.max(0, (spell.tier || 1) - 1);
  }
  // Human-readable casting time: "action", "minor action", or "N min" for a
  // longer ritual cast (castingTime holds a number of minutes in that case).
  function castingTimeLabel(spell) {
    var ct = spell && spell.castingTime;
    if (ct === "minor_action") return "minor action";
    if (typeof ct === "number") return ct + " min";
    return "action";
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
  // spent on the Spellcasting ladder, and +that characteristic again each time
  // the tier of play advances past tier 1.
  function maxMana(state) {
    var charKey = casterCharacteristic(state);
    var charVal = charKey ? ((state.characteristics || {})[charKey] || 0) : 0;
    var spent = computeSpent(state);
    var tierIncreases = currentTierIndex(state);
    return charVal + Math.floor(spent.breakdown.spellcasting / 10) + charVal * tierIncreases;
  }

  // ---- Spellcasting spine (auto-generated tree nodes) ---------------------
  // A magical domain grows a central spine: MAX_SPELL_TIER "Spellcasting" rungs
  // down the centre column (each +1 to spell rolls, priced like a combat skill),
  // with a free "Spells Known" gateway beside each rung that opens that tier's
  // spell picker. These nodes are synthetic — never stored in TALENT_DB, never
  // exported; the tree page merges them into the grid and the ladder level lives
  // in state.spellcasting. Rung tiers [1,1,2,3,4] gate them by tier of play.
  function casterCenterCol(tree) { return Math.floor((tree.cols || 5) / 2); }
  function casterNodes(domainId) {
    var tree = treeById(domainId);
    if (!tree || tree.kind !== "core" || !tree.magical) return [];
    var cols = tree.cols || 5;
    var c = casterCenterCol(tree);
    var side = c + 1 < cols ? c + 1 : c - 1;        // "Spells Known" column beside the spine
    var maxT = CONFIG.MAX_SPELL_TIER || 5;
    var rungTier = [1, 1, 2, 3, 4];
    var combat = CONFIG.SKILL_COSTS.combat || [];
    var out = [];
    for (var r = 1; r <= maxT; r++) {
      var tier = rungTier[r - 1] || Math.max(1, r - 1);
      var total = combat[r - 1] !== undefined ? combat[r - 1] : 0;
      var half = splitCost(total);
      out.push({
        id: domainId + "__cast" + r, domain: domainId, synthetic: "cast", rung: r,
        name: "Spellcasting +" + r, icon: "✨", tier: tier, row: r - 1, col: c,
        pool: "split", cost: total, costCombat: half.combat, costNoncombat: half.noncombat,
        requires: r > 1 ? { talents: [domainId + "__cast" + (r - 1)] } : {},
        description: "Raise your " + tree.name + " spellcasting to +" + r + ": +" + r +
          " dice on its spell tests, and access to tier-" + r + " spells.",
      });
      out.push({
        id: domainId + "__known" + r, domain: domainId, synthetic: "known", spellTier: r,
        name: "Spells Known", icon: "📖", tier: tier, row: r - 1, col: side,
        pool: "split", cost: 0, costCombat: 0, costNoncombat: 0, requires: { talents: [domainId + "__cast" + r] },
        description: "Browse and learn tier-" + r + " " + tree.name + " spells (needs Spellcasting +" + r + ").",
      });
    }
    return out;
  }

  window.Engine = {
    reindex: indexTalents,
    // trees
    allTrees: allTrees, treeById: treeById, treesOfKind: treesOfKind,
    visibleTrees: visibleTrees, treeVisible: treeVisible,
    combinationUnlocked: combinationUnlocked, hasTalentInTree: hasTalentInTree,
    // ancestry hierarchy
    ancestryChain: ancestryChain, ancestryDepth: ancestryDepth,
    accessibleAncestryTreeIds: accessibleAncestryTreeIds,
    // talents
    talentById: talentById, talentsForDomain: talentsForDomain,
    allTalents: function () { return allTalents; },
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
    maxCasterTier: maxCasterTier, spellcastingLevel: spellcastingLevel,
    spellcastingCost: spellcastingCost, spellcastingCostSplit: spellcastingCostSplit,
    spellcastingStepCost: spellcastingStepCost,
    canRaiseSpellcasting: canRaiseSpellcasting, casterCharacteristic: casterCharacteristic,
    spellPool: spellPool, spellOwned: spellOwned, canLearnSpell: canLearnSpell, spellCastable: spellCastable,
    spellManaCost: spellManaCost, castingTimeLabel: castingTimeLabel, casterNodes: casterNodes,
    maxHP: maxHP, maxMana: maxMana,
    // misc
    validateDB: validateDB, isCombatSkill: isCombatSkill, findKind: findKind,
    profTier: profTier, charLabel: charLabel, poolLabel: poolLabel,
  };
})();
