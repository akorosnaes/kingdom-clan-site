import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const dir = new URL("../../turkey-trot/board/", import.meta.url);
const S = JSON.parse(readFileSync(new URL("spots.json", dir), "utf8"));
const window = {};
vm.runInNewContext(readFileSync(new URL("board-hook.js", dir), "utf8"), { window });
// The hook runs in its own realm; a JSON round trip gives plain objects that deepEqual accepts
const plain = f => (...args) => JSON.parse(JSON.stringify(f(...args)));
const { clusterSlots, layout, pathBetween, facing } = Object.fromEntries(Object.entries(window.TrotBoard).map(([k, f]) => [k, plain(f)]));

const angle = (spot, q) => Math.atan2(q.y - spot.y, q.x - spot.x) * 180 / Math.PI;
const diff = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
const player = (rsn, icon, progress) => ({ rsn, icon, progress });

test("spots.json has Start plus 26 drops", () => {
  assert.equal(S.spots.length, 27);
  assert.deepEqual(S.spots.map(s => s.n), Array.from({ length: 27 }, (_, i) => i));
});

test("cluster slots start on the spot, avoid the number arc and stay on the board", () => {
  const half = S.cluster.turkey / 2;
  for (const spot of S.spots) {
    const slots = clusterSlots(S, spot);
    assert.deepEqual(slots[0], { x: spot.x, y: spot.y });
    assert.ok(slots.length > 12 && slots.length <= S.cluster.badgeAfter, `spot ${spot.n} has ${slots.length} slots`);
    for (const q of slots.slice(1)) {
      assert.ok(diff(angle(spot, q), spot.labelAngle) >= S.cluster.labelGap - 1e-6, `spot ${spot.n} slot faces its number`);
      assert.ok(q.x >= half && q.y >= half && q.x <= S.size[0] - half && q.y <= S.size[1] - half);
    }
  }
});

test("the first ring grows away from the number", () => {
  const spot = S.spots[13], first = clusterSlots(S, spot)[1];
  assert.ok(diff(angle(spot, first), spot.labelAngle + 180) < 40);
});

test("layout order is stable by icon then RSN, whatever the input order", () => {
  const list = [player("Cc", 3, 5), player("Aa", 3, 5), player("Bb", 1, 5), player("Dd", 9, 7)];
  const a = layout(S, list), b = layout(S, list.slice().reverse());
  assert.deepEqual(a.place, b.place);
  const slots = clusterSlots(S, S.spots[5]);
  assert.deepEqual([a.place.Bb, a.place.Aa, a.place.Cc].map(p => [p.x, p.y]), slots.slice(0, 3).map(q => [q.x, q.y]));
  assert.equal(a.place.Dd.spot, 7);
});

test("progress 0 is not placed and the Start stack is two points", () => {
  const out = layout(S, [player("Zero", 1, 0), player("One", 2, 1)]);
  assert.ok(!("Zero" in out.place));
  assert.equal(out.stack.length, 2);
  out.stack.forEach((p, i) => assert.deepEqual(p, { x: S.spots[0].x + S.start.stack[i].dx, y: S.spots[0].y + S.start.stack[i].dy }));
});

test("more players than slots collapse into a +N badge", () => {
  const crowd = Array.from({ length: 30 }, (_, i) => player("P" + String(i).padStart(2, "0"), (i % 50) + 1, 4));
  const out = layout(S, crowd);
  const shown = Object.values(out.place).filter(p => !p.hidden);
  const slots = clusterSlots(S, S.spots[4]).length;
  assert.equal(shown.length, slots);
  assert.deepEqual(out.badges.map(b => [b.spot, b.more]), [[4, 30 - slots]]);
});

test("pathBetween follows the route in either direction", () => {
  const fwd = pathBetween(S, 2, 5), back = pathBetween(S, 5, 2);
  assert.equal(fwd.length, S.spots[5].route - S.spots[2].route + 1);
  assert.deepEqual(back, fwd.slice().reverse());
  assert.deepEqual(fwd[0], [S.route[S.spots[2].route][0] * S.size[0], S.route[S.spots[2].route][1] * S.size[1]]);
});

test("facing follows horizontal travel and keeps the last facing on vertical steps", () => {
  assert.equal(facing("left", [0, 0], [10, 0]), "right");
  assert.equal(facing("right", [0, 0], [-10, 0]), "left");
  assert.equal(facing("left", [0, 0], [1, 50]), "left");
  assert.equal(facing("right", [0, 0], [0, 0]), "right");
});

test("a player whose name is __proto__ still gets a place", () => {
  const out = layout(S, [player("__proto__", 1, 3), player("Ann", 2, 3)]);
  assert.equal(Object.keys(out.place).length, 2);
  assert.ok(Object.hasOwn(out.place, "__proto__"));
  assert.equal(out.place["__proto__"].spot, 3);
});
