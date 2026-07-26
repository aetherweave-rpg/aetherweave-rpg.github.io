// ============================================================================
// Character state — one character, shared by both pages, saved in localStorage.
// ----------------------------------------------------------------------------
// This is application code; you shouldn't need to edit it to change game data.
// ============================================================================

(function () {
  var STORAGE_KEY = "aetherweave.character.v1";

  // ---- Storage adapter ----------------------------------------------------
  // localStorage is the right home for a saved character, but browsers block it
  // for pages opened straight from disk: a file:// document is an opaque origin
  // in Firefox, and touching localStorage there throws SecurityError. Swallowing
  // that leaves the app silently amnesiac — finish character creation, navigate
  // to another page, and it has forgotten everything.
  //
  // So: probe once, and fall back to window.name, which survives navigation
  // within the same tab, needs no permissions, and works on file://. Pages can
  // then hand the finished character to each other even with storage blocked.
  // `persistent` reports whether anything will outlive the tab, so the UI can
  // warn instead of quietly losing work.
  var SafeStorage = (function () {
    var PREFIX = "AETHERWEAVE_STATE:";

    function localStorageWorks() {
      try {
        var k = "__aw_probe__";
        localStorage.setItem(k, "1");
        var ok = localStorage.getItem(k) === "1";
        localStorage.removeItem(k);
        return ok;
      } catch (e) { return false; }
    }

    var mode = localStorageWorks() ? "local" : "window-name";
    var memory = {};

    function readBag() {
      try {
        var n = window.name || "";
        if (n.indexOf(PREFIX) !== 0) return {};
        return JSON.parse(n.slice(PREFIX.length)) || {};
      } catch (e) { return {}; }
    }
    function writeBag(bag) {
      try { window.name = PREFIX + JSON.stringify(bag); return true; }
      catch (e) { return false; }
    }

    return {
      mode: mode,
      persistent: mode === "local",
      read: function (key) {
        if (mode === "local") {
          try { return localStorage.getItem(key); } catch (e) { /* fall through */ }
        }
        var bag = readBag();
        if (Object.prototype.hasOwnProperty.call(bag, key)) return bag[key];
        return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
      },
      write: function (key, value) {
        if (mode === "local") {
          try { localStorage.setItem(key, value); return true; } catch (e) { /* fall through */ }
        }
        memory[key] = value;
        var bag = readBag();
        bag[key] = value;
        return writeBag(bag);
      },
    };
  })();

  window.SafeStorage = SafeStorage;

  function defaultState() {
    var chars = {};
    (window.CONFIG.CHARACTERISTICS || []).forEach(function (c) { chars[c.key] = 0; });

    var skills = {};
    ["combat", "noncombat"].forEach(function (grp) {
      (window.SKILLS[grp] || []).forEach(function (s) { skills[s.name] = 0; });
    });

    return {
      version: 2,
      identity: { characterName: "", playerName: "", ancestry: "", sourceOfPower: "", concept: "", notes: "" },
      hp: { max: "", current: "" },
      characteristics: chars,
      expEarned: {
        combat: window.CONFIG.STARTING_EXP.combat,
        noncombat: window.CONFIG.STARTING_EXP.noncombat,
      },
      skills: skills,          // display name -> CURRENT tier 0..4 (granted included)
      proficiencies: [],       // [{ name, kind, tier }]  (granted included)
      talents: [],             // owned talent ids (granted included)

      // What the character-creation wizard chose.
      creation: {
        completed: false,
        skipped: false,        // "skip for now" — stops the wizard nagging
        ancestry: null,        // ancestry id  -> reveals that ancestral tree
        source: null,          // source of power id
      },

      // The free baseline handed out during creation. Everything here costs no
      // exp: exp spent is computed as (current totals - this baseline), and
      // granted talents are excluded from cost and from the tree surcharge.
      granted: {
        talents: [],           // free talent ids
        skills: {},            // skill name  -> free tier
        proficiencies: {},     // prof name   -> free tier
        characteristics: null, // set at creation; the fixed starting array
      },

      // Characteristics are otherwise not editable. Each tier of play after the
      // first lets the character raise 2 DIFFERENT characteristics by one;
      // picks are recorded per tier so "different" can be enforced.
      //   { "2": ["body", "cunning"], "3": [...] }
      charAdvances: {},
    };
  }

  // `characteristics` is derived, not authored: it is always
  // granted.characteristics plus one per charAdvances pick. Recomputing after
  // every mutation keeps the value every other reader uses correct without
  // making it a second source of truth that can drift.
  function syncCharacteristics(s) {
    var base = s.granted && s.granted.characteristics;
    if (!base) return;                       // pre-creation: leave as authored
    var adv = s.charAdvances || {};
    (window.CONFIG.CHARACTERISTICS || []).forEach(function (c) {
      var v = base[c.key] || 0;
      Object.keys(adv).forEach(function (tier) {
        (adv[tier] || []).forEach(function (k) { if (k === c.key) v++; });
      });
      s.characteristics[c.key] = v;
    });
  }

  // Merge a loaded save over defaults so newly-added skills / characteristics
  // appear for older saves, and missing sections are backfilled.
  function migrate(s) {
    var def = defaultState();
    if (!s || typeof s !== "object") return def;
    var merged = Object.assign({}, def, s);
    merged.identity        = Object.assign({}, def.identity, s.identity);
    merged.hp              = Object.assign({}, def.hp, s.hp);
    merged.characteristics = Object.assign({}, def.characteristics, s.characteristics);
    merged.expEarned       = Object.assign({}, def.expEarned, s.expEarned);
    merged.skills          = Object.assign({}, def.skills, s.skills);
    merged.proficiencies   = Array.isArray(s.proficiencies) ? s.proficiencies : [];
    merged.talents         = Array.isArray(s.talents) ? s.talents : [];
    merged.creation        = Object.assign({}, def.creation, s.creation);
    merged.granted         = Object.assign({}, def.granted, s.granted);
    merged.granted.talents       = Array.isArray(merged.granted.talents) ? merged.granted.talents : [];
    merged.granted.skills        = merged.granted.skills || {};
    merged.granted.proficiencies = merged.granted.proficiencies || {};
    merged.charAdvances          = s.charAdvances || {};
    syncCharacteristics(merged);
    return merged;
  }

  function load() {
    try {
      var raw = SafeStorage.read(STORAGE_KEY);
      if (raw) return migrate(JSON.parse(raw));
    } catch (e) {
      console.warn("Aetherweave: failed to load saved character:", e);
    }
    return defaultState();
  }

  var state = load();
  var listeners = [];

  function save() {
    try { SafeStorage.write(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { console.warn("Aetherweave: failed to save character:", e); }
  }

  function notify() {
    listeners.slice().forEach(function (fn) {
      try { fn(state); } catch (e) { console.error(e); }
    });
  }

  window.State = {
    get: function () { return state; },

    // Apply a mutation. Pass silent=true to persist without re-rendering
    // (used for text inputs so typing doesn't rebuild the page under the cursor).
    update: function (mutator, silent) {
      mutator(state);
      syncCharacteristics(state);
      save();
      if (!silent) notify();
    },

    // Force a save + re-render (used on input blur after silent updates).
    notify: function () { save(); notify(); },

    set: function (newState) { state = migrate(newState); save(); notify(); },

    reset: function () { state = defaultState(); save(); notify(); },

    subscribe: function (fn) {
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (l) { return l !== fn; }); };
    },
  };
})();
