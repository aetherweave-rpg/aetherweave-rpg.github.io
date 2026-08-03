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
    sim.talents = sim.talents.filter(function (id) { return id !== talentId; });
    var broken = [];
    sim.talents.forEach(function (id) {
      var t = byId[id];
      if (t && !requirementStatus(t, sim).met) broken.push(t.name);
    });
    return broken.length ? { ok: false, blockedBy: broken } : { ok: true };
  }

  // ---- Database validation ------------------------------------------------
  var validSpellTargets = { self: true, ally: true, enemy: true, object: true };
  var validDurationUnits = { minutes: true, hours: true, days: true, weeks: true, rounds: true };

  // Shared by spells and maneuver talents — both carry the same "castable"
  // fields describing what they affect, for how long, and where. `label` is
  // the message prefix already used by the caller's other problems for this
  // object (e.g. `t.id` for a talent, `"spell '" + sp.id + "'"` for a spell).
  function validateCastableFields(problems, label, obj) {
    if (!(obj.castingTime === "action" || obj.castingTime === "minor_action" ||
          (typeof obj.castingTime === "number" && obj.castingTime > 0)))
      problems.push(label + ": castingTime must be 'action', 'minor_action', or a positive number of minutes (got " + JSON.stringify(obj.castingTime) + ")");
    if (obj.range != null &&
        !(obj.range === "self" || obj.range === "touch" || obj.range === "weapon" || (typeof obj.range === "number" && obj.range > 0)))
      problems.push(label + ": range must be 'self', 'touch', 'weapon', or a positive number of yards (got " + JSON.stringify(obj.range) + ")");
    if (obj.target != null && (!Array.isArray(obj.target) || obj.target.some(function (t) { return !validSpellTargets[t]; })))
      problems.push(label + ": target must be a list from self/ally/enemy/object, or omitted entirely (got " + JSON.stringify(obj.target) + ")");
    var dur = obj.duration;
    var durOk = dur === "instantaneous" || dur === "indefinite" ||
      (!!dur && typeof dur === "object" && typeof dur.value === "number" && dur.value > 0 && validDurationUnits[dur.unit]);
    if (!durOk)
      problems.push(label + ": duration must be 'instantaneous', 'indefinite', or { value, unit: minutes|hours|days|weeks|rounds } (got " + JSON.stringify(dur) + ")");
    if (obj.aoe) {
      var aoe = obj.aoe;
      if (aoe.shape !== "cone" && aoe.shape !== "line" && aoe.shape !== "circle")
        problems.push(label + ": aoe.shape must be 'cone', 'line', or 'circle' (got " + JSON.stringify(aoe.shape) + ")");
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
      if (aoe.shape === "cone") {
        if (aoe.arc != null && aoe.arc !== 90 && aoe.arc !== 180)
          problems.push(label + ": a cone aoe's 'arc' must be 90 or 180 (got " + JSON.stringify(aoe.arc) + ")");
      } else if (aoe.arc != null) {
        problems.push(label + ": only a cone aoe may set 'arc'");
      }
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

        // Spells are placed in their own per-domain grid (the Spells tab),
        // separate from the talent grid, but use the same row/col scheme.
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
      });
    });

    // Text hooks (§4.7). A hook that doesn't parse, or that names an id no
    // talent/spell has, renders as dead text a player would never see resolve
    // — both are typos, not content gaps, so they're reported structurally.
    function checkHooks(label, obj) {
      ["description", "flavour"].forEach(function (fieldName) {
        scanHooks(obj[fieldName]).forEach(function (h) {
          if (!h.groups) {
            problems.push(label + ": malformed text hook {" + h.body + "} in " + fieldName +
              " (expected {id:\"text\"}, optionally joined with | or >)");
            return;
          }
          h.groups.forEach(function (group) {
            group.forEach(function (clause) {
              if (!byId[clause.id] && !spellsById[clause.id])
                problems.push(label + ": text hook in " + fieldName +
                  " names unknown talent/spell '" + clause.id + "'");
            });
          });
        });
      });
    }
    allTalents.forEach(function (t) { checkHooks("talent '" + t.id + "'", t); });
    Object.keys(window.SPELLS || {}).forEach(function (domainId) {
      (window.SPELLS[domainId] || []).forEach(function (sp) { checkHooks("spell '" + sp.id + "'", sp); });
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
          castingTime: t.castingTime, range: t.range, target: t.target,
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
  function ownedTalents(state) {
    var tree = (state.talents || []).map(talentById).filter(Boolean);
    var src = sourceTalents(state).filter(function (t) { return t.unlocked; })
      .map(function (t) {
        return {
          id: t.id, name: t.name, icon: t.icon, description: t.description, flavour: t.flavour,
          tier: t.tier, ability: t.ability, uses: t.uses, usesPer: t.usesPer,
          castingTime: t.castingTime, range: t.range, target: t.target,
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
  // player has to mentally merge (see DESIGN.md §4.7). One grammar, three
  // shapes it covers:
  //
  //   {id:"text"}                       insertion — appears once `id` is owned
  //   {new:"replacement">old:"text"}    supersession — the first owned GROUP wins
  //   {a:"fire"|b:"ice"|c:"lightning"}  alternatives — every owned clause, listed
  //
  // `|` joins clauses within a group, `>` starts the next fallback group. A
  // group wins as soon as any clause in it is owned, so the two compose
  // (`{a:"x"|b:"y">c:"z"}`). Nothing owned anywhere → the hook renders empty.
  //
  // Ownership is talents + spells (isOwnedReqId). Source-of-power talents are
  // deliberately not hook-referenceable: resolving their tier gate needs
  // computeSpent, which would put an exp recount inside every text render.
  var HOOK_ID_RE = /^[A-Za-z0-9_]+$/;
  // A brace that opened like a hook. Used to tell "the author meant a hook and
  // fumbled it" (report it) from "this is prose containing a brace" (leave it).
  var HOOK_START_RE = /^\{\s*[A-Za-z0-9_]+\s*:\s*"/;

  // The `}` that closes the hook opened at `open`, skipping any brace sitting
  // inside a clause's quoted text. Returns -1 when this brace doesn't open a
  // hook at all, which is what lets prose keep a literal `{`.
  function hookEnd(text, open) {
    var inStr = false;
    for (var i = open + 1; i < text.length; i++) {
      var ch = text.charAt(i);
      if (inStr) {
        if (ch === "\\") i++;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "}") return i;
      else if (ch === "{") return -1;      // nested brace — not a hook
    }
    return -1;
  }

  // Parses a hook body into groups of {id, text} clauses. Returns null for
  // anything that isn't well-formed, so an unparseable brace span falls back
  // to rendering verbatim instead of eating the rest of the description.
  function parseHookBody(body) {
    var groups = [[]], i = 0;
    function skipWs() { while (i < body.length && /\s/.test(body.charAt(i))) i++; }
    while (i < body.length) {
      skipWs();
      if (i >= body.length) break;
      var idStart = i;
      while (i < body.length && body.charAt(i) !== ":") i++;
      if (i >= body.length) return null;
      var id = body.slice(idStart, i).trim();
      if (!HOOK_ID_RE.test(id)) return null;
      i++;                                  // past ':'
      skipWs();
      if (body.charAt(i) !== '"') return null;
      i++;
      var text = "";
      while (i < body.length && body.charAt(i) !== '"') {
        if (body.charAt(i) === "\\" && i + 1 < body.length) { text += body.charAt(i + 1); i += 2; }
        else { text += body.charAt(i); i++; }
      }
      if (i >= body.length) return null;    // unterminated clause text
      i++;                                  // past the closing '"'
      groups[groups.length - 1].push({ id: id, text: text });
      skipWs();
      if (i >= body.length) break;
      var sep = body.charAt(i);
      if (sep === "|") i++;
      else if (sep === ">") { groups.push([]); i++; }
      else return null;
    }
    if (!groups[groups.length - 1].length) groups.pop();
    return groups.length ? groups : null;
  }

  // "fire" · "fire or ice" · "fire, ice, or lightning"
  function joinAlternatives(parts) {
    if (parts.length <= 1) return parts[0] || "";
    if (parts.length === 2) return parts[0] + " or " + parts[1];
    return parts.slice(0, -1).join(", ") + ", or " + parts[parts.length - 1];
  }

  function resolveHookGroups(groups, state) {
    for (var g = 0; g < groups.length; g++) {
      var hits = [];
      for (var c = 0; c < groups[g].length; c++) {
        if (isOwnedReqId(state, groups[g][c].id)) hits.push(groups[g][c].text);
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

  // Every hook span in `text`, as {open, close, groups}. `groups` is null for
  // a span that looked like a hook (it contains `:"`) but didn't parse — the
  // validator reports those; rendering leaves them verbatim.
  function scanHooks(text) {
    var out = [], i = 0;
    if (typeof text !== "string") return out;
    while (i < text.length) {
      var open = text.indexOf("{", i);
      if (open < 0) break;
      var close = hookEnd(text, open);
      if (close < 0) {
        // Never closed — almost always an unterminated clause quote, which
        // would otherwise be invisible to the validator because there is no
        // span to parse. Report it only if it opened like a hook.
        if (HOOK_START_RE.test(text.slice(open)))
          out.push({ open: open, close: -1, body: text.slice(open + 1).split("\n")[0], groups: null });
        i = open + 1;
        continue;
      }
      var body = text.slice(open + 1, close);
      var groups = parseHookBody(body);
      if (groups || body.indexOf(':"') >= 0 || body.indexOf(": \"") >= 0)
        out.push({ open: open, close: close, body: body, groups: groups });
      i = (groups ? close : open) + 1;
    }
    return out;
  }

  function resolveText(text, state) {
    if (typeof text !== "string" || text.indexOf("{") < 0) return text;
    var hooks = scanHooks(text).filter(function (h) { return h.groups; });
    if (!hooks.length) return text;
    var out = "", at = 0;
    hooks.forEach(function (h) {
      out += text.slice(at, h.open) + resolveHookGroups(h.groups, state || {});
      at = h.close + 1;
    });
    return tidyResolved(out + text.slice(at));
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
  // Human-readable casting time: "action", "minor action", or "N min" for a
  // longer ritual cast (castingTime holds a number of minutes in that case).
  function castingTimeLabel(spell) {
    var ct = spell && spell.castingTime;
    if (ct === "minor_action") return "minor action";
    if (typeof ct === "number") return ct + " min";
    return "action";
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
  var TARGET_LABELS = { self: "Self", ally: "Ally", enemy: "Enemy", object: "Object" };
  // Human-readable target list, e.g. "Enemy" or "Self, Ally".
  function targetLabel(spell) {
    return ((spell && spell.target) || []).map(function (t) { return TARGET_LABELS[t] || t; }).join(", ");
  }
  // Human-readable duration: "Instantaneous", "Indefinite", or "N unit".
  function durationLabel(spell) {
    var d = spell && spell.duration;
    if (d === "instantaneous") return "Instantaneous";
    if (d === "indefinite") return "Indefinite";
    if (d && typeof d === "object") return d.value + " " + d.unit;
    return "";
  }
  // Human-readable area of effect, or "" when the spell has none. Cones are
  // always 90°, unless `arc: 180` widens them to a half-circle "Arc".
  function aoeLabel(spell) {
    var a = spell && spell.aoe;
    if (!a) return "";
    var originLabel = a.origin === "self" ? "self" : "point in range";
    if (a.shape === "line") return a.size + "y x " + a.width + "y Line (" + originLabel + ")";
    if (a.shape === "cone") return a.size + "y " + (a.arc === 180 ? "Arc" : "Cone") + " (" + originLabel + ")";
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
    spellcastingLevel: spellcastingLevel,
    casterCharacteristic: casterCharacteristic,
    spellPool: spellPool, spellOwned: spellOwned, canLearnSpell: canLearnSpell, spellCastable: spellCastable,
    spellRequirementStatus: spellRequirementStatus,
    // text hooks
    resolveText: resolveText, scanHooks: scanHooks,
    spellManaCost: spellManaCost, castingTimeLabel: castingTimeLabel,
    rangeLabel: rangeLabel, targetLabel: targetLabel, durationLabel: durationLabel, aoeLabel: aoeLabel,
    maxHP: maxHP, maxMana: maxMana,
    // misc
    validateDB: validateDB, isCombatSkill: isCombatSkill, findKind: findKind,
    profTier: profTier, charLabel: charLabel, poolLabel: poolLabel,
  };
})();
