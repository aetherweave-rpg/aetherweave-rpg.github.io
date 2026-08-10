// ============================================================================
// LinkRouter — orthogonal routing for prerequisite links.
// ----------------------------------------------------------------------------
// The trees page, the Spells page and the editor all draw the same thing: an
// arrow from a prerequisite up to whatever it unlocks, over the same row/col
// grid. All three used to carry their own copy of the geometry; this is the
// one implementation they share.
//
// Routing runs in four passes, each killing a specific class of visual artifact:
//
//   1. PORTS  — links whose stubs share a ROW GAP and COLUMN are sorted by
//               where their far end sits, then fanned across that strip. Two
//               details are load-bearing. The sort, because fanning alone (an
//               earlier attempt) still let the leftward link be handed the
//               rightmost slot and cross its siblings at the box. And pooling
//               by gap+column rather than by node, because a link leaving the
//               box below and a link arriving at the box above occupy the same
//               strip without sharing any node — per-node pooling left exactly
//               that pair drawn on top of each other.
//
//   2. SHAPE  — every stub is pinned by its port, so all of them are reserved
//               up front and the long ascents route around them. Preference
//               order: ascend in the target's column, else the source's, else
//               the nearest clear gutter between two columns. A gutter holds no
//               box by construction, so routing always terminates and never has
//               to give up and cut through something.
//
//   3. LANES  — horizontal runs sharing a row gap are interval-packed into
//               separate lanes, so two links can never collapse onto one line.
//
//   4. EMIT   — points, plus the direction chevron, placed on the LONGEST
//               straight segment so it never lands on a corner.
//
// Reserving before choosing is what makes pass 2 order-independent in the way
// that matters: a stub cannot move (it is a port), an ascent can, so the thing
// that cannot move is registered first and the thing that can works around it.
//
// **Lanes need room the CSS cannot know about in advance.** A node with six
// dependents wants six lanes in one row gap, and the stock 22px gap squeezes
// them to two pixels apart, which reads as one thick smear rather than six
// links. So `route` returns `gaps` alongside `routes`: the per-gap lane demand.
// A caller is expected to widen the row spacing by `extra` and route a second
// time. Compressing is the fallback for a caller that cannot re-layout, not the
// intended path.
//
// A vertical link ends at the bottom of the whole target NODE, not at its icon
// box, because the name and cost sit between the two and a line run up to the
// box is a line drawn through that text.
//
// Pure geometry: boxes in, polylines out. No DOM, no state, no styling.
// ============================================================================

(function () {
  var DEFAULTS = {
    portSpacing: 9,   // between two links leaving the same box edge
    laneSpacing: 9,   // between two horizontal runs in one row gap
    laneMargin: 12,   // clear space between the first lane and the boxes below it
    clearance: 8,     // how close a vertical run may pass a node box
    parallel: 6,      // two runs closer than this count as overlapping
    portInset: 16,    // port fan never reaches within this much of a box's corners
  };

  function cx(b) { return (b.left + b.right) / 2; }
  function cy(b) { return (b.top + b.bottom) / 2; }
  function pt(x, y) { return { x: x, y: y }; }

  function overlaps(a1, a2, b1, b2, slack) {
    return Math.min(a2, b2) - Math.max(a1, b1) > slack;
  }

  // nodes: [{ id, row, col, box, outer? }] — box/outer are host-relative rects
  //        ({left,top,right,bottom}). `box` is the icon box links attach to;
  //        `outer` is the whole node incl. its name/cost, used to work out how
  //        much vertical room a row gap really has for lanes.
  // links: [{ from: <node id>, to: <node id>, ... }] — anything else rides along
  //        untouched on `.link`.
  // → [{ link, points: [{x,y}...], chevron: {x,y,angle} }]
  function route(nodes, links, opts) {
    var o = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      o[k] = (opts && opts[k] !== undefined) ? opts[k] : DEFAULTS[k];
    });

    // `ghost` nodes can be linked to but are not obstacles. A talent group is
    // one: its box is the dotted rectangle round several talents, so a link can
    // aim at it, but treating that whole rectangle as solid would wall off the
    // middle of the tree and send everything passing by on an enormous detour.
    // The members inside it are ordinary nodes and still block on their own.
    var byId = {}, byRow = {}, colX = {};
    (nodes || []).forEach(function (n) {
      byId[n.id] = n;
      if (!n.ghost) (byRow[n.row] = byRow[n.row] || []).push(n);
      if (colX[n.col] === undefined && !n.ghost) colX[n.col] = cx(n.box);
    });

    // A link whose ends aren't both laid out here can't be drawn at all; the
    // caller renders those as requirement text instead.
    var items = (links || []).map(function (link, ix) {
      return { link: link, ix: ix, from: byId[link.from], to: byId[link.to] };
    }).filter(function (it) { return it.from && it.to && it.from !== it.to; });

    // Routing decisions depend on what earlier links have already claimed, so
    // the processing order has to come from the data, not from iteration order.
    items.sort(function (a, b) {
      return a.from.row - b.from.row || a.from.col - b.from.col ||
             a.to.row - b.to.row || a.to.col - b.to.col ||
             (a.link.from < b.link.from ? -1 : a.link.from > b.link.from ? 1 : 0);
    });

    // ---- column geometry, incl. columns that hold no node -------------------
    // Half the width of a whole node — icon box plus the name and cost under
    // it, which are wider than the box and are what a stray line runs through.
    var outerHalf = 0;
    (nodes || []).forEach(function (n) {
      var r = n.outer || n.box;
      outerHalf = Math.max(outerHalf, (r.right - r.left) / 2);
    });

    var colList = Object.keys(colX).map(Number).sort(function (a, b) { return a - b; });
    var pitch = 100;
    if (colList.length > 1) {
      var lo = colList[0], hi = colList[colList.length - 1];
      pitch = (colX[hi] - colX[lo]) / (hi - lo);
    }
    // A tree with a single populated column has no pitch to measure, and the
    // guess has to leave room for the labels or the gutters land on top of them.
    pitch = Math.max(pitch, 2 * outerHalf + 12);

    // A gutter's centre line always clears the captions; how far either side of
    // it still does depends on how much wider the cell is than a whole node.
    // These have to be computed before the shape pass runs — `findGutter` reads
    // them, and `var` would otherwise hand it undefined and silently collapse
    // every gutter to its single centre line.
    var boxHalf = 0;
    (nodes || []).forEach(function (n) { boxHalf = Math.max(boxHalf, (n.box.right - n.box.left) / 2); });
    var clearHalf = Math.max(0, pitch / 2 - outerHalf - 2);        // clear of captions too
    var tightHalf = Math.max(clearHalf, pitch / 2 - boxHalf - 2);  // clear of the icon boxes only

    function gutterSlots(half) {
      var n = Math.floor(half / 6);
      return { count: n, step: n ? half / n : 0 };
    }
    function colCenter(c) {
      if (colX[c] !== undefined) return colX[c];
      return colList.length ? colX[colList[0]] + (c - colList[0]) * pitch : 0;
    }

    // Rows are indexed by the order they are DRAWN in, not by their authored
    // number: the renderers skip empty rows, so a tree with talents on rows 0
    // and 2 draws them adjacent. Gaps are counted between drawn neighbours, or
    // a hole in the numbering would put a lane in empty space far off-screen.
    var rowsDrawn = Object.keys(byRow).map(Number).sort(function (a, b) { return a - b; });
    var rowIdx = {};
    rowsDrawn.forEach(function (r, i) { rowIdx[r] = i; });

    // Lanes for gap `i`, the space between drawn row i and drawn row i+1:
    // bounded below by the lower row's boxes and above by the upper row's full
    // nodes (name and cost included).
    var bands = {};
    function gapBand(i) {
      if (bands[i]) return bands[i];
      var below = byRow[rowsDrawn[i]] || [], above = byRow[rowsDrawn[i + 1]] || [];
      var bottom = below.length
        ? Math.min.apply(null, below.map(function (n) { return n.box.top; }))
        : 0;
      var top = above.length
        ? Math.max.apply(null, above.map(function (n) { return (n.outer || n.box).bottom; }))
        : bottom - 120;
      return (bands[i] = { top: top, bottom: bottom });
    }

    // ---- pass 1: classify ---------------------------------------------------
    items.forEach(function (it) {
      if (it.from.row !== it.to.row) {
        it.kind = "vert";
      } else {
        var lo2 = Math.min(it.from.col, it.to.col), hi2 = Math.max(it.from.col, it.to.col);
        var blocked = (byRow[it.from.row] || []).some(function (n) { return n.col > lo2 && n.col < hi2; });
        // Nothing can pass through the row, so a blocked one leaves over the
        // top — the same edge, and so the same port pool, as a vertical link.
        it.kind = blocked ? "hop" : "side";
      }
      if (it.kind === "side") return;
      it.gapFrom = rowIdx[it.from.row];
      it.gapTo = it.kind === "hop" ? rowIdx[it.from.row] : rowIdx[it.to.row] - 1;
    });

    // Where each link is really heading, as seen from the pool it is fanned in.
    // The target's column is only a first guess: a link whose column is blocked
    // detours into a gutter and ends up reaching PAST a shorter neighbour, and
    // fanning it inside that neighbour nests their two spans so that no lane
    // order can separate them.
    //
    // So passes 2 to 4 run twice: once on the guess, then again re-fanned
    // against where the routes actually went. One refinement is enough in
    // practice — a third would only re-order ports that have already settled.
    var reach = {};
    var gaps = solve();
    var moved = false;
    items.forEach(function (it) {
      var r = reachOf(it);
      if (r === undefined) return;
      if (reach[it.ix] === undefined || Math.abs(reach[it.ix] - r) > 0.5) { reach[it.ix] = r; moved = true; }
    });
    if (moved) gaps = solve();

    // How far this link's run in its exit gap actually got.
    function reachOf(it) {
      if (it.kind === "side" || !it.shape) return undefined;
      if (it.shape.kind === "gutter") return it.shape.ascentX;
      return it.shape.gap === it.gapFrom ? it.geom.tx : it.geom.sx;
    }

    function solve() {

    // ---- pass 2: ports ------------------------------------------------------
    // Stubs are pooled by the ROW GAP and COLUMN they occupy, not by the node
    // they touch. A link leaving the box below and a link arriving at the box
    // above pass through the same strip of space at the same column, so they
    // have to be fanned against each other even though they share no node —
    // pooling per node (an earlier attempt) left exactly that pair overlapping.
    // A link that both leaves and arrives inside one pool takes a single slot,
    // so an ordinary straight link stays straight.
    function farNode(it, col) { return it.from.col === col ? it.to : it.from; }
    function farX(it, col) {
      if (it.from.col === col && reach[it.ix] !== undefined) return reach[it.ix];
      if (it.from.col === col && it.to.col === col) return colCenter(col);
      return cx(farNode(it, col).box);
    }
    // How many rows the link spans. Two links heading for the SAME column tie on
    // farX, and the tie is not cosmetic: whichever reaches further needs the
    // outer slot, or its run ends up straddling the other's stub and the two
    // cross with no lane order able to separate them.
    function farReach(it) { return Math.abs(it.to.row - it.from.row); }
    var pools = {};
    function addSlot(it, gap, col, box) {
      var k = gap + ":" + col;
      var pool = pools[k] = pools[k] || [];
      if (pool.some(function (e) { return e.it === it; })) return;
      pool.push({ it: it, col: col, box: box });
    }
    items.forEach(function (it) {
      it.portAt = {};
      if (it.kind === "side") return;
      addSlot(it, it.gapFrom, it.from.col, it.from.box);
      addSlot(it, it.gapTo, it.to.col, it.to.box);
    });
    Object.keys(pools).forEach(function (k) {
      var pool = pools[k], col = pool[0].col;
      pool.sort(function (a, b) {
        return farX(a.it, col) - farX(b.it, col) ||
               farReach(b.it) - farReach(a.it) ||
               (a.it.link.to < b.it.link.to ? -1 : a.it.link.to > b.it.link.to ? 1 : 0);
      });
      var span = Math.max(0, (pool[0].box.right - pool[0].box.left) - o.portInset);
      var step = pool.length > 1 ? Math.min(o.portSpacing, span / (pool.length - 1)) : 0;
      pool.forEach(function (e, i) { e.it.portAt[k] = (i - (pool.length - 1) / 2) * step; });
    });

    // Same-row links leave through the left/right edges instead, where the only
    // thing they can collide with is another link on that same edge.
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
      if (it.kind === "side") {
        var l2r = it.from.col <= it.to.col;
        it.geom = {
          sx: l2r ? it.from.box.right : it.from.box.left, sy: cy(it.from.box) + it.fromPort,
          tx: l2r ? it.to.box.left : it.to.box.right, ty: cy(it.to.box) + it.toPort,
        };
        return;
      }
      // A vertical link stops at the bottom of the whole target node, not at
      // its icon box: the name and cost sit between the two, and running the
      // line up to the box means drawing it straight through that text. A hop
      // leaves over the top, where nothing is in the way.
      it.geom = {
        sx: cx(it.from.box) + (it.portAt[it.gapFrom + ":" + it.from.col] || 0),
        sy: it.from.box.top,
        tx: cx(it.to.box) + (it.portAt[it.gapTo + ":" + it.to.col] || 0),
        ty: it.kind === "hop" ? it.to.box.top : (it.to.outer || it.to.box).bottom,
      };
    });

    // ---- pass 2: shape ------------------------------------------------------
    var claims = [];
    function reserve(owner, x, ya, yb) {
      claims.push({ owner: owner, x: x, y1: Math.min(ya, yb), y2: Math.max(ya, yb) });
    }
    function taken(owner, x, ya, yb) {
      var y1 = Math.min(ya, yb), y2 = Math.max(ya, yb);
      return claims.some(function (c) {
        return c.owner !== owner && Math.abs(c.x - x) < o.parallel &&
               overlaps(c.y1, c.y2, y1, y2, o.parallel);
      });
    }
    // Drawn rows strictly between the two ends — the ones an ascent has to pass.
    function columnBlocked(x, idxLo, idxHi) {
      for (var i = idxLo + 1; i < idxHi; i++) {
        var list = byRow[rowsDrawn[i]] || [];
        for (var j = 0; j < list.length; j++) {
          // The name/cost caption is wider than the icon box and is exactly
          // what a straight pass-through run would otherwise clip — checking
          // only the box let a vertical ascent thread the gap between two
          // captions while still cutting through both of them.
          var b = list[j].outer || list[j].box;
          if (x > b.left - o.clearance && x < b.right + o.clearance) return true;
        }
      }
      return false;
    }

    var routed = items.filter(function (it) { return it.kind !== "side"; });

    // Both stubs of every link are pinned by their ports and cannot be moved,
    // so they all go on the board before any ascent gets to choose.
    routed.forEach(function (it) {
      var exit = gapBand(it.gapFrom), entry = gapBand(it.gapTo);
      reserve(it, it.geom.sx, exit.top, it.geom.sy);
      if (it.kind === "hop") reserve(it, it.geom.tx, entry.top, it.geom.ty);
      else reserve(it, it.geom.tx, it.geom.ty, entry.bottom);
    });

    // `downs`/`ups` are the x positions where this run leaves its lane heading
    // for the boxes below it, and where it heads up towards the row above.
    // Which lane it lands in has to respect them (see orderRuns).
    var runs = [];
    function addRun(gap, x1, x2, item, key, downs, ups) {
      if (Math.abs(x1 - x2) < 0.5) return;      // nothing to draw, nothing to pack
      runs.push({ gap: gap, x1: x1, x2: x2, item: item, key: key, downs: downs, ups: ups });
    }

    routed.forEach(function (it) {
      var g = it.geom, lo3 = it.gapFrom, hi3 = it.gapTo + 1;

      // A hop stays inside one row gap, so there is no column to choose. Both
      // of its ends drop back down to a box on the same row.
      if (it.kind === "hop") {
        it.shape = { kind: "elbow", gap: it.gapFrom };
        addRun(it.gapFrom, g.sx, g.tx, it, "lane", [g.sx, g.tx], []);
        return;
      }

      // Ascend in the target's column, stepping across in the gap just above
      // the source. Preferred because it fans links apart immediately, right
      // where several links leaving one node would otherwise stack up.
      if (!columnBlocked(g.tx, lo3, hi3) && !taken(it, g.tx, g.ty, g.sy)) {
        it.shape = { kind: "elbow", gap: it.gapFrom };
        addRun(it.gapFrom, g.sx, g.tx, it, "lane", [g.sx], [g.tx]);
        reserve(it, g.tx, g.ty, g.sy);
        return;
      }
      // Ascend in the source's column instead, stepping across just below the
      // target.
      if (!columnBlocked(g.sx, lo3, hi3) && !taken(it, g.sx, g.ty, g.sy)) {
        it.shape = { kind: "elbow", gap: it.gapTo };
        addRun(it.gapTo, g.sx, g.tx, it, "lane", [g.sx], [g.tx]);
        reserve(it, g.sx, g.ty, g.sy);
        return;
      }
      // Both columns are spoken for: ascend in the nearest clear gutter, which
      // by construction holds no box at all.
      var gx = findGutter(it, lo3, hi3, g.tx, g.ty, g.sy);
      it.shape = { kind: "gutter", ascentX: gx };
      addRun(it.gapFrom, g.sx, gx, it, "lane1", [g.sx], [gx]);
      addRun(it.gapTo, gx, g.tx, it, "lane2", [gx], [g.tx]);
      reserve(it, gx, g.ty, g.sy);
    });

    // Gutters carry several parallel slots each, not just their centre line: a
    // tree can easily want more long ascents than it has columns, and running
    // out used to mean two of them landing on the same line. Slots that clear
    // the captions are all tried first; the ones that only clear the icon boxes
    // are a last resort, because clipping the edge of a caption is a much
    // smaller sin than drawing two links on top of each other.
    function findGutter(owner, lo3, hi3, preferX, ya, yb) {
      var first = colList.length ? colList[0] - 1 : 0;
      var last = colList.length ? colList[colList.length - 1] : 0;

      function tier(half, rank) {
        var s = gutterSlots(half), out = [];
        for (var c = first; c <= last; c++) {
          var mid = (colCenter(c) + colCenter(c + 1)) / 2;
          out.push({ x: mid, k: 0, rank: rank });
          for (var k = 1; k <= s.count; k++) {
            out.push({ x: mid + k * s.step, k: k, rank: rank });
            out.push({ x: mid - k * s.step, k: k, rank: rank });
          }
        }
        return out;
      }

      var cands = tier(clearHalf, 0).concat(tightHalf > clearHalf ? tier(tightHalf, 1) : []);
      // Every gutter's clean centre line is tried before any gutter's offsets.
      cands.sort(function (a, b) {
        return a.rank - b.rank || a.k - b.k ||
               Math.abs(a.x - preferX) - Math.abs(b.x - preferX);
      });
      var open = cands.filter(function (c) { return !columnBlocked(c.x, lo3, hi3); });
      for (var i = 0; i < open.length; i++) {
        if (!taken(owner, open[i].x, ya, yb)) return open[i].x;
      }
      // Nothing is free. Take whatever conflicts least rather than whatever is
      // nearest, so a saturated tree degrades gradually instead of doubling up.
      var y1 = Math.min(ya, yb), y2 = Math.max(ya, yb), best = null;
      open.forEach(function (c) {
        var cost = claims.reduce(function (a, cl) {
          if (cl.owner === owner || Math.abs(cl.x - c.x) >= o.parallel) return a;
          return a + Math.max(0, Math.min(cl.y2, y2) - Math.max(cl.y1, y1));
        }, 0);
        if (!best || cost < best.cost) best = { x: c.x, cost: cost };
      });
      return best ? best.x : preferX;
    }

    // ---- pass 3: lanes ------------------------------------------------------
    // Which lane a run lands in decides whether it crosses its neighbours, and
    // the rule is forced by geometry: an end LEAVING its lane downwards (to a
    // box below) sweeps past every lane beneath it, and an end leaving upwards
    // sweeps past every lane above. So a run whose descending end falls inside
    // another run's span has to sit below that run, and one whose ascending end
    // does has to sit above it.
    //
    // Getting this from a plain left-to-right sort is not possible: a fan-out
    // wants the FURTHEST link nearest the boxes, a fan-in wants the NEAREST
    // one there, and the earlier sort-by-leftmost-x silently got fan-outs right
    // in one direction and backwards in the other. Ordering by the constraints
    // themselves covers both, and any cycle is a crossing the layout genuinely
    // forces rather than one the router chose.
    function orderRuns(list) {
      var n = list.length;
      if (n < 2) return list.slice();
      var span = list.map(function (r) {
        return { lo: Math.min(r.x1, r.x2), hi: Math.max(r.x1, r.x2) };
      });
      function inside(x, k) { return x > span[k].lo + 0.5 && x < span[k].hi - 0.5; }
      function width(i) { return span[i].hi - span[i].lo; }

      var after = [], indeg = [], i, j;
      for (i = 0; i < n; i++) { after.push({}); indeg.push(0); }
      function edge(a, b) {                 // a takes a lane at or below b
        if (a === b || after[a][b]) return;
        after[a][b] = true; indeg[b]++;
      }
      for (i = 0; i < n; i++) {
        for (j = 0; j < n; j++) {
          if (i === j) continue;
          /* jshint loopfunc:true */
          (function (a, b) {
            list[a].downs.forEach(function (x) { if (inside(x, b)) edge(a, b); });
            list[a].ups.forEach(function (x) { if (inside(x, b)) edge(b, a); });
          })(i, j);
        }
      }

      var out = [], used = [];
      for (i = 0; i < n; i++) used.push(false);
      for (var step = 0; step < n; step++) {
        var pick = -1;
        for (i = 0; i < n; i++) {
          if (used[i] || indeg[i] > 0) continue;
          if (pick < 0 || width(i) > width(pick)) pick = i;   // widest first, for stability
        }
        if (pick < 0) {                     // a cycle — this crossing is forced
          for (i = 0; i < n; i++) if (!used[i] && (pick < 0 || width(i) > width(pick))) pick = i;
        }
        used[pick] = true;
        out.push(list[pick]);
        Object.keys(after[pick]).forEach(function (b) { indeg[b]--; });
        after[pick] = {};
      }
      return out;
    }

    var byGap = {};
    runs.forEach(function (r) { (byGap[r.gap] = byGap[r.gap] || []).push(r); });
    var out = {};
    Object.keys(byGap).forEach(function (gapKey) {
      var list = orderRuns(byGap[gapKey]);
      var lanes = [];
      list.forEach(function (r) {
        var x1 = Math.min(r.x1, r.x2), x2 = Math.max(r.x1, r.x2);
        var k = 0;
        while (lanes[k] && lanes[k].some(function (iv) {
          return overlaps(iv[0], iv[1], x1, x2, -o.parallel);
        })) k++;
        (lanes[k] = lanes[k] || []).push([x1, x2]);
        r.lane = k;
      });

      // How much vertical room these lanes want, against what the gap has.
      // The caller is expected to widen the gap and route again (see `gaps` in
      // the return value); compressing is only the fallback for a caller that
      // cannot, and past about four lanes it stops being legible.
      var band = gapBand(Number(gapKey));
      var have = Math.max(0, band.bottom - band.top);
      var need = 2 * o.laneMargin + Math.max(0, lanes.length - 1) * o.laneSpacing;
      out[gapKey] = {
        row: rowsDrawn[Number(gapKey)], lanes: lanes.length,
        have: have, need: need, extra: Math.max(0, need - have),
      };

      var room = Math.max(0, (band.bottom - o.laneMargin) - (band.top + o.laneMargin));
      var step = lanes.length > 1 ? Math.min(o.laneSpacing, room / (lanes.length - 1)) : 0;
      list.forEach(function (r) {
        r.item[r.key + "Y"] = band.bottom - o.laneMargin - r.lane * step;
      });
    });

    return out;
    }   // ---- end of solve() -------------------------------------------------

    // ---- pass 4: emit -------------------------------------------------------
    return {
      gaps: gaps,
      routes: items.map(function (it) {
        var points = dedupe(emit(it));
        return { link: it.link, points: points, chevron: chevronFor(points) };
      }),
    };

    function emit(it) {
      var g = it.geom;
      if (it.kind === "side") {
        // Straight across between the facing edges, squared off if the two
        // ports ended up at different heights.
        var mx = (g.sx + g.tx) / 2;
        return [pt(g.sx, g.sy), pt(mx, g.sy), pt(mx, g.ty), pt(g.tx, g.ty)];
      }
      if (it.shape.kind === "gutter") {
        var ax = it.shape.ascentX;
        return [pt(g.sx, g.sy), pt(g.sx, it.lane1Y), pt(ax, it.lane1Y),
                pt(ax, it.lane2Y), pt(g.tx, it.lane2Y), pt(g.tx, g.ty)];
      }
      // elbow — collapses to a plain vertical line when the two ports share an x.
      return [pt(g.sx, g.sy), pt(g.sx, it.laneY), pt(g.tx, it.laneY), pt(g.tx, g.ty)];
    }
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
