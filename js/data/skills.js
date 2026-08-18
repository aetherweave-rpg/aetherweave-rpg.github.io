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
    // cosmetic choice, not a mechanical one. These 12 are the full set.
    id: "weapon", label: "Weapon", costKey: "weapon", pool: "combat",
    suggestions: ["Light Blades", "Heavy Blades", "Axes", "Maces", "Polearms",
      "Whips", "Staves", "Bows", "Crossbows", "Light Throwing Weapons",
      "Heavy Throwing Weapons", "Unarmed"],
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

// Defenses (main.tex "NPC Defenses"). A player character defends by rolling one
// of their own skills reactively; an NPC does not roll at all. Its statblock
// carries one blanket defense value, plus a separate entry for any defense that
// is exceptional, and the GM SUBTRACTS that value from the successes the player
// states. Whatever is left is what the ability's success tiers are read against
// (site/DESIGN.md §4.10), so a defense is a number taken off a roll, not a
// threshold the roll has to beat.
//
// `replaces` names the player skill each one stands in for, straight from the
// rulebook table. Physical is deliberately three entries rather than one: the
// damage types the content already deals (bludgeoning / slashing / piercing)
// are exactly the distinctions armour and hide make, so one "Physical" number
// could not express a creature that shrugs off a mace but not a blade.
window.DEFENSES = [
  { id: "bludgeoning", label: "Bludgeoning", replaces: ["Deflect", "Dodge", "Evade"], covers: "Maces, staves, falls, crushing blows" },
  { id: "slashing",    label: "Slashing",    replaces: ["Deflect", "Dodge", "Evade"], covers: "Blades, axes, claws" },
  { id: "piercing",    label: "Piercing",    replaces: ["Deflect", "Dodge", "Evade"], covers: "Arrows, bolts, spears, bites" },
  { id: "fortitude",   label: "Fortitude",   replaces: ["Endure"],  covers: "Poison, disease, suffocation, exhaustion" },
  { id: "mental",      label: "Mental",      replaces: ["Resist"],  covers: "Fear, charm, domination, mind-affecting" },
  { id: "fire",        label: "Fire",        replaces: ["Ward"],    covers: "Elemental domain: flame" },
  { id: "cold",        label: "Cold",        replaces: ["Ward"],    covers: "Elemental domain: frost" },
  { id: "lightning",   label: "Lightning",   replaces: ["Ward"],    covers: "Elemental domain: storm" },
  { id: "acid",        label: "Acid",        replaces: ["Ward"],    covers: "Corrosives, alchemical burns" },
  { id: "arcane",      label: "Arcane",      replaces: ["Ward"],    covers: "Aether and force effects, non-elemental conjuration" },
  { id: "blight",      label: "Blight",      replaces: [],          covers: "Death domain: decay and drain" },
  { id: "radiant",     label: "Radiant",     replaces: [],          covers: "Life and Light domains: holy and vital energy" },
];

// The 12 weapon categories (main.tex "Weapons"), with the mechanics fixed per
// category: `characteristic` drives the attack roll and damage bonus,
// `hands` is "1h" | "2h" | "either" (a per-weapon choice on the inventory
// section for "either" categories). `range` is "melee" or a number of yards;
// `ranged` is whether it counts as Ranged for the melee-adjacency Risk rule
// (a numeric `range` with `ranged: false` is Reach — still a melee weapon,
// just from further away). Label must match a PROFICIENCY_KINDS "weapon"
// suggestion exactly, since that's how a carried weapon on the inventory
// section looks up the character's trained tier.
//
// `damage` lists the DEFENSES a weapon of this category can be aimed at. It is
// a list rather than a value because a category is not one weapon: a light
// blade may thrust or cut, and a heavy throwing weapon may be a javelin, a
// hand axe or a hammer. Where a category offers several, the choice belongs to
// the specific weapon on the character's sheet, exactly as `hands: "either"`
// already puts the one/two-handed choice there. The first entry is the default
// for a newly added weapon.
window.WEAPON_CATEGORIES = [
  { id: "light_blades",   label: "Light Blades",           characteristic: "cunning", hands: "1h",    range: "melee", ranged: false, damage: ["slashing", "piercing"] },
  { id: "heavy_blades",   label: "Heavy Blades",           characteristic: "body",    hands: "either", range: "melee", ranged: false, damage: ["slashing"] },
  { id: "axes",           label: "Axes",                   characteristic: "body",    hands: "either", range: "melee", ranged: false, damage: ["slashing"] },
  { id: "maces",          label: "Maces",                  characteristic: "body",    hands: "either", range: "melee", ranged: false, damage: ["bludgeoning"] },
  { id: "polearms",       label: "Polearms",               characteristic: "body",    hands: "2h",    range: 4,       ranged: false, damage: ["piercing", "slashing", "bludgeoning"] },
  { id: "whips",          label: "Whips",                  characteristic: "cunning", hands: "1h",    range: 6,       ranged: false, damage: ["slashing"] },
  { id: "staves",         label: "Staves",                 characteristic: "body",    hands: "2h",    range: "melee", ranged: false, damage: ["bludgeoning"] },
  { id: "bows",           label: "Bows",                   characteristic: "cunning", hands: "2h",    range: 30,      ranged: true,  damage: ["piercing"] },
  { id: "crossbows",      label: "Crossbows",              characteristic: "cunning", hands: "either", range: 30,      ranged: true,  damage: ["piercing"] },
  { id: "light_throwing", label: "Light Throwing Weapons", characteristic: "cunning", hands: "1h",    range: 20,      ranged: true,  damage: ["piercing", "slashing", "bludgeoning"] },
  { id: "heavy_throwing", label: "Heavy Throwing Weapons", characteristic: "body",    hands: "1h",    range: 20,      ranged: true,  damage: ["piercing", "slashing", "bludgeoning"] },
  // Everyone has fists. Unarmed is a category like any other so that it can be
  // trained, priced and rolled the same way — and so an ability that says "make an
  // unarmed attack" has a proficiency to name.
  { id: "unarmed",        label: "Unarmed",                characteristic: "body",    hands: "1h",    range: "melee", ranged: false, damage: ["bludgeoning"] },
];
