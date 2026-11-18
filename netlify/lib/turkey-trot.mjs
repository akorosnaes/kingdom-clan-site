// Turkey Trot sheet parser. Pure: rows in, the public leaderboard out.
//
// "Progress" is read as a grid (readGrid in google.mjs): rows of cells { v, bg, note }, v the text, bg the fill as "#rrggbb" or null.
//   Header: Start Time, RSN, 1..26, Bonus - 27, End Time. Columns: A start, B RSN, C..AB positions 1..26, AC bonus, AD end.
//   Progress is the number of leading "✓" cells in C..AB. Each reached cell has a note with the ISO time the player reached that tile.
//   The player's colour is the fill of their reached cells (the bonus cell if they have none); it is one of the 50 turkey accents
//   (turkey-colors.mjs), which gives the icon. The bonus tick in AC never counts toward progress or ordering.
// "Drops" rows are plain values: position, name.
import { TURKEY_COLORS } from "./turkey-colors.mjs";

export const TOTAL = 26;

const RSN = /^[A-Za-z0-9 _-]{1,12}$/;
const COL = { start: 0, rsn: 1, tick: 2, bonus: 28, end: 29 };
const TOLERANCE = 1;   // Google hands back fills as 0..1 floats; allow one step per channel after rounding

const text = c => String(c?.v ?? "").trim();
const toInt = v => {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  return /^\d+$/.test(s) ? Number(s) : NaN;
};
const toIso = v => { const t = Date.parse(String(v ?? "").trim()); return Number.isNaN(t) ? null : new Date(t).toISOString(); };

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const ACCENTS = TURKEY_COLORS.map(rgb);

// The icon (1 to 50) whose accent is the closest to this fill, or 0 when none is within the tolerance
export function iconForColor(hex){
  if (!/^#[0-9a-f]{6}$/i.test(hex || "")) return 0;
  const c = rgb(hex);
  let best = 0, bestDist = Infinity;
  ACCENTS.forEach((a, i) => {
    const d = c.map((v, k) => Math.abs(v - a[k]));
    const sum = d[0] + d[1] + d[2];
    if (Math.max(...d) <= TOLERANCE && sum < bestDist) { best = i + 1; bestDist = sum; }
  });
  return best;
}

function reached(row){
  const cells = [];
  while (cells.length < TOTAL && text(row[COL.tick + cells.length]).includes("✓")) cells.push(row[COL.tick + cells.length]);
  return cells;
}

// One Progress row as { rsn, icon, color, progress, bonus, startedAt, reachedAt, endedAt }, or null when there is no valid RSN.
// Times are ISO strings or null. reachedAt is the note of the last reached tile, else the end time of a finisher, else the start time.
// index is the row's place among the data rows: with no usable fill the icon is index % 50 + 1.
export function parseRow(row, index = 0){
  if (!Array.isArray(row)) return null;
  const rsn = text(row[COL.rsn]);
  if (!RSN.test(rsn)) return null;
  const cells = reached(row), progress = cells.length, bonusCell = row[COL.bonus];
  const bonus = text(bonusCell).includes("✓");
  const icon = iconForColor(cells.find(c => c.bg)?.bg || (bonus && bonusCell.bg)) || index % 50 + 1;
  const startedAt = toIso(text(row[COL.start])), endedAt = toIso(text(row[COL.end]));
  const reachedAt = toIso(cells.at(-1)?.note) || (progress >= TOTAL && endedAt) || startedAt;
  return { rsn, icon, color: TURKEY_COLORS[icon - 1], progress, bonus, startedAt, reachedAt, endedAt };
}

// Finishers first by end time, then most tiles, then whoever reached theirs first; players with no tile last, by RSN. The bonus plays no part.
export function rankPlayers(players){
  const t = v => v ? Date.parse(v) : Infinity;
  const group = p => p.progress >= TOTAL ? 0 : p.progress > 0 ? 1 : 2;
  return players.slice().sort((a, b) => group(a) - group(b) ||
    (group(a) === 0 ? t(a.endedAt ?? a.reachedAt) - t(b.endedAt ?? b.reachedAt)
      : group(a) === 1 ? b.progress - a.progress || t(a.reachedAt) - t(b.reachedAt) : 0) || a.rsn.localeCompare(b.rsn));
}

const same = rsn => rsn.toLowerCase().replace(/[_-]/g, " ");

export function parseDrops(rows){
  const byN = new Map();
  for (const r of rows || []) {
    const n = toInt(r?.[0]), name = String(r?.[1] ?? "").trim().slice(0, 100);
    if (Number.isInteger(n) && n >= 1 && n <= TOTAL && name && !byN.has(n)) byN.set(n, name);
  }
  return [...byN].sort((a, b) => a[0] - b[0]).map(([n, name]) => ({ n, name }));
}

export function parseProgress(rows){
  const seen = new Set(), players = [];
  for (const [i, row] of (rows || []).entries()) {
    const p = parseRow(row, i);
    if (!p || seen.has(same(p.rsn))) continue;
    seen.add(same(p.rsn));
    players.push(p);
  }
  return rankPlayers(players);
}

export const parseSheet = (progressRows, dropRows) =>
  ({ total: TOTAL, drops: parseDrops(dropRows), players: parseProgress(progressRows) });

const SAMPLE_NAMES = ["Ashen", "Birch", "Cedar", "Dusk", "Ember", "Fable", "Gale", "Hazel", "Iris", "Juniper", "Kestrel", "Lark",
  "Maple", "Nettle", "Onyx", "Pine", "Quill", "Rowan", "Sorrel", "Thistle", "Umber", "Vale", "Willow", "Yarrow"];

// A small seeded random generator, so a sample can be reproduced from its seed
const seeded = seed => { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

const stamp = ms => new Date(ms).toISOString();

// A sample player with believable times: the last tile reached at reachedMs, the first one `progress * 9 + 12` minutes before
const samplePlayer = (rsn, icon, progress, bonus, reachedMs) => ({
  rsn, icon, color: TURKEY_COLORS[icon - 1], progress, bonus,
  startedAt: progress ? stamp(reachedMs - (progress * 9 + 12) * 60000) : null,
  reachedAt: progress ? stamp(reachedMs) : null,
  endedAt: progress >= TOTAL ? stamp(reachedMs) : null,
});
const sampleDrops = () => Array.from({ length: TOTAL }, (_, i) => ({ n: i + 1, name: `Sample drop ${i + 1}` }));

// A still sample: `n` players (1 to 24) on different random spaces, the same for the same seed
function stillSample(n, seed, nowMs){
  const rnd = seeded(seed), spaces = Array.from({ length: TOTAL }, (_, i) => i + 1), icons = Array.from({ length: 50 }, (_, i) => i);
  const pick = list => list.splice(Math.floor(rnd() * list.length), 1)[0];
  const players = Array.from({ length: Math.min(24, Math.max(1, n | 0)) }, (_, i) =>
    samplePlayer(SAMPLE_NAMES[i], pick(icons) + 1, pick(spaces), i % 3 === 0, nowMs - i * 60000));
  return { total: TOTAL, drops: sampleDrops(), players: rankPlayers(players) };
}

// Made-up players for building the page before the sheet exists. With opts.n it is a still picture of n players on random
// spaces (opts.seed repeats it); without, 24 players that keep moving. Every third has the bonus; players 1, 3 and 5 tie with
// the one before them on the same tile, a minute and a half after.
export function sampleResult(nowMs = Date.now(), opts = {}){
  if (opts.n) return stillSample(opts.n, Number.isFinite(opts.seed) ? opts.seed : Math.floor(Math.random() * 2 ** 32), nowMs);
  const t = nowMs / 1000, cycle = 360;
  const base = SAMPLE_NAMES.map((name, i) => {
    const step = cycle / (TOTAL + 1 + (i % 5) * 3), phase = (t + i * 47) % cycle;
    return { progress: Math.min(TOTAL, Math.floor(phase / step)), reachedMs: nowMs - (phase % step) * 1000 };
  });
  for (const k of [0, 1, 2]) {
    const lead = base[2 * k], at = lead.reachedMs;
    lead.reachedMs = at - 90000;
    base[2 * k + 1] = { progress: lead.progress, reachedMs: at };
  }
  const players = SAMPLE_NAMES.map((name, i) => samplePlayer(name, (i % 50) + 1, base[i].progress, i % 3 === 0, base[i].reachedMs));
  return { total: TOTAL, drops: sampleDrops(), players: rankPlayers(players) };
}
