// ============================================================================
// Skills & proficiency kinds  (EDITABLE DATABASE)
// ----------------------------------------------------------------------------
// `char` is the paired characteristic key (from CONFIG.CHARACTERISTICS). It's
// shown as an abbreviation on the sheet; it does not gate anything by itself.
// Combat skills draw from COMBAT exp; everything else from NON-COMBAT exp.
// ============================================================================

window.SKILLS = {
  combat: [
    { name: "Deflect",          char: "body" },
    { name: "Dodge",            char: "cunning" },
    { name: "Endure",           char: "body" },
    { name: "Evade",            char: "awareness" },
    { name: "Initiative",       char: "awareness" },
    { name: "Riposte",          char: "cunning" },
    { name: "Resist",           char: "presence" },
    { name: "Ward",             char: "intelligence" },
  ],

  noncombat: [
    { name: "Acrobatics",       char: "body" },
    { name: "Animal Handling",  char: "presence" },
    { name: "Arcane",           char: "intelligence" },
    { name: "Athletics",        char: "body" },
    { name: "Charm",            char: "presence" },
    { name: "Climb",            char: "body" },
    { name: "Disguise",         char: "cunning" },
    { name: "Divine",           char: "intelligence" },
    { name: "Insight",          char: "awareness" },
    { name: "Intimidation",     char: "presence" },
    { name: "Lie",              char: "cunning" },
    { name: "Medicine",         char: "intelligence" },
    { name: "Nature",           char: "intelligence" },
    { name: "Observe",          char: "awareness" },
    { name: "Occult",           char: "intelligence" },
    { name: "Sneaking",         char: "cunning" },
    { name: "Society",          char: "intelligence" },
    { name: "Swimming",         char: "body" },
    { name: "Thievery",         char: "cunning" },
    { name: "Wilderness",       char: "awareness" },
  ],
};

// Open-ended proficiency lists on the character sheet. `costKey` picks the
// step-cost array in CONFIG.SKILL_COSTS; `pool` picks which exp they draw from.
// `suggestions` populate an autocomplete list (purely a convenience).
window.PROFICIENCY_KINDS = [
  {
    id: "crafting", label: "Crafting", costKey: "crafting", pool: "noncombat",
    suggestions: ["Smithing", "Jewelcrafting", "Tailoring", "Leatherworking",
      "Fletching", "Carpentry", "Clockwork", "Engineering", "Shipwright", "Alchemy"],
  },
  {
    id: "instrument", label: "Instrument", costKey: "instrument", pool: "noncombat",
    suggestions: ["Lute", "Flute", "Drums", "Fiddle", "Harp", "Horn", "Lyre",
      "Bagpipes", "Hurdy-gurdy", "Voice"],
  },
  {
    id: "weapon", label: "Weapon", costKey: "weapon", pool: "combat",
    suggestions: ["Dagger", "Shortsword", "Rapier", "Longsword", "Greatsword",
      "Spear", "Quarterstaff", "Mace", "Warhammer", "Handaxe", "Greataxe",
      "Shortbow", "Longbow", "Light Crossbow", "Heavy Crossbow", "Sling"],
  },
  {
    // Named after a magical domain (e.g. "Elemental"); its tier drives that
    // domain's spell-test pool and which spell tiers are castable — see
    // Engine.spellcastingLevel / spellRequirementStatus. Suggestions are
    // filled in at render time from the magical domains that exist, not
    // hardcoded here (unlike the other kinds' static lists).
    id: "spellcasting", label: "Spellcasting", costKey: "weapon", pool: "combat",
    suggestions: [],
  },
];
