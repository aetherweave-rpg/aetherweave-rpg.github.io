// ============================================================================
// LinkRouter — orthogonal routing for prerequisite links.
// ----------------------------------------------------------------------------
// The trees page, the Spells page and the editor all draw the same thing: an
// arrow from a prerequisite up to whatever it unlocks, over the same row/col
// grid. This is the one implementation the three of them share.
//
// The whole router rests on one rule: FREE SPACE IS MEASURED, NEVER INFERRED.
// The previous design derived a column pitch from the laid-out nodes and then
// synthesised candidate routing lines from that pitch. Anything that was not a
// standard talent box — a talent GROUP's dotted rectangle, say — poisoned the
// pitch, and with it every routing decision at once: on the shipped Invention
// tree the inferred pitch came out at 530px against a real 125px, which put
// the outermost routing lines at x = −184 and x = +2636 in a tree 1158px wide.
// Nothing downstream could recover from that, because nothing downstream knew
// where the free space actually was.
//
// Three stages, and each one owns exactly one question:
//
//   1. SPACE    — WHERE can a line go? Corridors are read off the boxes. A
//                 *free* corridor is a maximal interval of x that no icon box
//                 occupies at any row, so a run inside one can never be
//                 blocked and its capacity for parallel runs is a measured
//                 fact rather than a guess. A *column* corridor is the centre
//                 line of a column of boxes: the straight-ascent line, and the
//                 only place a link may leave or meet a node. Horizontal
//                 travel happens in row BANDS — the strip between one row's
//                 boxes and the captions of the row above.
//
//   2. TOPOLOGY — WHICH way does each link go? A shortest-path search over
//                 (corridor × band), costed by length, corners, corridor
//                 crowding, and two soft obstacles: a name/cost caption
//                 (expensive to clip) and a group's dotted box (mildly
//                 discouraged). An icon box is not a cost but a *missing
//                 edge*, so a line cannot cross one — the guarantee is
//                 structural instead of checked afterwards. The search always
//                 terminates and always succeeds: the two edge corridors are
//                 free by construction, so some path always exists.
//
//   3. NUDGE    — WHERE exactly? The search runs on corridor centre lines and
//                 one nominal lane per band, so parallel links come out on top
//                 of one another. One generic packer then separates them:
//                 along x inside a corridor, along y inside a band. Spacing
//                 alone is not enough — the ORDER is forced by geometry, since
//                 an end leaving the bundle towards the low side sweeps past
//                 every run below it. Those constraints are ordered
//                 topologically; a cycle among them is a crossing the layout
//                 genuinely forces rather than one the router picked. The same
//                 packer fans the stubs across a node's edge, so ports are not
//                 a separate mechanism with its own ordering bugs.
//
// **Bands need room the CSS cannot know about in advance.** A node with six
// dependents wants six lanes in one row band, and the stock 22px gap squeezes
// them to two pixels apart, which reads as one thick smear rather than six
// links. So `route` returns `gaps` alongside `routes`: the per-band lane
// demand. A caller is expected to widen the row spacing by `extra` and route
// again. Compressing is the fallback for a caller that cannot re-layout, not
// the intended path.
//
// A vertical link ends at the bottom of the whole target NODE, not at its icon
// box, because the name and cost sit between the two and a line run up to the
// box is a line drawn through that text.
//
// Pure geometry: boxes in, polylines out. No DOM, no state, no styling.
// ============================================================================

(function () {
  var DEFAULTS = {
    clearance: 6,       // hard margin kept clear around every icon box
    probe: 5,           // half-width a single run is tested with
    portSpacing: 9,     // between two runs sharing one corridor
    laneSpacing: 9,     // between two runs sharing one row band
    laneMargin: 12,     // clear space between the first lane and the boxes below
    portInset: 16,      // a port fan never reaches within this of a box's corners
    portSpan: 46,       // widest a fan may spread, however wide the box is
    minCorridor: 6,     // free space narrower than this is not a corridor at all
    tolerance: 4,       // closer than this, two parallel runs read as one line
    marginPad: 26,      // how far outside the outermost boxes the edge corridors sit
    bendCost: 26,       // per corner
    crowdCost: 6,       // per link already using a corridor
    fullCost: 110,      // per link beyond what a corridor can actually hold
    captionCost: 320,   // clipping a name/cost caption
    ghostCost: 45,      // crossing a talent group's dotted box
  };

  function cx(b) { return (b.left + b.right) / 2; }
  function cy(b) { return (b.top + b.bottom) / 2; }
  function pt(x, y) { return { x: x, y: y }; }
  function spans(a1, a2, b1, b2) { return Math.min(a2, b2) - Math.max(a1, b1) > 0; }
  function overlaps(a1, a2, b1, b2, slack) { return Math.min(a2, b2) - Math.max(a1, b1) > slack; }

  // A binary heap, because the graph grows with rows × columns and an O(n²)
  // scan starts to bite on a large tree once every link runs its own search.
  function Heap() { this.a = []; }
  Heap.prototype.size = function () { return this.a.length; };
  Heap.prototype.push = function (k, v) {
    var a = this.a, i = a.length;
    a.push({ k: k, v: v });
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (a[p].k <= a[i].k) break;
      var t = a[p]; a[p] = a[i]; a[i] = t; i = p;
    }
  };
  Heap.prototype.pop = function () {
    var a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      for (var i = 0; ;) {
        var l = 2 * i + 1, r = l + 1, m = i;
        if (l < a.length && a[l].k < a[m].k) m = l;
        if (r < a.length && a[r].k < a[m].k) m = r;
        if (m === i) break;
        var t = a[m]; a[m] = a[i]; a[i] = t; i = m;
      }
    }
    return top;
  };

  // nodes: [{ id, row, col, box, outer?, ghost? }] — box/outer are host-relative
  //        rects ({left,top,right,bottom}). `box` is the icon box links attach
  //        to; `outer` is the whole node incl. its name/cost.
  //        A `ghost` node can be linked to but is not an obstacle: a talent
  //        group is one, and treating its whole dotted rectangle as solid would
  //        wall off the middle of the tree. The members inside it are ordinary
  //        nodes and block on their own, which is the real constraint.
  // links: [{ from: <node id>, to: <node id>, via?: [{col,row}], ... }] —
  //        anything else rides along untouched on `.link`. `via` is a list of
  //        manual anchors in grid coordinates the route must pass through; see
  //        "manual anchors" below.
  // opts:  overrides for DEFAULTS, plus an optional `bounds: {left,right}` — the
  //        host's own width, so the edge corridors can use space the outermost
  //        node does not reach into (an empty last column, say).
  // → { gaps: { <band>: {row, lanes, have, need, extra} },
  //     routes: [{ link, points: [{x,y}...], chevron: {x,y,angle} }] }
  function route(nodes, links, opts) {
    var o = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      o[k] = (opts && opts[k] !== undefined) ? opts[k] : DEFAULTS[k];
    });

    var all = (nodes || []).slice();
    var byId = {};
    all.forEach(function (n) { byId[n.id] = n; });
    var solid = all.filter(function (n) { return !n.ghost; });

    // A link whose ends aren't both laid out here can't be drawn at all; the
    // caller renders those as requirement text instead.
    var items = (links || []).map(function (link, ix) {
      return { link: link, ix: ix, from: byId[link.from], to: byId[link.to] };
    }).filter(function (it) { return it.from && it.to && it.from !== it.to; });

    if (!items.length || !solid.length) return { gaps: {}, routes: [] };

    // ---- stage 1: space -----------------------------------------------------

    // Rows are indexed by the order they are DRAWN in, not by their authored
    // number: the renderers skip empty rows, so a tree with talents on rows 0
    // and 2 draws them adjacent. Indexing by the raw number would put a band in
    // empty space far off-screen.
    var byRow = {};
    solid.forEach(function (n) { (byRow[n.row] = byRow[n.row] || []).push(n); });
    var rowsDrawn = Object.keys(byRow).map(Number).sort(function (a, b) { return a - b; });
    var rowIdx = {};
    rowsDrawn.forEach(function (r, i) { rowIdx[r] = i; });
    var GAPS = rowsDrawn.length;   // band g is the space ABOVE drawn row g

    // A band is bounded below by its own row's boxes and above by the next
    // row's whole nodes, name and cost included — that strip is empty by
    // construction, which is why horizontal runs never need an obstacle test.
    // A group's dotted rectangle hangs below its lowest member, so the row
    // above a band can reach further down than its nodes do. Lanes have to
    // start below it, or the link that ends ON that rectangle arrives from
    // above and its arrow head points backwards, down into the box.
    var ghostByRow = {};
    all.forEach(function (n) {
      if (n.ghost) (ghostByRow[n.row] = ghostByRow[n.row] || []).push(n);
    });

    var bandCache = {};
    function band(g) {
      if (bandCache[g]) return bandCache[g];
      var below = byRow[rowsDrawn[g]] || [];
      var above = (byRow[rowsDrawn[g + 1]] || []).concat(ghostByRow[rowsDrawn[g + 1]] || []);
      var bottom = below.length
        ? Math.min.apply(null, below.map(function (n) { return n.box.top; }))
        : 0;
      var top = above.length
        ? Math.max.apply(null, above.map(function (n) { return (n.outer || n.box).bottom; }))
        : bottom - 120;
      return (bandCache[g] = { top: top, bottom: bottom, y: bottom - o.laneMargin });
    }
    function clampGap(g) { return Math.max(0, Math.min(GAPS - 1, g)); }

    // Two tiers of obstacle, because the layout genuinely has two. An icon box
    // is hard: crossing one is never acceptable, so it is removed from the
    // graph. A name/cost caption is soft: it is 118px wide against a 62px box,
    // so on a tight grid the captions of two neighbouring columns nearly touch
    // and forbidding them outright would leave whole trees unroutable. Clipping
    // one is a real cost, just a smaller one than drawing two links on top of
    // each other.
    var hardByRow = {}, softByRow = {};
    solid.forEach(function (n) {
      var outer = n.outer || n.box;
      (hardByRow[n.row] = hardByRow[n.row] || []).push(
        { left: n.box.left - o.clearance, right: n.box.right + o.clearance });
      if (outer.bottom > n.box.bottom + 1 || outer.left < n.box.left - 1)
        (softByRow[n.row] = softByRow[n.row] || []).push({ left: outer.left, right: outer.right });
    });
    var ghosts = all.filter(function (n) { return n.ghost; })
      .map(function (n) { return n.outer || n.box; });

    // Corridors: the vertical lines a run may travel along.
    var contentLeft = Infinity, contentRight = -Infinity;
    all.forEach(function (n) {
      var r = n.outer || n.box;
      contentLeft = Math.min(contentLeft, r.left);
      contentRight = Math.max(contentRight, r.right);
    });
    var bounds = (opts && opts.bounds) || {};
    bounds = {
      left: Math.min(bounds.left !== undefined ? bounds.left : Infinity, contentLeft - o.marginPad),
      right: Math.max(bounds.right !== undefined ? bounds.right : -Infinity, contentRight + o.marginPad),
    };

    var corridors = [];
    function addCorridor(x, lo, hi, kind) {
      corridors.push({ x: x, lo: Math.min(lo, x), hi: Math.max(hi, x), kind: kind });
    }

    // Free corridors: the complement of every icon box's x-projection. Nothing
    // in one can ever be blocked, whatever row a run passes through, and its
    // width is exactly how much parallel traffic it can take.
    var occupied = [];
    solid.map(function (n) { return [n.box.left - o.clearance, n.box.right + o.clearance]; })
      .sort(function (a, b) { return a[0] - b[0]; })
      .forEach(function (r) {
        var last = occupied[occupied.length - 1];
        if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
        else occupied.push([r[0], r[1]]);
      });
    // A free stretch much wider than a node is not one routing line, it is
    // several: a tree with a gap in the middle of it would otherwise funnel
    // everything crossing that gap onto a single line, and an anchor dropped
    // anywhere in the empty space would have nowhere to snap but its centre.
    // The unit is a whole node's width — measured, like everything else here.
    var nodeWidth = 0;
    solid.forEach(function (n) {
      var r = n.outer || n.box;
      nodeWidth = Math.max(nodeWidth, r.right - r.left);
    });
    nodeWidth = Math.max(nodeWidth, 4 * o.portSpacing);

    function addFree(a, b) {
      if (b - a < o.minCorridor) return;
      var n = Math.max(1, Math.round((b - a) / nodeWidth));
      for (var i = 0; i < n; i++) {
        var lo = a + (b - a) * i / n, hi = a + (b - a) * (i + 1) / n;
        addCorridor((lo + hi) / 2, lo + 2, hi - 2, "free");
      }
    }

    var cursor = bounds.left;
    occupied.forEach(function (r) {
      addFree(cursor, r[0]);
      cursor = Math.max(cursor, r[1]);
    });
    addFree(cursor, bounds.right);

    // Column corridors: one per distinct box centre, ghosts included so a group
    // gets its own arrival line. This is the only place a link may touch a
    // node, so its width is the port fan's width — never wider than the box.
    var seenCol = {};
    all.forEach(function (n) {
      var x = cx(n.box), key = Math.round(x);
      if (seenCol[key]) return;
      seenCol[key] = true;
      var half = Math.max(4, Math.min((n.box.right - n.box.left) - o.portInset, o.portSpan)) / 2;
      addCorridor(x, x - half, x + half, "column");
    });

    // A free corridor landing on a column's centre is the same line twice; the
    // column wins, because nodes anchor to it.
    corridors.sort(function (a, b) { return a.x - b.x; });
    var kept = [];
    corridors.forEach(function (c) {
      var last = kept[kept.length - 1];
      if (last && Math.abs(last.x - c.x) < 3) {
        if (c.kind === "column" && last.kind !== "column") {
          last.x = c.x; last.lo = c.lo; last.hi = c.hi; last.kind = "column";
        }
        return;
      }
      kept.push(c);
    });
    corridors = kept;

    // A free corridor's full width clears the icon boxes; only part of it also
    // clears the captions, which are nearly twice as wide. That inner strip is
    // the corridor's real comfortable width: runs are centred in it while they
    // fit, and it — not the outer width — is what the search treats as the
    // corridor's capacity, so the fourth link through a strip that only has
    // room for two goes somewhere else rather than clipping a name. Spilling
    // out to the full width is still allowed as a last resort, because clipping
    // a caption edge beats drawing two links on top of each other.
    var captionSpans = [];
    Object.keys(softByRow).forEach(function (r) {
      softByRow[r].forEach(function (s) { captionSpans.push([s.left - 2, s.right + 2]); });
    });
    corridors.forEach(function (c, i) {
      c.i = i;
      c.clearLo = c.lo; c.clearHi = c.hi;
      if (c.kind === "free") {
        // The widest caption-free stretch inside this corridor, preferring one
        // that still contains the corridor's own centre line.
        var cuts = [c.lo, c.hi];
        captionSpans.forEach(function (s) {
          if (s[0] > c.lo && s[0] < c.hi) cuts.push(s[0]);
          if (s[1] > c.lo && s[1] < c.hi) cuts.push(s[1]);
        });
        cuts.sort(function (a, b) { return a - b; });
        var bestLo = c.x, bestHi = c.x, bestW = -1;
        for (var k = 1; k < cuts.length; k++) {
          var lo = cuts[k - 1], hi = cuts[k], mid = (lo + hi) / 2;
          var covered = captionSpans.some(function (s) { return mid > s[0] && mid < s[1]; });
          if (covered) continue;
          var w = (hi - lo) + (mid >= c.lo && mid <= c.hi && lo <= c.x && hi >= c.x ? 1000 : 0);
          if (w > bestW) { bestW = w; bestLo = lo; bestHi = hi; }
        }
        if (bestW >= 0) { c.clearLo = bestLo; c.clearHi = bestHi; }
      }
      // How many runs this corridor can hold side by side before they start
      // reading as one thick line.
      c.capacity = Math.max(1, Math.floor((c.clearHi - c.clearLo) / o.portSpacing) + 1);
    });

    var portCorr = {};
    all.forEach(function (n) {
      var x = cx(n.box), best = 0, bd = Infinity;
      corridors.forEach(function (c, i) {
        var d = Math.abs(c.x - x);
        if (d < bd) { bd = d; best = i; }
      });
      portCorr[n.id] = best;
    });

    // What it costs a corridor to pass through one drawn row. Infinity means the
    // edge simply is not in the graph.
    var crossCache = {};
    function crossCost(ci, row) {
      var key = ci + "@" + row;
      if (crossCache[key] !== undefined) return crossCache[key];
      var x = corridors[ci].x, lo = x - o.probe, hi = x + o.probe, cost = 0;
      var hard = hardByRow[row] || [], soft = softByRow[row] || [], k;
      for (k = 0; k < hard.length; k++)
        if (spans(lo, hi, hard[k].left, hard[k].right)) { cost = Infinity; break; }
      if (cost !== Infinity)
        for (k = 0; k < soft.length; k++)
          if (spans(lo, hi, soft[k].left, soft[k].right)) cost += o.captionCost;
      return (crossCache[key] = cost);
    }

    // A group's dotted rectangle is a soft obstacle in both axes: a link would
    // rather go round it than through it, but being boxed in is not a failure.
    function ghostCost(x1, x2, y1, y2) {
      if (!ghosts.length) return 0;
      var lo = Math.min(x1, x2), hi = Math.max(x1, x2);
      var ty = Math.min(y1, y2), by = Math.max(y1, y2), n = 0;
      ghosts.forEach(function (g) {
        if (spans(lo - o.probe, hi + o.probe, g.left, g.right) && spans(ty, by, g.top, g.bottom)) n++;
      });
      return n * o.ghostCost;
    }

    // ---- classify -----------------------------------------------------------
    items.forEach(function (it) {
      if (it.from.row !== it.to.row) {
        it.kind = "vert";
      } else {
        var lo = Math.min(it.from.col, it.to.col), hi = Math.max(it.from.col, it.to.col);
        var blocked = (byRow[it.from.row] || []).some(function (n) { return n.col > lo && n.col < hi; });
        // Nothing can pass through the row, so a blocked one leaves over the
        // top and comes back down — routed exactly like a vertical link that
        // happens to start and finish in the same band.
        it.kind = blocked ? "hop" : "side";
      }
      it.gapFrom = clampGap(rowIdx[it.from.row]);
      it.gapTo = clampGap(it.kind === "hop" ? rowIdx[it.from.row] : rowIdx[it.to.row] - 1);
      it.rowSpan = Math.abs(it.to.row - it.from.row);
    });

    // Routing order is part of the result, so it comes from the data rather
    // than from iteration order. Short links go first: a one-row link has
    // exactly one good drawing (straight up its column) while a long one has
    // many, so letting the long one claim a column first would displace a link
    // that had no alternative.
    var routed = items.filter(function (it) { return it.kind !== "side"; });
    routed.sort(function (a, b) {
      return a.rowSpan - b.rowSpan ||
             a.from.row - b.from.row || a.from.col - b.from.col ||
             a.to.row - b.to.row || a.to.col - b.to.col ||
             (a.link.from < b.link.from ? -1 : a.link.from > b.link.from ? 1 : 0);
    });

    // ---- stage 2: topology --------------------------------------------------
    // One shortest path per link over (corridor × band). Vertical moves step
    // between neighbouring bands inside one corridor and pay for whatever they
    // pass through; horizontal moves step between neighbouring corridors inside
    // one band, which is empty space by construction. Corners cost, so a
    // straight run wins whenever it is available.
    var C = corridors.length;
    var STATES = C * GAPS * 2;
    var vertUse = {};          // corridor edges already claimed, so links spread out

    function sid(ci, g, d) { return (ci * GAPS + g) * 2 + d; }

    function stepCost(ci, g, up) {
      // Moving between band g and band g±1 crosses exactly one drawn row.
      var to = up ? g + 1 : g - 1;
      if (to < 0 || to >= GAPS) return Infinity;
      var row = rowsDrawn[up ? g + 1 : g];
      var c = crossCost(ci, row);
      if (c === Infinity) return Infinity;
      var y1 = band(g).y, y2 = band(to).y;
      var used = vertUse[ci + "^" + Math.min(g, to)] || 0;
      var crowd = o.crowdCost * used +
        (used >= corridors[ci].capacity ? o.fullCost * (used - corridors[ci].capacity + 1) : 0);
      return Math.abs(y1 - y2) + c + crowd + ghostCost(corridors[ci].x, corridors[ci].x, y1, y2);
    }

    function slideCost(ci, cj, g) {
      var x1 = corridors[ci].x, x2 = corridors[cj].x, y = band(g).y;
      return Math.abs(x1 - x2) + ghostCost(x1, x2, y, y);
    }

    function search(startCi, startG, goalCi, goalG, startDir) {
      var dist = new Array(STATES), prev = new Array(STATES), i;
      for (i = 0; i < STATES; i++) dist[i] = Infinity;
      var start = sid(startCi, startG, startDir || 0);   // 0 = travelling vertically
      dist[start] = 0;
      var heap = new Heap();
      heap.push(0, start);
      var goalV = sid(goalCi, goalG, 0), goalH = sid(goalCi, goalG, 1);
      while (heap.size()) {
        var top = heap.pop(), s = top.v;
        if (top.k > dist[s] + 1e-9) continue;
        // Both goal states are settled once the frontier passes the better of
        // them plus the corner the horizontal one still owes.
        if (dist[goalV] <= top.k && dist[goalH] + o.bendCost <= top.k) break;
        var d = s & 1, vtx = s >> 1, g = vtx % GAPS, ci = (vtx - g) / GAPS;
        var relax = function (ns, add) {
          if (!isFinite(add)) return;
          var nd = dist[s] + add;
          if (nd < dist[ns] - 1e-9) { dist[ns] = nd; prev[ns] = s; heap.push(nd, ns); }
        };
        [true, false].forEach(function (up) {
          var add = stepCost(ci, g, up);
          if (!isFinite(add)) return;
          relax(sid(ci, up ? g + 1 : g - 1, 0), add + (d === 0 ? 0 : o.bendCost));
        });
        [ci - 1, ci + 1].forEach(function (cj) {
          if (cj < 0 || cj >= C) return;
          relax(sid(cj, g, 1), slideCost(ci, cj, g) + (d === 1 ? 0 : o.bendCost));
        });
      }
      var end = (dist[goalV] <= dist[goalH] + o.bendCost) ? goalV : goalH;
      if (!isFinite(dist[end])) return null;
      var path = [], s2 = end;
      while (s2 !== undefined) {
        var v = s2 >> 1, g2 = v % GAPS;
        var step = { ci: (v - g2) / GAPS, g: g2 };
        var last = path[path.length - 1];
        if (!last || last.ci !== step.ci || last.g !== step.g) path.push(step);
        if (s2 === start) break;
        s2 = prev[s2];
      }
      return path.reverse();
    }

    // ---- manual anchors -----------------------------------------------------
    // `link.via` is a list of grid-relative waypoints the route has to pass
    // through: `{ col, row }` in the same coordinates the talents are authored
    // in, with a half step meaning "between" — col 5.5 is the gutter right of
    // column 5, row 1.5 the space above row 1. Grid-relative and not pixels,
    // because everything about the drawing moves: the window resizes, a row
    // widens to fit its lanes, a new talent lands in a column, and an anchor
    // pinned to a pixel would be pointing at empty space by then.
    //
    // A waypoint resolves to a vertex of the same graph the search already
    // runs on, so an anchored link is not a special case: it is the same
    // search, run in legs. Everything else still holds — it cannot cut through
    // a node, and its runs are packed with all the others.
    var colXs = {};
    all.forEach(function (n) { if (!n.ghost && colXs[n.col] === undefined) colXs[n.col] = cx(n.box); });
    var knownCols = Object.keys(colXs).map(Number).sort(function (a, b) { return a - b; });

    function colToX(col) {
      if (!knownCols.length) return corridors.length ? corridors[0].x : 0;
      var lo = knownCols[0], hi = knownCols[knownCols.length - 1], i;
      for (i = 0; i < knownCols.length; i++) if (knownCols[i] <= col) lo = knownCols[i];
      for (i = knownCols.length - 1; i >= 0; i--) if (knownCols[i] >= col) hi = knownCols[i];
      if (lo === hi) {
        // Outside the populated columns: step off the nearest one by the
        // average column spacing, which is only ever used to pick a corridor.
        var pitch = knownCols.length > 1
          ? (colXs[knownCols[knownCols.length - 1]] - colXs[knownCols[0]]) /
            (knownCols[knownCols.length - 1] - knownCols[0])
          : 100;
        return colXs[lo] + (col - lo) * pitch;
      }
      return colXs[lo] + (col - lo) * (colXs[hi] - colXs[lo]) / (hi - lo);
    }

    // A waypoint's `row` says which KIND of anchor it is, and the half step
    // that already tells a column from a gutter does the same job here:
    //
    //   row 1.5   a point in the band above row 1 — pins where a horizontal
    //             run travels.
    //   row 1     crossing row 1 — pins the corridor a vertical run climbs in,
    //             which is two vertices, one either side of that row.
    //
    // The distinction is not cosmetic. Pinning a single point in a band the
    // link already passes through asks it to go sideways and come straight
    // back, and a detour that retraces itself draws as nothing at all: the
    // author drags the line, lets go, and watches it snap back for no visible
    // reason. "Climb here" is what grabbing a vertical run has to mean.
    function anchorStops(w, prevG) {
      var x = colToX(Number(w.col) || 0), ci = 0, bd = Infinity;
      corridors.forEach(function (c, i) {
        var d = Math.abs(c.x - x);
        if (d < bd) { bd = d; ci = i; }
      });
      var raw = Number(w.row) || 0, r = Math.floor(raw), g = rowIdx[r];
      if (g === undefined) {
        g = 0;
        rowsDrawn.forEach(function (rr, i) { if (rr <= r) g = i; });
      }
      if (Math.abs(raw - r - 0.5) < 0.01) return [{ ci: ci, g: clampGap(g) }];
      var lo = clampGap(g - 1), hi = clampGap(g);
      if (lo === hi) return [{ ci: ci, g: lo }];
      // Nearer end first, so the pair never asks the route to double back on
      // its way in.
      return Math.abs(hi - prevG) < Math.abs(lo - prevG)
        ? [{ ci: ci, g: hi }, { ci: ci, g: lo }]
        : [{ ci: ci, g: lo }, { ci: ci, g: hi }];
    }

    function endDirOf(path, fallback) {
      if (!path || path.length < 2) return fallback;
      var a = path[path.length - 2], b = path[path.length - 1];
      return a.ci === b.ci ? 0 : 1;
    }

    routed.forEach(function (it) {
      var stops = [{ ci: portCorr[it.from.id], g: it.gapFrom }];
      (it.link.via || []).forEach(function (w) {
        anchorStops(w, stops[stops.length - 1].g).forEach(function (v) { stops.push(v); });
      });
      stops.push({ ci: portCorr[it.to.id], g: it.gapTo });

      var path = null, dir = 0;
      for (var s = 1; s < stops.length; s++) {
        var leg = search(stops[s - 1].ci, stops[s - 1].g, stops[s].ci, stops[s].g, dir);
        if (!leg) { path = null; break; }
        dir = endDirOf(leg, dir);
        if (!path) { path = leg; continue; }
        // The legs share the waypoint itself; keep one copy of it.
        path = path.concat(leg.slice(1));
      }
      it.path = (path || [{ ci: portCorr[it.from.id], g: it.gapFrom },
                          { ci: portCorr[it.to.id], g: it.gapTo }])
        .filter(function (v, i, a) { return i === 0 || v.ci !== a[i - 1].ci || v.g !== a[i - 1].g; });
      for (var k = 1; k < it.path.length; k++) {
        var a = it.path[k - 1], b = it.path[k];
        if (a.ci === b.ci) vertUse[a.ci + "^" + Math.min(a.g, b.g)] = (vertUse[a.ci + "^" + Math.min(a.g, b.g)] || 0) + 1;
      }
    });

    // ---- stage 3: nudge -----------------------------------------------------
    // Nominal points first: corridor centre lines and one lane per band. Every
    // parallel link is on top of its neighbours at this stage; separating them
    // is the packer's whole job below.
    routed.forEach(function (it) {
      var pts = [];
      var head = it.path[0], tail = it.path[it.path.length - 1];
      pts.push({ x: corridors[head.ci].x, y: it.from.box.top, ci: head.ci, g: null });
      it.path.forEach(function (v) {
        pts.push({ x: corridors[v.ci].x, y: band(v.g).y, ci: v.ci, g: v.g });
      });
      pts.push({
        x: corridors[tail.ci].x,
        y: it.kind === "hop" ? it.to.box.top : (it.to.outer || it.to.box).bottom,
        ci: tail.ci, g: null,
      });
      it.pts = pts;

      // Maximal straight runs, which is what actually competes for space.
      var runs = [];
      for (var k = 1; k < pts.length; k++) {
        var a = pts[k - 1], b = pts[k];
        var vertical = a.ci === b.ci && Math.abs(a.y - b.y) > 0.01;
        var horizontal = !vertical && Math.abs(a.x - b.x) > 0.01;
        if (!vertical && !horizontal) continue;
        var last = runs[runs.length - 1];
        var key = vertical ? a.ci : (a.g !== null ? a.g : b.g);
        if (last && last.vertical === vertical && last.key === key && last.j === k - 1) { last.j = k; continue; }
        runs.push({ item: it, vertical: vertical, key: key, i: k - 1, j: k });
      }
      it.runs = runs;
    });

    // A run's span and its exits are read off the points as they stand right
    // now, never off the nominal ones. That distinction is the whole reason the
    // nudge runs in rounds: a run's ends sit on the corridors and lanes its
    // neighbours are still being assigned, so a span measured before those move
    // can be wrong by a slot in each direction — which is exactly enough for
    // two runs that merely touched to end up overlapping.
    function measure(r) {
      var pts = r.item.pts, lo = Infinity, hi = -Infinity;
      for (var k = r.i; k <= r.j; k++) {
        var v = r.vertical ? pts[k].y : pts[k].x;
        lo = Math.min(lo, v); hi = Math.max(hi, v);
      }
      r.lo = lo; r.hi = hi;
      // Separation is tested on a slightly bigger span than ordering is. A
      // vertical run that stops at a band stops at whichever LANE of that band
      // it is given, and that lane is decided in this same pass — so for the
      // purposes of "may these two share a slot", such an end claims the whole
      // band. Ordering still uses the exact span: inflating that instead would
      // put every exit inside every other run's span and turn a plain fan into
      // a cycle of contradictory constraints.
      r.plo = lo; r.phi = hi;
      if (r.vertical) {
        [r.i, r.j].forEach(function (k) {
          if (pts[k].g === null || pts[k].g === undefined) return;
          var b = band(pts[k].g);
          r.plo = Math.min(r.plo, b.top); r.phi = Math.max(r.phi, b.bottom);
        });
      }
      r.exitLow = []; r.exitHigh = [];
      [[r.i, r.i - 1], [r.j, r.j + 1]].forEach(function (e) {
        var here = pts[e[0]], there = pts[e[1]];
        if (!there) return;                           // the box end: it forces nothing
        // "Low" always means slot 0, and the two axes disagree about which way
        // that points: a corridor's slots run left to right, while a band's
        // lanes start against the boxes below and climb, so a lane's low side
        // is the LARGER y. Getting this backwards costs nothing visible on a
        // single link and inverts every fan.
        var away = r.vertical ? (there.x - here.x) : (here.y - there.y);
        var at = r.vertical ? here.y : here.x;
        if (away < -0.01) r.exitLow.push(at);
        else if (away > 0.01) r.exitHigh.push(at);
      });
    }

    // The order of parallel runs is forced by geometry, not free choice: an end
    // that leaves the bundle towards the LOW side sweeps past every run below
    // it, and one leaving towards the HIGH side past every run above. So a run
    // whose low-side exit falls inside another run's span has to sit below it,
    // and one whose high-side exit does has to sit above.
    //
    // A plain sort cannot express this — a fan-out wants the furthest link
    // nearest the boxes and a fan-in the nearest one — which is why sorting by
    // position got fan-outs right in one direction and backwards in the other.
    // Ordering by the constraints themselves covers both, and a cycle among
    // them is a crossing the layout genuinely forces.
    function packOrder(list) {
      var n = list.length;
      if (n < 2) return list.slice();
      function inside(v, k) { return v > list[k].lo + 0.5 && v < list[k].hi - 0.5; }
      function width(i) { return list[i].hi - list[i].lo; }

      var after = [], indeg = [], i, j;
      for (i = 0; i < n; i++) { after.push({}); indeg.push(0); }
      function edge(a, b) {                      // a sits at or below b
        if (a === b || after[a][b]) return;
        after[a][b] = true; indeg[b]++;
      }
      for (i = 0; i < n; i++) {
        for (j = 0; j < n; j++) {
          if (i === j) continue;
          /* jshint loopfunc:true */
          (function (a, b) {
            list[a].exitLow.forEach(function (v) { if (inside(v, b)) edge(a, b); });
            list[a].exitHigh.forEach(function (v) { if (inside(v, b)) edge(b, a); });
            // Two runs that meet end-to-end on the SAME line, one heading off
            // towards the low side and the other towards the high side, never
            // overlap in span, so nothing above says anything about them. They
            // still cannot be ordered freely: the two departing runs share that
            // line, so whichever leaves towards low has to BE the low one, or
            // the pair it hands off to overlaps. This is the case that made a
            // link's stub and its neighbour's arrival swap sides at random.
            list[a].exitLow.forEach(function (p) {
              list[b].exitHigh.forEach(function (q) { if (Math.abs(p - q) < 1) edge(a, b); });
            });
          })(i, j);
        }
      }

      // Who must end up at or below whom, kept separately: the walk below
      // consumes `after`, and the slot assignment still needs the relation.
      var below = [];
      for (i = 0; i < n; i++) below.push([]);
      for (i = 0; i < n; i++) Object.keys(after[i]).forEach(function (b) { below[b].push(i); });

      var out = [], used = [];
      for (i = 0; i < n; i++) used.push(false);
      for (var step = 0; step < n; step++) {
        var pick = -1;
        for (i = 0; i < n; i++) {
          if (used[i] || indeg[i] > 0) continue;
          if (pick < 0 || width(i) > width(pick)) pick = i;      // widest first, for stability
        }
        if (pick < 0) {                          // a cycle — this crossing is forced
          for (i = 0; i < n; i++) if (!used[i] && (pick < 0 || width(i) > width(pick))) pick = i;
        }
        used[pick] = true;
        list[pick].below = below[pick].map(function (k) { return list[k]; });
        out.push(list[pick]);
        Object.keys(after[pick]).forEach(function (b) { indeg[b]--; });
        after[pick] = {};
      }
      return out;
    }

    // Runs that don't overlap can share a slot; ones that do never can. The
    // order is a floor, not a suggestion: a run whose span happens to miss
    // everything already placed would otherwise drop back to slot 0 and end up
    // BELOW a run it was just ordered above, which is how a stub and the
    // arrival it hands over to ended up on the wrong sides of each other.
    function assignSlots(list) {
      list.forEach(function (r) { r.slot = undefined; });
      var slots = [];
      packOrder(list).forEach(function (r) {
        var k = 0;
        (r.below || []).forEach(function (p) { if (p.slot !== undefined && p.slot > k) k = p.slot; });
        while (slots[k] && slots[k].some(function (iv) { return overlaps(iv[0], iv[1], r.plo, r.phi, 0.5); })) k++;
        (slots[k] = slots[k] || []).push([r.plo, r.phi]);
        r.slot = k;
      });
      return slots.length;
    }

    var vBy = {}, hBy = {};
    routed.forEach(function (it) {
      it.runs.forEach(function (r) {
        var bucket = r.vertical ? vBy : hBy;
        (bucket[r.key] = bucket[r.key] || []).push(r);
      });
    });

    function place(r, at) {
      for (var k = r.i; k <= r.j; k++) {
        if (r.vertical) r.item.pts[k].x = at;
        else r.item.pts[k].y = at;
      }
    }

    // Inside every round EVERY run is measured before ANY is placed. Measuring
    // one axis after placing the other is what makes the order self-fulfilling:
    // at nominal coordinates a bundle of links leaving one node is identical
    // along x but distinguishable along y (they stop in different bands), and a
    // fan into one row is the other way round. Take both readings from the same
    // untouched state and each axis is ordered by whichever end genuinely
    // distinguishes it; place one axis first and its arbitrary tie-breaks
    // become the other's evidence.
    //
    // Then iterate, because the two axes are genuinely coupled: which lane a
    // run gets decides whether two ends meet on one line, which decides the
    // order in the corridor they hand off to, which moves the runs again. Most
    // layouts settle on the second pass. Where they don't, the reason is a pair
    // of constraints that are both true at once (each end of a link forbidding
    // the other's side), and there the iteration keeps trading one overlap for
    // another rather than converging — so the rounds are scored on the thing
    // that actually matters, and the best one wins. Bounded, deterministic, and
    // it can only improve on a single pass.
    function snapshot() {
      return routed.map(function (it) {
        return it.pts.map(function (p) { return [p.x, p.y]; });
      });
    }
    function restore(snap) {
      routed.forEach(function (it, i) {
        it.pts.forEach(function (p, k) { p.x = snap[i][k][0]; p.y = snap[i][k][1]; });
      });
    }
    function coordOf(r) { var p = r.item.pts[r.i]; return r.vertical ? p.x : p.y; }

    // What a round is scored on. Two parallel runs drawn within a hair of each
    // other read as one thick line and are a defect outright; a perpendicular
    // crossing is legal (a grid can force one) but is still the difference
    // between a fan that reads at a glance and a tangle, so it breaks ties.
    function score() {
      var collide = 0, cross = 0, vs = [], hs = [];
      [vBy, hBy].forEach(function (bucket) {
        Object.keys(bucket).forEach(function (key) {
          var list = bucket[key];
          list.forEach(measure);
          list.forEach(function (r) { (r.vertical ? vs : hs).push(r); });
          for (var i = 0; i < list.length; i++) {
            for (var j = i + 1; j < list.length; j++) {
              var a = list[i], b = list[j];
              if (Math.abs(coordOf(a) - coordOf(b)) < o.tolerance &&
                  Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > o.tolerance) collide++;
            }
          }
        });
      });
      vs.forEach(function (v) {
        var x = coordOf(v);
        hs.forEach(function (h) {
          if (v.item === h.item) return;
          var y = coordOf(h);
          if (x > h.lo + o.tolerance / 2 && x < h.hi - o.tolerance / 2 &&
              y > v.lo + o.tolerance / 2 && y < v.hi - o.tolerance / 2) cross++;
        });
      });
      return collide * 1000 + cross;
    }

    var gaps = {}, best = null, laneCount = {}, demand = {}, ROUNDS = 9;
    for (var round = 0; round < ROUNDS; round++) {
      routed.forEach(function (it) { it.runs.forEach(measure); });
      var placements = [];
      // After the opening round the coordinates are all distinct, so updating
      // one axis at a time (and letting the other read the result immediately)
      // settles far more often than moving both at once, which tends to swap
      // the two orders together and land back where it started.
      var doLanes = round === 0 || (round % 2) === 1;
      var doCorridors = round === 0 || (round % 2) === 0;
      gaps = {};

      // Bands: lane 0 sits nearest the boxes below, each further lane climbing
      // towards the row above.
      Object.keys(hBy).forEach(function (key) {
        var list = hBy[key], g = Number(key), b = band(g);
        var used = doLanes ? assignSlots(list) : laneCount[g];
        // A band too tight to hold the lanes it was just handed collapses them
        // onto one line, which then measures as "one lane wanted" — so the
        // demand reported to the caller is the WORST any round asked for, not
        // whatever the winning round happened to fit. Otherwise a squeezed band
        // never asks for the room that would let it come out right, and the
        // re-route it triggers reproduces the same squeeze exactly.
        demand[g] = Math.max(demand[g] || 1, used);
        var have = Math.max(0, b.bottom - b.top);
        gaps[g] = { row: rowsDrawn[g], lanes: used, have: have };
        if (!doLanes) return;
        laneCount[g] = used;
        var room = Math.max(0, (b.bottom - o.laneMargin) - (b.top + o.laneMargin));
        var step = used > 1 ? Math.min(o.laneSpacing, room / (used - 1)) : 0;
        list.forEach(function (r) { placements.push([r, b.bottom - o.laneMargin - r.slot * step]); });
      });

      // Corridors: fan across the measured free width, centred, so a lone run
      // stays on the corridor's own line and an ordinary straight link stays
      // straight.
      if (doCorridors) Object.keys(vBy).forEach(function (key) {
        var list = vBy[key], c = corridors[Number(key)];
        var used = assignSlots(list);
        var wide = used > 1 && (used - 1) * o.portSpacing > c.clearHi - c.clearLo;
        var lo = wide ? c.lo : c.clearLo, hi = wide ? c.hi : c.clearHi;
        var step = used > 1 ? Math.min(o.portSpacing, Math.max(0, hi - lo) / (used - 1)) : 0;
        var mid = used > 1 ? (lo + hi) / 2 : c.x;
        list.forEach(function (r) { placements.push([r, mid + (r.slot - (used - 1) / 2) * step]); });
      });

      placements.forEach(function (p) { place(p[0], p[1]); });

      var bad = score();
      if (!best || bad < best.bad) best = { bad: bad, snap: snapshot(), gaps: gaps };
      if (!bad) break;
    }
    if (best) { restore(best.snap); gaps = best.gaps; }
    Object.keys(gaps).forEach(function (g) {
      var want = Math.max(gaps[g].lanes, demand[g] || 1);
      gaps[g].lanes = want;
      gaps[g].need = 2 * o.laneMargin + (want - 1) * o.laneSpacing;
      gaps[g].extra = Math.max(0, gaps[g].need - gaps[g].have);
    });

    // ---- same-row neighbours ------------------------------------------------
    // Nothing between the two boxes, so the link goes straight across between
    // the facing edges. The only thing it can collide with is another link on
    // that same edge, so those fan vertically the way a column corridor fans
    // horizontally.
    var sideGroups = {};
    items.forEach(function (it) {
      if (it.kind !== "side") return;
      var l2r = it.from.col <= it.to.col;
      [[it.from, l2r ? "r" : "l", it.to, "fromPort"],
       [it.to, l2r ? "l" : "r", it.from, "toPort"]].forEach(function (e) {
        var k = e[0].id + "|" + e[1];
        (sideGroups[k] = sideGroups[k] || []).push({ it: it, node: e[0], far: e[2], key: e[3] });
      });
    });
    Object.keys(sideGroups).forEach(function (k) {
      var g = sideGroups[k], box = g[0].node.box;
      g.sort(function (a, b) { return cy(a.far.box) - cy(b.far.box) || a.far.col - b.far.col; });
      var span = Math.max(0, (box.bottom - box.top) - o.portInset);
      var step = g.length > 1 ? Math.min(o.portSpacing, span / (g.length - 1)) : 0;
      g.forEach(function (e, i) { e.it[e.key] = (i - (g.length - 1) / 2) * step; });
    });
    items.forEach(function (it) {
      if (it.kind !== "side") return;
      var l2r = it.from.col <= it.to.col;
      var sx = l2r ? it.from.box.right : it.from.box.left, sy = cy(it.from.box) + (it.fromPort || 0);
      var tx = l2r ? it.to.box.left : it.to.box.right, ty = cy(it.to.box) + (it.toPort || 0);
      var mx = (sx + tx) / 2;
      it.pts = [pt(sx, sy), pt(mx, sy), pt(mx, ty), pt(tx, ty)];
    });

    // ---- emit ---------------------------------------------------------------
    return {
      gaps: gaps,
      routes: items.map(function (it) {
        var points = dedupe(it.pts.map(function (p) { return pt(p.x, p.y); }));
        return { link: it.link, points: points, chevron: chevronFor(points) };
      }),
    };
  }

  function dedupe(points) {
    var out = [];
    points.forEach(function (p) {
      var last = out[out.length - 1];
      if (!last || Math.abs(last.x - p.x) > 0.5 || Math.abs(last.y - p.y) > 0.5) out.push(p);
    });
    // A midpoint left collinear between its neighbours is a bend that isn't one.
    for (var i = out.length - 2; i > 0; i--) {
      var a = out[i - 1], b = out[i], c = out[i + 1];
      var straightX = Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5;
      var straightY = Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5;
      if (straightX || straightY) out.splice(i, 1);
    }
    return out;
  }

  // On the longest segment, so the chevron always sits on a straight run rather
  // than at a corner where its direction would read as ambiguous.
  function chevronFor(points) {
    var best = null;
    for (var i = 1; i < points.length; i++) {
      var a = points[i - 1], b = points[i];
      var len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      if (!best || len > best.len) best = { a: a, b: b, len: len };
    }
    if (!best) return { x: points[0] ? points[0].x : 0, y: points[0] ? points[0].y : 0, angle: 0 };
    return {
      x: (best.a.x + best.b.x) / 2,
      y: (best.a.y + best.b.y) / 2,
      angle: Math.atan2(best.b.y - best.a.y, best.b.x - best.a.x) * 180 / Math.PI,
    };
  }

  window.LinkRouter = { route: route };
})();
