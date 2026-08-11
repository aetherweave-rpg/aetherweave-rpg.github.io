// ============================================================================
// Spells page (spells.html) — a casting reference, one magical domain at a
// time. Spells are bought on the Talent Trees page now: they are nodes in
// their domain's tree, sharing its grid, tier bands and prerequisite lines
// (§4.6). So this page stopped being a second place to spend exp and became
// the thing a caster actually wants mid-session: every spell in the domain,
// grouped by tier, with the numbers you need to cast it and the rules text one
// click away.
//
// Read-only by design. Two surfaces that both learn and unlearn would mean two
// places to keep an eye on; the grid is where a purchase belongs, because that
// is where its prerequisites are visible.
// ============================================================================

(function () {
  var Engine = window.Engine, State = window.State, UI = window.UI, el = UI.el;
  var LAST_DOMAIN_KEY = "aetherweave.lastSpellDomain";

  var currentDomain = window.SafeStorage.read(LAST_DOMAIN_KEY) || null;
  var expanded = {};   // spell id -> true, while its rules text is open

  function init() {
    UI.renderHeader("spells");
    UI.renderFooter();
    UI.renderStorageWarning();
    UI.renderCreationGate();
    renderTabs();
    render();
    State.subscribe(function () { UI.renderHeader("spells"); renderTabs(); render(); });
  }

  function available() { return Engine.magicalDomains(); }

  function currentDomainObj() {
    var list = available();
    var d = list.filter(function (x) { return x.id === currentDomain; })[0];
    if (!d) { d = list[0]; if (d) currentDomain = d.id; }
    return d || null;
  }

  // ---- Tabs ---------------------------------------------------------------
  function renderTabs() {
    var host = document.getElementById("spell-tabs");
    if (!host) return;
    host.innerHTML = "";
    var list = available();
    var active = currentDomainObj();

    var section = el("div", "tab-group");
    section.appendChild(el("span", "tab-group-label", "Domains"));
    var row = el("div", "tab-row");
    list.forEach(function (d) {
      var b = el("button", "domain-tab" + (active && active.id === d.id ? " active" : ""));
      b.type = "button";
      b.style.setProperty("--accent", d.accent);
      b.appendChild(el("span", "domain-tab-icon", d.icon));
      b.appendChild(el("span", "domain-tab-name", d.name));
      b.title = d.name;
      b.onclick = function () {
        currentDomain = d.id;
        window.SafeStorage.write(LAST_DOMAIN_KEY, d.id);
        expanded = {};
        renderTabs();
        render();
      };
      row.appendChild(b);
    });
    section.appendChild(row);
    host.appendChild(section);

    if (!list.length) host.appendChild(el("div", "empty", "No magical domains defined yet."));
  }

  // ---- The reference ------------------------------------------------------
  function render() {
    var host = document.getElementById("spell-reference");
    if (!host) return;
    host.innerHTML = "";

    var state = State.get();
    var domain = currentDomainObj();
    if (!domain) {
      host.appendChild(el("div", "empty", "No magical domains defined yet."));
      return;
    }
    host.style.setProperty("--accent", domain.accent);

    var spells = Engine.spellsForDomain(domain.id);
    host.appendChild(domainHeader(domain, spells, state));

    if (!spells.length) {
      host.appendChild(el("div", "empty", "No spells defined for this domain yet."));
      return;
    }

    // Grouped by tier ascending: the tier IS the Spellcasting proficiency you
    // need, so the groups read as "what I can cast now" then "what is next".
    var tiers = [];
    spells.forEach(function (sp) { if (tiers.indexOf(sp.tier || 1) < 0) tiers.push(sp.tier || 1); });
    tiers.sort(function (a, b) { return a - b; });

    var ladder = Engine.spellcastingLevel(state, domain.id);
    tiers.forEach(function (tier) {
      var mana = Engine.spellManaCost({ tier: tier });
      var block = el("div", "spell-tier-block");
      var head = el("div", "spell-tier-head" + (ladder >= tier ? " reached" : ""));
      head.appendChild(el("span", "sth-name", "Tier " + tier));
      head.appendChild(el("span", "sth-sub", "Spellcasting " + tier));
      head.appendChild(el("span", "sth-mana", mana ? mana + " mana to cast" : "cantrip, no mana"));
      block.appendChild(head);

      spells.filter(function (sp) { return (sp.tier || 1) === tier; })
        .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); })
        .forEach(function (raw) { block.appendChild(spellRow(raw, state, domain)); });

      host.appendChild(block);
    });

    host.appendChild(el("div", "sheet-hint",
      "Spells are learned on the Talent Trees page, in this domain's own tree."));
  }

  function domainHeader(domain, spells, state) {
    var head = el("div", "tree-head");
    var title = el("div", "tree-head-main");
    title.appendChild(el("span", "tree-head-icon", domain.icon));
    var txt = el("div");
    txt.appendChild(el("div", "tree-head-name", domain.name));
    if (domain.flavour) txt.appendChild(el("div", "tree-head-desc", domain.flavour));
    title.appendChild(txt);
    head.appendChild(title);

    var tags = el("div", "tree-head-tags");
    var pool = Engine.spellPool(state, domain.id);
    tags.appendChild(el("span", "tree-tag caster-tag", pool.charKey
      ? "Spell test: " + Engine.charLabel(pool.charKey) + " (" + pool.charVal + ") + Spellcasting (" + pool.ladder + ") = " + pool.total + " dice"
      : "Spellcasting +" + pool.ladder + " · set a source characteristic in the editor"));

    var known = spells.filter(function (sp) { return Engine.spellOwned(state, sp.id); }).length;
    tags.appendChild(el("span", "tree-tag" + (known ? " ok" : ""), known + " of " + spells.length + " known"));
    head.appendChild(tags);
    return head;
  }

  // One spell: what it costs to cast, whether you have it, and its rules text
  // behind a click.
  function spellRow(raw, state, domain) {
    var sp = Engine.effective(raw, state);   // a modifier may reshape a spell
    var status = Engine.spellRequirementStatus(sp, state);
    var isOpen = !!expanded[sp.id];
    var known = status.owned;

    var row = el("div", "talent-row spell-sheet-row expandable" +
      (known && !status.met ? " invalid" : "") + (isOpen ? " expanded" : "") +
      (known ? " known" : status.met ? " learnable" : " unavailable"));
    row.dataset.id = sp.id;
    row.appendChild(el("span", "talent-icon", sp.icon || (sp.name || "?").charAt(0)));

    var info = el("div", "talent-info");
    var nameLine = el("span", "talent-name", sp.name);
    nameLine.appendChild(el("span", "spell-tier-tag", "T" + (sp.tier || 1)));
    var mana = Engine.spellManaCost(sp);
    nameLine.appendChild(el("span", "spell-mana-tag" + (mana ? "" : " cantrip"), mana ? mana + " mana" : "cantrip"));
    nameLine.appendChild(el("span", "spell-status-tag " + (known ? "known" : status.met ? "learnable" : "locked"),
      known ? "Known" : status.met ? "Can learn" : "Locked"));
    if (sp.description || sp.flavour) nameLine.appendChild(el("span", "talent-expand-icon", isOpen ? "▾" : "▸"));
    info.appendChild(nameLine);

    info.appendChild(el("span", "talent-meta", [
      Engine.castingTimeLabel(sp), Engine.rangeLabel(sp), Engine.targetLabel(sp),
      Engine.durationLabel(sp), Engine.aoeLabel(sp),
    ].filter(Boolean).join(" · ")));

    info.appendChild(el("span", "talent-meta",
      (sp.cost || 0) + " " + Engine.poolLabel(sp.pool) + " exp to learn"));

    // Why it is not castable: the automatic Spellcasting gate plus whatever the
    // spell itself requires. Shown for a locked spell and for a known one whose
    // requirements have since been broken by a sheet edit.
    if (!status.met) {
      var why = status.reasons.filter(function (r) { return !Engine.reasonMet(r); })
        .map(function (r) { return r.label; }).join(", ");
      info.appendChild(el("span", known ? "talent-invalid-note" : "talent-meta locked-note",
        (known ? "⚠ requirements no longer met: " : "Needs ") + why));
    }

    if (isOpen && (sp.flavour || sp.description)) {
      var desc = el("div", "talent-desc");
      if (sp.flavour) desc.appendChild(el("div", "talent-flavour", Engine.resolveText(sp.flavour, state)));
      if (sp.description) desc.appendChild(el("div", "talent-desc-text", Engine.resolveText(sp.description, state)));
      info.appendChild(desc);
    }
    row.appendChild(info);

    row.onclick = function () {
      if (expanded[sp.id]) delete expanded[sp.id]; else expanded[sp.id] = true;
      render();
    };
    return row;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
