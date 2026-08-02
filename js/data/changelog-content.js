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
    date: "2026-08-02",
    entries: [
      "Added spell \"Ethereal Ward\" (tier 1) to the Aether domain.",
    ],
  },
];
