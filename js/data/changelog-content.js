// ============================================================================
// CONTENT CHANGELOG  (EDITABLE DATABASE — normally written by the pre-commit
// hook, see .githooks/)
// ----------------------------------------------------------------------------
// Player-visible changes to talents, skills, ancestries, spells, and anything
// else on the character sheet / talent trees. NOT implementation details
// (refactors, layout/row/col-only tweaks, test changes, etc. don't belong
// here — see .githooks/pre-commit.ps1 for what triggers a draft entry).
//
// Newest entry first. Each entry:
//   { date: "YYYY-MM-DD", entries: ["one bullet per change", ...] }
// ============================================================================

window.CHANGELOG_CONTENT = [
  {
    date: "2026-08-04",
    entries: [
      "Changed talent \"Arsenal\" (tier 1) in the Invention domain: description: \"You can add up to {inve_arsenal:\"2\"} of the following additi...\" -> \"You throw an improvised contraption at a point in range. It...\"; uses: (none) -> 2.",
      "Added talent \"Material Hoarder\" (tier 1) to the Invention domain.",
      "Added talent \"Well-prepared\" (tier 1) to the Invention domain.",
      "Added talent \"Material Knowledge: Sticky\" (tier 1) to the Invention domain.",
      "Added talent \"Material Knowledge: Bouncy\" (tier 1) to the Invention domain.",
      "Added talent \"Complicated Contraption\" (tier 2) to the Invention domain.",
      "Changed site/public/js/config.js -- describe the effect on players (costs / caps / thresholds / creation points).",
      "Changed site/public/js/data/creation.js -- describe the effect on players (costs / caps / thresholds / creation points).",
    ],
  },
  {
    date: "2026-08-03",
    entries: [
      "Added talent \"Arsenal\" (tier 1) to the Invention domain.",
    ],
  },
  {
    date: "2026-08-03",
    entries: [
      "Changed talent \"Ricochet\" (tier 1) in the Arms domain: requires: \"proficiencies Throwing Weapons 2\" -> \"proficiencies Heavy Throwing Weapons 2\".",
      "Removed skill/proficiency \"Riposte\".",
      "Changed site/public/js/config.js -- describe the effect on players (costs / caps / thresholds / creation points).",
    ],
  },
  {
    date: "2026-08-03",
    entries: [
      "Removed skill/proficiency \"Riposte\".",
    ],
  },
  {
    date: "2026-08-03",
    entries: [
      "Changed talent \"Ricochet\" (tier 1) in the Arms domain: description: \"You can hit multiple enemies with a single throw of your wea...\" -> \"Make an attack with your throwing weapon against an enemy in...\"; ability: (none) -> \"maneuver\"; uses: (none) -> 2; castingTime: (none) -> \"action\"; range: (none) -> \"weapon\"; duration: (none) -> \"instantaneous\"; requires: \"characteristics cunning 2; proficiencies Throwing Weapons 2\" -> \"proficiencies Throwing Weapons 2\".",
      "Changed talent \"Advanced Ricochet\" (tier 1) in the Arms domain: ability: (none) -> \"modifier\".",
      "Added talent \"Frost arrow\" (tier 1) to the Elemental Arms combination tree.",
      "Added talent \"Flaming arrow\" (tier 1) to the Elemental Arms combination tree.",
      "Added talent \"Lightning arrow\" (tier 1) to the Elemental Arms combination tree.",
      "Added talent \"Elemental shot\" (tier 1) to the Elemental Arms combination tree.",
    ],
  },
  {
    date: "2026-08-03",
    entries: [
      "Changed talent \"Ricochet\" (tier 1) in the Arms domain: description: wording changed (both start \"You can hit multiple enemies with a sing...\").",
    ],
  },
  {
    date: "2026-08-03",
    entries: [
      "Spellcasting proficiency is now no longer part of the talent system, but listed as a combat proficiency.",
    ],
  },
  {
    date: "2026-08-02",
    entries: [
      "Added spell \"Ethereal Ward\" (tier 1) to the Aether domain.",
    ],
  },
];
