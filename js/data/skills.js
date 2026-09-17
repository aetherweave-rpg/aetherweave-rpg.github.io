// ============================================================================
// Skills & proficiency kinds  (EDITABLE DATABASE)
// ----------------------------------------------------------------------------
// `char` is the paired characteristic key (from CONFIG.CHARACTERISTICS). It's
// shown as an abbreviation on the sheet; it does not gate anything by itself.
// A skill that took in another when the two were merged keeps both
// characteristics as a list, and the sheet lists it under each of them. Which
// one a roll adds is named by what calls for the roll: a poison calls for
// Body + Resist, a charm for Presence + Resist (main.tex "Defending as a
// player character").
//
// `formerly` lists names a skill used to go by, so a saved character's ranks
// follow it through a rename or a merge (state.js). A merge keeps the better
// of the two ranks.
//
// Combat skills draw from COMBAT exp; everything else from NON-COMBAT exp.
// ============================================================================

window.SKILLS = {
  combat: [
    { name: "Deflect",          char: ["body", "intelligence"], formerly: ["Ward"] },
    { name: "Dodge",            char: ["awareness", "cunning"], formerly: ["Evade"] },
    { name: "Initiative",       char: "awareness" },
    { name: "Resist",           char: ["body", "presence"],     formerly: ["Endure"] },
  ],

  noncombat: [
    { name: "Acrobatics",                char: "body" },
    { name: "Animal Handling",           char: "presence" },
    { name: "Charm",                     char: "presence" },
    { name: "Climb",                     char: "body" },
    { name: "Deceive",                   char: "cunning",      formerly: ["Lie"] },
    { name: "Disguise",                  char: "cunning" },
    { name: "Entertain",                 char: "presence" },
    { name: "Insight",                   char: "awareness" },
    { name: "Intimidation",              char: "presence" },
    { name: "Knowledge: Arcane",         char: "intelligence", formerly: ["Arcane"] },
    { name: "Knowledge: Divine",         char: "intelligence", formerly: ["Divine"] },
    { name: "Knowledge: Natural World",  char: "intelligence", formerly: ["Nature"] },
    { name: "Knowledge: Occult",         char: "intelligence", formerly: ["Occult"] },
    { name: "Knowledge: Society",        char: "intelligence", formerly: ["Society"] },
    { name: "Listen",                    char: "awareness" },
    { name: "Medicine",                  char: "intelligence" },
    { name: "Observe",                   char: "awareness" },
    { name: "Persuasion",                char: "presence" },
    { name: "Sail",                      char: "awareness" },
    { name: "Search",                    char: "awareness" },
    { name: "Sneak",                     char: "cunning",      formerly: ["Sneaking"] },
    { name: "Strength",                  char: "body",         formerly: ["Athletics"] },
    { name: "Survival",                  char: "awareness",    formerly: ["Wilderness"] },
    { name: "Swim",                      char: "body",         formerly: ["Swimming"] },
    { name: "Thievery",                  char: "cunning" },
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
    // Named after a magical domain (e.g. "Elemental"); its tier is the skill
    // half of that domain's spellcasting roll, and it gates nothing — see
    // Engine.spellcastingPool. Suggestions are filled in at render time from
    // the magical domains that exist, not hardcoded here (unlike the other
    // kinds' static lists).
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
// `replaces` names the player defense rolls each one stands in for, straight
// from the rulebook table: a defensive skill together with the characteristic
// it is rolled with, since Deflect, Dodge and Resist each pair with two and the
// pairing is what tells a poison (Body + Resist) from a charm (Presence +
// Resist). Physical is deliberately three entries rather than one: the damage
// types the content already deals (bludgeoning / slashing / piercing) are
// exactly the distinctions armour and hide make, so one "Physical" number could
// not express a creature that shrugs off a mace but not a blade.
window.DEFENSES = [
  { id: "bludgeoning", label: "Bludgeoning", covers: "Maces, staves, falls, crushing blows",
    replaces: [{ skill: "Deflect", char: "body" }, { skill: "Dodge", char: "awareness" }, { skill: "Dodge", char: "cunning" }] },
  { id: "slashing",    label: "Slashing",    covers: "Blades, axes, claws",
    replaces: [{ skill: "Deflect", char: "body" }, { skill: "Dodge", char: "awareness" }, { skill: "Dodge", char: "cunning" }] },
  { id: "piercing",    label: "Piercing",    covers: "Arrows, bolts, spears, bites",
    replaces: [{ skill: "Deflect", char: "body" }, { skill: "Dodge", char: "awareness" }, { skill: "Dodge", char: "cunning" }] },
  { id: "fortitude",   label: "Fortitude",   covers: "Poison, disease, suffocation, exhaustion",
    replaces: [{ skill: "Resist", char: "body" }] },
  { id: "mental",      label: "Mental",      covers: "Fear, charm, domination, mind-affecting",
    replaces: [{ skill: "Resist", char: "presence" }] },
  { id: "fire",        label: "Fire",        covers: "Elemental domain: flame",
    replaces: [{ skill: "Deflect", char: "intelligence" }] },
  { id: "cold",        label: "Cold",        covers: "Elemental domain: frost",
    replaces: [{ skill: "Deflect", char: "intelligence" }] },
  { id: "lightning",   label: "Lightning",   covers: "Elemental domain: storm",
    replaces: [{ skill: "Deflect", char: "intelligence" }] },
  { id: "acid",        label: "Acid",        covers: "Corrosives, alchemical burns",
    replaces: [{ skill: "Deflect", char: "intelligence" }] },
  { id: "arcane",      label: "Arcane",      covers: "Aether and force effects, non-elemental conjuration",
    replaces: [{ skill: "Deflect", char: "intelligence" }] },
  { id: "blight",      label: "Blight",      covers: "Death domain: decay and drain",
    replaces: [] },
  { id: "radiant",     label: "Radiant",     covers: "Life and Light domains: holy and vital energy",
    replaces: [] },
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
