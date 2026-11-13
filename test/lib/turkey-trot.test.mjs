import { test } from "node:test";
import assert from "node:assert/strict";
import { TURKEY_COLORS } from "../../netlify/lib/turkey-colors.mjs";
import { iconForColor, parseDrops, parseProgress, parseRow, parseSheet, rankPlayers, sampleResult } from "../../netlify/lib/turkey-trot.mjs";

const START = "2026-11-19T14:00:00Z", END = "2026-11-21T09:00:00Z";
const cell = (v = "", bg = null) => ({ v, bg });

// A Progress grid row: Start Time, RSN, 26 position cells, Bonus, End Time. Reached cells hold a tick and the player's colour.
const row = ({ rsn = "Alice", ticks = 0, icon = 1, bg, start = START, end = "", bonus = false } = {}) =>
  [cell(start), cell(rsn), ...Array.from({ length: 26 }, (_, i) => i < ticks ? cell("✓", bg === undefined ? TURKEY_COLORS[icon - 1] : bg) : cell()), cell(bonus ? "✓" : ""), cell(end)];

test("a normal row: ticks are the progress and the fill gives the icon and colour", () => {
  assert.deepEqual(parseRow(row({ rsn: "Alice", ticks: 5, icon: 17 })),
    { rsn: "Alice", icon: 17, color: TURKEY_COLORS[16], progress: 5, reachedAt: "2026-11-19T14:00:00.000Z" });
});

test("every accent maps to its own icon, and one step off per channel still matches", () => {
  TURKEY_COLORS.forEach((c, i) => assert.equal(iconForColor(c), i + 1, c));
  const [r, g, b] = [1, 3, 5].map(k => parseInt(TURKEY_COLORS[3].slice(k, k + 2), 16));
  const hex = (...v) => "#" + v.map(n => n.toString(16).padStart(2, "0")).join("");
  assert.equal(iconForColor(hex(r + 1, g - 1, b)), 4);
  assert.equal(iconForColor(hex(r + 2, g, b)), 0);
  for (const bad of [null, "", "red", "#fff", "#ffffff", "#000000"]) assert.equal(iconForColor(bad), 0, String(bad));
});

test("progress counts only the leading ticks", () => {
  const r = row({ ticks: 4 });
  r[2 + 1] = cell();
  assert.equal(parseRow(r).progress, 1);
  assert.equal(parseRow(row({ ticks: 26 })).progress, 26);
  assert.equal(parseRow(row({ ticks: 0 })).progress, 0);
  assert.equal(parseRow(row({ ticks: 3 }).slice(0, 5)).progress, 3);
});

test("a bonus tick in AC never changes progress", () => {
  assert.equal(parseRow(row({ ticks: 3, bonus: true })).progress, 3);
  assert.equal(parseRow(row({ ticks: 0, bonus: true })).progress, 0);
  const finisher = parseRow(row({ ticks: 26, bonus: true, end: END }));
  assert.equal(finisher.progress, 26);
  assert.equal(finisher.reachedAt, "2026-11-21T09:00:00.000Z");
});

test("the bonus does not affect ordering", () => {
  const out = parseProgress([row({ rsn: "NoBonus", ticks: 9, start: "2026-11-19T10:00:00Z" }), row({ rsn: "Bonus", ticks: 9, bonus: true, start: "2026-11-19T11:00:00Z" }),
    row({ rsn: "BonusOnly", ticks: 8, bonus: true, start: "2026-11-19T09:00:00Z" })]);
  assert.deepEqual(out.map(p => p.rsn), ["NoBonus", "Bonus", "BonusOnly"]);
});

test("the colour is the first reached cell's fill, even if later cells differ", () => {
  const r = row({ ticks: 3, icon: 8 });
  r[3] = cell("✓", TURKEY_COLORS[20]);
  assert.equal(parseRow(r).icon, 8);
});

test("no usable fill falls back to the row's place among the data rows", () => {
  for (const bg of [null, "#ffffff", "#123456"]) assert.equal(parseRow(row({ ticks: 2, bg }), 7).icon, 8, String(bg));
  assert.equal(parseRow(row({ ticks: 0 }), 51).icon, 2);
  assert.equal(parseRow(row({ ticks: 2, bg: null }), 7).color, TURKEY_COLORS[7]);
  const out = parseProgress([row({ rsn: "A", ticks: 1, bg: null }), [], row({ rsn: "C", ticks: 1, bg: null })]);
  assert.deepEqual(Object.fromEntries(out.map(p => [p.rsn, p.icon])), { A: 1, C: 3 });
});

test("reachedAt: End Time for a finisher, else Start Time, else null", () => {
  assert.equal(parseRow(row({ ticks: 26, end: END })).reachedAt, "2026-11-21T09:00:00.000Z");
  assert.equal(parseRow(row({ ticks: 26, end: "" })).reachedAt, "2026-11-19T14:00:00.000Z");
  assert.equal(parseRow(row({ ticks: 7, end: END })).reachedAt, "2026-11-19T14:00:00.000Z");
  assert.equal(parseRow(row({ ticks: 7, start: "" })).reachedAt, null);
  assert.equal(parseRow(row({ ticks: 7, start: "soon" })).reachedAt, null);
});

test("bad RSN, empty and junk rows are skipped", () => {
  for (const rsn of ["", "ThirteenChars", "bad<name>", "x".repeat(30)]) assert.equal(parseRow(row({ rsn })), null, rsn);
  for (const bad of [[], null, "junk", [cell(START)]]) assert.equal(parseRow(bad), null);
  assert.equal(parseRow(row({ rsn: "Zezima_1-2" })).rsn, "Zezima_1-2");
});

test("only the five public fields are output", () => {
  const out = parseSheet([row({ ticks: 3 }), row({ rsn: "Bob", ticks: 9 })], [["1", "Dragon pickaxe"]]);
  assert.deepEqual(Object.keys(out.players[0]).sort(), ["color", "icon", "progress", "reachedAt", "rsn"]);
});

test("ordering: finishers by time, then spaces, then who got there first", () => {
  const p = (rsn, progress, reachedAt) => ({ rsn, icon: 1, color: "#000000", progress, reachedAt });
  const ranked = rankPlayers([
    p("Late", 10, "2026-11-20T12:00:00.000Z"),
    p("FinishB", 26, "2026-11-22T10:00:00.000Z"),
    p("Most", 20, "2026-11-23T10:00:00.000Z"),
    p("Early", 10, "2026-11-20T09:00:00.000Z"),
    p("FinishA", 26, "2026-11-21T10:00:00.000Z"),
    p("Zero", 0, null),
  ]);
  assert.deepEqual(ranked.map(x => x.rsn), ["FinishA", "FinishB", "Most", "Early", "Late", "Zero"]);
});

test("bad rows are skipped and a repeated RSN keeps the first row", () => {
  const out = parseProgress([row({ rsn: "Alice", ticks: 3 }), row({ rsn: "Bad Name!", ticks: 3 }), row({ rsn: "alice", ticks: 9 }), "junk", null]);
  assert.deepEqual(out.map(x => [x.rsn, x.progress]), [["Alice", 3]]);
});

test("more than 50 players are kept and the icons repeat", () => {
  const rows = Array.from({ length: 60 }, (_, i) => row({ rsn: "P" + i, ticks: 1, icon: (i % 50) + 1 }));
  const out = parseProgress(rows);
  assert.equal(out.length, 60);
  assert.equal(new Set(out.map(x => x.icon)).size, 50);
});

test("drops are numbered, trimmed and de-duplicated", () => {
  assert.deepEqual(parseDrops([["2", " Abyssal whip "], ["1", "Dragon pickaxe"], ["1", "Duplicate"], ["27", "Too far"], ["3", ""], ["x", "No"]]),
    [{ n: 1, name: "Dragon pickaxe" }, { n: 2, name: "Abyssal whip" }]);
  assert.deepEqual(parseDrops(undefined), []);
});

test("the sample is valid and moves over time", () => {
  const a = sampleResult(1_000_000), b = sampleResult(1_000_000 + 60_000);
  assert.equal(a.drops.length, 26);
  assert.ok(a.players.length > 20);
  assert.deepEqual(parseProgress(a.players.map(p => row({ ...p, ticks: p.progress }))).length, a.players.length);
  assert.ok(a.players.every(p => p.color === TURKEY_COLORS[p.icon - 1]));
  assert.notDeepEqual(a.players.map(p => p.progress).sort(), b.players.map(p => p.progress).sort());
});

test("a still sample puts n players on different random spaces, the same for the same seed", () => {
  const a = sampleResult(1_000_000, { n: 3, seed: 7 }), b = sampleResult(2_000_000, { n: 3, seed: 7 }), c = sampleResult(1_000_000, { n: 3, seed: 8 });
  assert.equal(a.players.length, 3);
  const spaces = a.players.map(p => p.progress);
  assert.equal(new Set(spaces).size, 3);
  assert.ok(spaces.every(n => n >= 1 && n <= 26));
  assert.equal(new Set(a.players.map(p => p.icon)).size, 3);
  assert.deepEqual(b.players.map(p => [p.rsn, p.progress, p.icon]), a.players.map(p => [p.rsn, p.progress, p.icon]));
  assert.notDeepEqual(c.players.map(p => p.progress), spaces);
  assert.equal(sampleResult(0, { n: 1, seed: 1 }).players.length, 1);
  assert.equal(sampleResult(0, { n: 99, seed: 1 }).players.length, 24);
  assert.ok(a.players.every(p => p.color === TURKEY_COLORS[p.icon - 1]));
});

test("a sample without n is the moving 24-player sample", () => {
  assert.equal(sampleResult(1_000_000).players.length, 24);
});
