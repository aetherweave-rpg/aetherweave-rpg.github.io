// ============================================================================
// CHARACTER CREATION numbers  (EDITABLE DATABASE)
// ----------------------------------------------------------------------------
// Every number used by the character-creation wizard lives here. Change a value,
// refresh, and the wizard follows. Nothing chosen during creation costs exp.
// ============================================================================

window.CREATION = {
  // Step 1 — the array assigned across the five characteristics, one value each.
  characteristicArray: [3, 2, 2, 1, 1],

  // Step 2 — how many talents you pick from your ancestry's tree, free.
  ancestralTalentPicks: 1,

  // Step 3 — sources of power grant fixed bonuses; see js/data/sources.js.

  // Step 4 — points spent on combat skills and weapon proficiencies.
  // These use the normal advancement costs but are NOT exp.
  combatPoints: 6,

  // Step 5 — points spent on non-combat skills, crafting and instrument
  // proficiencies, with a required minimum of each proficiency kind.
  noncombatPoints: 8,
  requiredProficiencies: {
    crafting: 1,     // at least this many crafting proficiencies at tier 1+
    instrument: 1,   // at least this many instrument proficiencies at tier 1+
  },

  // Step 6 — free exp left over after creation, spent on anything.
  freeExp: { combat: 5, noncombat: 5 },
};
