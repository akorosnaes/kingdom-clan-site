// Turkey Trot sheet parser. Pure: rows in, the public leaderboard out.
//
// "Progress" is read as a grid (readGrid in google.mjs): rows of cells { v, bg }, v the text and bg the fill as "#rrggbb" or null.
//   Header: Start Time, RSN, 1..26, Bonus, End Time. Columns: A start, B RSN, C..AB positions 1..26, AC bonus, AD end.
//   The bonus tick in AC does not count toward progress or ordering.
//   Progress is the number of leading "✓" cells. The player's colour is the fill of their reached cells; it is one of the
//   50 turkey accents (turkey-colors.mjs), which gives the icon. There are no progress, colour or icon columns.
// "Drops" rows are plain values: position, name.
import { TURKEY_COLORS } from "./turkey-colors.mjs";

export const TOTAL = 26;

const RSN = /^[A-Za-z0-9 _-]{1,12}$/;
const COL = { start: 0, rsn: 1, tick: 2, end: 29 };
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

// One Progress row as { rsn, icon, color, progress, reachedAt }, or null when there is no valid RSN.
// index is the row's place among the data rows: with no usable fill the icon is index % 50 + 1.
export function parseRow(row, index = 0){
  if (!Array.isArray(row)) return null;
  const rsn = text(row[COL.rsn]);
  if (!RSN.test(rsn)) return null;
  const cells = reached(row), progress = cells.length;
  const icon = iconForColor(cells.find(c => c.bg)?.bg) || index % 50 + 1;
  const at = progress >= TOTAL ? toIso(text(row[COL.end])) : null;
  return { rsn, icon, color: TURKEY_COLORS[icon - 1], progress, reachedAt: at || toIso(text(row[COL.start])) };
}

// Finishers first by completion time, then most spaces covered, then whoever got there first
export function rankPlayers(players){
  const at = p => p.reachedAt ? Date.parse(p.reachedAt) : Infinity;
  const done = p => p.progress >= TOTAL;
  return players.slice().sort((a, b) =>
    done(b) - done(a) || (done(a) ? 0 : b.progress - a.progress) || at(a) - at(b) || a.rsn.localeCompare(b.rsn));
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

// A still sample: `n` players (1 to 24) on different random spaces, the same for the same seed
function stillSample(n, seed, nowMs){
  const rnd = seeded(seed), spaces = Array.from({ length: TOTAL }, (_, i) => i + 1), icons = Array.from({ length: 50 }, (_, i) => i);
  const pick = list => list.splice(Math.floor(rnd() * list.length), 1)[0];
  const players = Array.from({ length: Math.min(24, Math.max(1, n | 0)) }, (_, i) => {
    const icon = pick(icons);
    return { rsn: SAMPLE_NAMES[i], icon: icon + 1, color: TURKEY_COLORS[icon], progress: pick(spaces), reachedAt: new Date(nowMs - i * 60000).toISOString() };
  });
  return { total: TOTAL, drops: Array.from({ length: TOTAL }, (_, i) => ({ n: i + 1, name: `Sample drop ${i + 1}` })), players: rankPlayers(players) };
}

// Made-up players for building the page before the sheet exists. With opts.n it is a still picture of n players on random
// spaces (opts.seed repeats it); without, 24 players that keep moving.
export function sampleResult(nowMs = Date.now(), opts = {}){
  if (opts.n) return stillSample(opts.n, Number.isFinite(opts.seed) ? opts.seed : Math.floor(Math.random() * 2 ** 32), nowMs);
  const t = nowMs / 1000, cycle = 360;
  const players = SAMPLE_NAMES.map((name, i) => {
    const step = cycle / (TOTAL + 1 + (i % 5) * 3), phase = (t + i * 47) % cycle;
    const progress = Math.min(TOTAL, Math.floor(phase / step));
    return { rsn: name, icon: (i % 50) + 1, color: TURKEY_COLORS[i % 50], progress, reachedAt: new Date(nowMs - (phase % step) * 1000).toISOString() };
  });
  return { total: TOTAL, drops: Array.from({ length: TOTAL }, (_, i) => ({ n: i + 1, name: `Sample drop ${i + 1}` })), players: rankPlayers(players) };
}
