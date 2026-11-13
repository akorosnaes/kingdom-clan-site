/* Turkey Trot board hook. Plain script, no build step: load it with a script tag and use window.TrotBoard.
 *
 * data     board/spots.json   (spots, route, cluster and start-stack settings)
 * players  [{ rsn, icon, progress }]   progress 0..26
 *
 * Positions are map pixels (2098 x 1760 for the current board). Convert to percentages of the board image with x / data.size[0].
 * Players with progress 0 are not drawn one by one: the Start spot shows a stack of idle turkeys instead.
 */
(function () {
  var rad = function (d) { return d * Math.PI / 180; };
  var angDiff = function (a, b) { var d = Math.abs(((a - b) % 360 + 540) % 360 - 180); return d; };

  // Positions for up to data.cluster.badgeAfter turkeys on one spot, in fill order:
  // slot 0 on the spot, then ring 1, 2, 3 around it. Each ring skips the arc that faces the spot's number
  // and starts on the side opposite the number, so the group grows away from it.
  function clusterSlots(data, spot) {
    var c = data.cluster, W = data.size[0], H = data.size[1], half = c.turkey / 2, out = [{ x: spot.x, y: spot.y }];
    var counts = [0, 6, 12, 18], base = spot.labelAngle + 180;
    for (var r = 1; r < c.rings.length; r++) {
      var ring = [];
      for (var k = 0; k < counts[r]; k++) {
        var a = base + k * 360 / counts[r];
        if (angDiff(a, spot.labelAngle) < c.labelGap) continue;
        var x = spot.x + Math.cos(rad(a)) * c.rings[r], y = spot.y + Math.sin(rad(a)) * c.rings[r];
        if (x < half || y < half || x > W - half || y > H - half) continue;
        ring.push({ x: x, y: y, d: angDiff(a, base) });
      }
      ring.sort(function (p, q) { return p.d - q.d; });
      out = out.concat(ring);
    }
    return out.slice(0, c.badgeAfter);
  }

  // Where each player stands. Order on a spot is stable (icon, then RSN), so nobody swaps places when someone arrives.
  function layout(data, players) {
    var by = {}, place = Object.create(null), badges = [];
    players.forEach(function (p) { if (p.progress > 0) (by[p.progress] = by[p.progress] || []).push(p); });
    Object.keys(by).forEach(function (k) {
      var spot = data.spots[+k], list = by[k].sort(function (a, b) { return a.icon - b.icon || a.rsn.localeCompare(b.rsn); });
      var slots = clusterSlots(data, spot);
      list.forEach(function (p, i) {
        if (i < slots.length) place[p.rsn] = { spot: +k, x: slots[i].x, y: slots[i].y };
        else place[p.rsn] = { spot: +k, hidden: true };
      });
      if (list.length > slots.length) badges.push({ spot: +k, x: spot.x, y: spot.y, more: list.length - slots.length });
    });
    var st = data.start;
    return { place: place, badges: badges, stack: st.stack.map(function (s) { return { x: data.spots[0].x + s.dx, y: data.spots[0].y + s.dy }; }) };
  }

  // Points a turkey walks through from spot a to spot b (a < b), in map pixels, along the drawn route.
  function pathBetween(data, a, b) {
    var ra = data.spots[a].route, rb = data.spots[b].route, W = data.size[0], H = data.size[1], pts = [];
    var lo = Math.min(ra, rb), hi = Math.max(ra, rb);
    for (var i = lo; i <= hi; i++) pts.push([data.route[i][0] * W, data.route[i][1] * H]);
    return ra <= rb ? pts : pts.reverse();
  }

  // Which way to face while moving from p to q. Mostly vertical steps keep the previous facing.
  function facing(last, p, q) {
    var dx = q[0] - p[0];
    return Math.abs(dx) > 0.35 * Math.abs(q[1] - p[1]) && Math.abs(dx) > 0.5 ? (dx > 0 ? "right" : "left") : last;
  }

  window.TrotBoard = { clusterSlots: clusterSlots, layout: layout, pathBetween: pathBetween, facing: facing };
})();
