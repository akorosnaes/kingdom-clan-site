// Bingo storage in Netlify Blobs:
//   "board"     the board: tiles, teams (colour, captain, progress), bonus, and the drop log of approved drops
//   "items"     admin edits to each boss's item list (on top of the defaults in bingo-items.mjs)
//   "subs"      drops captains have submitted, with their review status
//   "captains"  names of captains who've logged in, so staff can pick them by name
//   "img/<id>"  custom tile images
import { getStore } from "@netlify/blobs";
import { purgeCache } from "@netlify/functions";
import { DEFAULT_ITEMS } from "./bingo-items.mjs";

export const store = () => getStore({ name: "bingo", consistency: "strong" });
export const imageKey = id => "img/" + id;
export const IMAGE_ID = /^[a-f0-9]{18}$/;
export const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const MAX_BYTES = 512 * 1024;

export const SIZE = 25, BONUS = 25, MAX_ITEMS = 60, LOG_MAX = 1000, SUBS_MAX = 1000;
export const CACHE_TAG = "bingo";
export const blankTile = () => ({ boss: "", img: "", name: "", desc: "", points: 0, need: 1, items: [] });
const EMPTY = () => ({ rev: 0, title: "", bonus: BONUS, tiles: Array.from({ length: SIZE }, blankTile), teams: [], log: [], updated: 0, by: "" });

// Team progress is one number per tile ("p"):
//   0 not started, 1..need completions so far (need = completed), and -1 for a one-and-done tile that's in progress.
// Boards saved before tiles had "need" stored a 25-character string ("s": 0 not started, 1 in progress, 2 completed).
const fromLegacy = s => [...s].map(c => c === "2" ? 1 : c === "1" ? -1 : 0);
function upgrade(b){
  b.bonus ??= BONUS;
  b.log ??= [];
  b.tiles = b.tiles.map(t => ({ ...t, need: t.need || 1, items: t.items || [] }));
  b.teams = b.teams.map(({ s, ...t }) => ({ ...t, captain: t.captain || "", p: Array.isArray(t.p) ? t.p : fromLegacy(s || "") }));
  return b;
}

export async function readBoard(s = store()){
  const b = await s.get("board", { type: "json" });
  return b && Array.isArray(b.tiles) ? upgrade(b) : EMPTY();
}

// Saves the board as the next revision and clears the CDN copy viewers read
export async function saveBoard(board, by, s = store()){
  const next = { ...board, rev: (board.rev || 0) + 1, updated: Date.now(), by };
  await s.setJSON("board", next);
  await purge();
  return next;
}
// If the purge fails, viewers still catch up when the cached copy expires (60s)
export async function purge(){
  try { await purgeCache({ tags: [CACHE_TAG] }); } catch (e) { console.error("Bingo cache purge failed:", e.message); }
}

// Each boss's item list: the admin's edited list if there is one, otherwise the defaults
export async function readItemEdits(s = store()){
  return (await s.get("items", { type: "json" })) || {};
}
export const itemsFor = (boss, edits) => edits[boss] || DEFAULT_ITEMS[boss] || [];

export async function readSubs(s = store()){
  const list = await s.get("subs", { type: "json" });
  return Array.isArray(list) ? list : [];
}
export const writeSubs = (list, s = store()) => s.setJSON("subs", list.slice(-SUBS_MAX));

// One step of progress for a team on a tile, forward (approving a drop) or back (undoing one)
export function bump(team, tile, need, dir){
  const v = team.p[tile];
  team.p[tile] = dir > 0 ? (need === 1 ? 1 : Math.min(need, Math.max(0, v) + 1)) : Math.max(0, v - 1);
}

export const text = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
