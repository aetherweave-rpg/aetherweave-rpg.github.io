// ============================================================================
// CHARACTER CREATION numbers  (EDITABLE DATABASE)
// ----------------------------------------------------------------------------
// Every number used by the character-creation wizard lives here. Change a value,
// refresh, and the wizard follows. The defining trait and background are free;
// training is bought with the starting skill exp, like any later purchase.
// ============================================================================

window.CREATION = {
  // Step 1 — the array assigned across the five characteristics, one value each.
  characteristicArray: [3, 2, 2, 1, 1],

  // Step 2 — ancestry is flavour only; it grants nothing. See js/data/ancestries.js.

  // Step 3 — sources of power grant fixed bonuses; see js/data/sources.js.

  // Step 4 — how many defining traits you pick, free. See
  // js/data/traits.js.
  definingTraitPicks: 1,

  // Step 5 — exactly one background, from js/data/backgrounds.js.

  // The exp a new character starts with, in its two pools. Steps 6 and 7 are
  // paid from the skill exp; whatever is left of either pool is spent once
  // creation is done.
  startingExp: { skill: 18, talent: 8 },

  // Steps 6 and 7 — the least skill exp spent on each category of training:
  // combat skills with weapon and Spellcasting proficiencies, then non-combat
  // skills with crafting and instrument proficiencies. Minimums, not budgets,
  // and they outlive creation: the sheet flags a character who falls below one.
  trainingMinimum: { combat: 6, noncombat: 8 },

  // Step 7 — proficiencies of these kinds the character must hold.
  requiredProficiencies: {
    crafting: 1,     // at least this many crafting proficiencies at tier 1+
    instrument: 1,   // at least this many instrument proficiencies at tier 1+
  },
};
