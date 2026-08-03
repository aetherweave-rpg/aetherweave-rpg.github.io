// ============================================================================
// Aetherweave Talent Calculator — global configuration
// ----------------------------------------------------------------------------
// Plain JS (loads from file:// with no web server). Edit these values to tune
// the rules; see DESIGN.md for the full data model.
// ============================================================================

window.CONFIG = {
  // --- Tiers of play -------------------------------------------------------
  // A character's tier of play is derived from TOTAL exp spent (both pools).
  // This is a property of the character, and is entirely separate from the
  // tier a talent sits at inside its tree (see TALENT_TIER_TREE_EXP below).
  TIERS: [
    { name: "Tier 1", minSpent: 0 },
    { name: "Tier 2", minSpent: 50 },
    { name: "Tier 3", minSpent: 100 },
    { name: "Tier 4", minSpent: 150 },
  ],

  // --- Talent tiers (inside a tree) ---------------------------------------
  // A talent marked `tier: N` has TWO gates, both of which must be met:
  //   1. the character is at tier of play N or higher, AND
  //   2. they have spent at least TALENT_TIER_TREE_EXP[N-1] exp IN THAT TREE.
  // This is what paces a tree even for talents that carry no other
  // requirements at all.
  TALENT_TIER_TREE_EXP: [0, 25, 50, 75],

  // --- Skill / proficiency step costs --------------------------------------
  // Cost to advance FROM level i TO level i+1. Skills run 0–5, so five steps.
  // A Spellcasting proficiency (see PROFICIENCY_KINDS in data/skills.js) reuses
  // the weapon curve below, so raising it costs exactly what a weapon step does.
  SKILL_COSTS: {
    combat:     [2, 2, 4, 6, 8],  // combat skills
    noncombat:  [1, 2, 3, 4, 5],  // general non-combat skills
    crafting:   [1, 1, 2, 2, 3],  // crafting proficiencies
    instrument: [1, 1, 2, 2, 3],  // instrument proficiencies
    weapon:     [2, 2, 4, 6, 8],  // weapon proficiencies
  },
  MAX_SKILL_TIER: 5,

  // --- Characteristics -----------------------------------------------------
  // Keys are referenced by talent `requires.characteristics`.
  CHARACTERISTICS: [
    { key: "awareness",    label: "Awareness",    abbr: "AWA" },
    { key: "body",         label: "Body",         abbr: "BOD" },
    { key: "cunning",      label: "Cunning",      abbr: "CUN" },
    { key: "intelligence", label: "Intelligence", abbr: "INT" },
    { key: "presence",     label: "Presence",     abbr: "PRE" },
  ],
  MAX_CHARACTERISTIC: 5,

  // --- Level caps by tier of play ------------------------------------------
  // How high a skill or characteristic may be raised, given the tier of play.
  //   cap = min(max, tierOfPlay + offset)
  // Skills:          tier 1 → 2, tier 2 → 3, tier 3 → 4, tier 4 → 5
  // Characteristics: tier 1 → 3, tier 2 → 4, tier 3 → 5, tier 4 → 5 (capped)
  LEVEL_CAPS: {
    skillOffset: 1,
    characteristicOffset: 2,
  },

  // Characteristics are fixed at creation and cannot otherwise be edited.
  // Each time the tier of play advances, the character raises this many
  // DIFFERENT characteristics by one.
  CHARACTERISTIC_ADVANCES_PER_TIER: 2,

  // --- Tree access surcharge ----------------------------------------------
  // Branching out is expensive. Your FIRST tree with a purchased talent is
  // free; each additional tree costs a one-time surcharge — the 2nd tree costs
  // costs[0], the 3rd costs[1], and so on (the last value repeats beyond the
  // end). Charged to the pool of the talent that opened the tree.
  //
  // Talents granted at character creation never open a tree or trigger this,
  // and trees whose `kind` is listed in `exemptKinds` are ignored by the
  // surcharge entirely: they cost nothing to start in, and they do not push the
  // ladder along for the trees that do charge.
  TREE_ACCESS: {
    costs: [1, 3, 6, 9],
    // ancestry:    your own heritage is free to develop.
    // combination: you already paid to enter both parent trees, so braiding
    //              them together costs nothing extra to start.
    exemptKinds: ["ancestry", "combination"],
  },

  // --- Spellcasting --------------------------------------------------------
  // Magical domains (domain.magical === true) grant access to a "Spellcasting"
  // proficiency kind (see PROFICIENCY_KINDS in data/skills.js) — a plain
  // open-ended proficiency, named after the domain, that costs the same as a
  // weapon proficiency and caps out via the ordinary skill/proficiency level
  // cap (tierOfPlay + LEVEL_CAPS.skillOffset), same as any other proficiency.
  // Holding tier N of a domain's Spellcasting proficiency unlocks casting
  // tier-N spells in that domain and adds N dice to its spell test pool.
  // Individual spells (js/data/spells.js) carry their own exp `cost`/`pool`
  // and a `castingTime` ("action" / "minor_action" / "reaction" / minutes); mana cost is
  // never authored — it's always tier - 1, so tier-1 spells are free cantrips.
  MAX_SPELL_TIER: 5,

  // --- Maneuvers -----------------------------------------------------------
  // A maneuver talent may be used `uses` times per one of these periods
  // (talent.usesPer). The first entry is the default when none is set. "scene"
  // refreshes far more often than "session".
  MANEUVER_PERIODS: ["session", "scene"],
};

// Starting free exp comes from the character-creation numbers; see
// js/data/creation.js. Kept here as a fallback if that file is not loaded.
window.CONFIG.STARTING_EXP = (window.CREATION && window.CREATION.freeExp) || { combat: 5, noncombat: 5 };
