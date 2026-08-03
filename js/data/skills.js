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
    // A weapon proficiency is bought per category (main.tex "Weapons"), not
    // per individual weapon — the specific weapon within a category is a
    // cosmetic choice, not a mechanical one. These 11 are the full set.
    id: "weapon", label: "Weapon", costKey: "weapon", pool: "combat",
    suggestions: ["Light Blades", "Heavy Blades", "Axes", "Maces", "Polearms",
      "Whips", "Staves", "Bows", "Crossbows", "Light Throwing Weapons",
      "Heavy Throwing Weapons"],
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

// The 11 weapon categories (main.tex "Weapons"), with the mechanics fixed per
// category: `characteristic` drives the attack roll and damage bonus,
// `hands` is "1h" | "2h" | "either" (a per-weapon choice on the inventory
// section for "either" categories). `range` is "melee" or a number of yards;
// `ranged` is whether it counts as Ranged for the melee-adjacency Risk rule
// (a numeric `range` with `ranged: false` is Reach — still a melee weapon,
// just from further away). Label must match a PROFICIENCY_KINDS "weapon"
// suggestion exactly, since that's how a carried weapon on the inventory
// section looks up the character's trained tier.
window.WEAPON_CATEGORIES = [
  { id: "light_blades",   label: "Light Blades",           characteristic: "cunning", hands: "1h",    range: "melee", ranged: false },
  { id: "heavy_blades",   label: "Heavy Blades",           characteristic: "body",    hands: "either", range: "melee", ranged: false },
  { id: "axes",           label: "Axes",                   characteristic: "body",    hands: "either", range: "melee", ranged: false },
  { id: "maces",          label: "Maces",                  characteristic: "body",    hands: "either", range: "melee", ranged: false },
  { id: "polearms",       label: "Polearms",               characteristic: "body",    hands: "2h",    range: 4,       ranged: false },
  { id: "whips",          label: "Whips",                  characteristic: "cunning", hands: "1h",    range: 6,       ranged: false },
  { id: "staves",         label: "Staves",                 characteristic: "body",    hands: "2h",    range: "melee", ranged: false },
  { id: "bows",           label: "Bows",                   characteristic: "cunning", hands: "2h",    range: 30,      ranged: true },
  { id: "crossbows",      label: "Crossbows",              characteristic: "cunning", hands: "either", range: 30,      ranged: true },
  { id: "light_throwing", label: "Light Throwing Weapons", characteristic: "cunning", hands: "1h",    range: 20,      ranged: true },
  { id: "heavy_throwing", label: "Heavy Throwing Weapons", characteristic: "body",    hands: "1h",    range: 20,      ranged: true },
];
