// /api/bingo
//   GET  anyone: the bingo board (25 tiles, each with a boss or custom image, name, description, points and how many completions it needs),
//        the bonus points per bingo, and every team's colour and progress
//        Served from Netlify's CDN cache so viewers can check every few seconds for free;
//        every save clears that cache. ?staff=1 skips the cache.
//   PUT  staff:  save the whole board. Send back the "rev" you loaded; if someone else saved since, you get 409 and the latest board.
import { purgeCache } from "@netlify/functions";
import { getStaff, json, sameOrigin } from "../lib/auth.mjs";
import { IMAGE_ID, imageKey, store } from "../lib/bingo.mjs";

const CACHE_TAG = "bingo";
const CDN_CACHE = { "cache-control": "public, max-age=0, must-revalidate",
  "netlify-cdn-cache-control": "public, durable, s-maxage=60", "cache-tag": CACHE_TAG, "netlify-vary": "query" };

const SIZE = 25, MAX_TEAMS = 16;
// Default team colours, handed out in order
const COLORS = ["#e5484d", "#3e63dd", "#30a46c", "#f5d90a", "#8e4ec6", "#f76b15", "#12a594", "#d6409f"];
const COLOR = /^#[0-9a-f]{6}$/i;
const MAX_NEED = 99;
const blankTile = () => ({ boss: "", img: "", name: "", desc: "", points: 0, need: 1 });
const BONUS = 25;   // default points for each completed row or column
const EMPTY = { rev: 0, title: "", bonus: BONUS, tiles: Array.from({ length: SIZE }, blankTile), teams: [], updated: 0, by: "" };

// Team progress is one number per tile ("p"):
//   0 not started, 1..need completions so far (need = completed), and -1 for a one-and-done tile that's in progress.
// Boards saved before tiles had "need" stored a 25-character string ("s": 0 not started, 1 in progress, 2 completed).
const fromLegacy = s => [...s].map(c => c === "2" ? 1 : c === "1" ? -1 : 0);
function upgrade(b){
  b.bonus ??= BONUS;
  b.tiles = b.tiles.map(t => ({ ...t, need: t.need || 1 }));
  b.teams = b.teams.map(({ s, ...t }) => ({ ...t, p: Array.isArray(t.p) ? t.p : fromLegacy(s || "") }));
  return b;
}

async function read(s = store()){
  const b = await s.get("board", { type: "json" });
  return b && Array.isArray(b.tiles) ? upgrade(b) : EMPTY;
}

const text = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const BOSS = /^[a-z_]{0,40}$/;      // a Wise Old Man boss name, or "" for a custom tile (which may have an uploaded image)

// Checks and tidies a board sent by the staff page. Returns an error message or the clean board.
function clean(body){
  if (!body || typeof body !== "object" || !Array.isArray(body.tiles) || !Array.isArray(body.teams)) return "Bad bingo data.";
  if (body.tiles.length !== SIZE) return "The board must have 25 tiles.";
  if (body.teams.length > MAX_TEAMS) return `Up to ${MAX_TEAMS} teams.`;
  const bonus = body.bonus == null ? BONUS : Number(body.bonus);
  if (!Number.isInteger(bonus) || bonus < 0 || bonus > 9999) return "Points per bingo must be a whole number from 0 to 9999.";
  const tiles = [];
  for (const t of body.tiles) {
    const boss = String(t?.boss ?? "");
    if (!BOSS.test(boss)) return "Bad boss name.";
    const points = Number(t?.points);
    if (!Number.isInteger(points) || points < 0 || points > 9999) return "Points must be a whole number from 0 to 9999.";
    const img = boss ? "" : String(t?.img ?? "");
    if (img && !IMAGE_ID.test(img)) return "Bad tile image.";
    const need = t?.need == null ? 1 : Number(t.need);
    if (!Number.isInteger(need) || need < 1 || need > MAX_NEED) return `Completions needed must be from 1 to ${MAX_NEED}.`;
    tiles.push({ boss, img, name: text(t?.name, 40), desc: text(t?.desc, 80), points, need });
  }
  const teams = [];
  for (const [i, t] of body.teams.entries()) {
    const p = t?.p;
    if (!Array.isArray(p) || p.length !== SIZE || !p.every(v => Number.isInteger(v) && v >= -1 && v <= MAX_NEED)) return "Bad tile progress.";
    const color = COLOR.test(t?.color) ? t.color.toLowerCase() : COLORS[i % COLORS.length];
    // A count can't go past what the tile needs; "in progress" (-1) only applies to one-and-done tiles
    teams.push({ name: text(t?.name, 40) || `Team ${i + 1}`, color,
      p: p.map((v, j) => v === -1 ? (tiles[j].need === 1 ? -1 : 0) : Math.min(v, tiles[j].need)) });
  }
  return { title: text(body.title, 60), bonus, tiles, teams };
}

export default async req => {
  const staff = getStaff(req);
  if (req.method === "GET")
    return new URL(req.url).searchParams.has("staff") ? json(await read()) : json(await read(), 200, CDN_CACHE);

  if (!staff) return json({ error: "Log in with an approved Discord account first." }, 401);
  if (!sameOrigin(req)) return json({ error: "Bad origin." }, 403);
  if (req.method !== "PUT") return json({ error: "Method not allowed." }, 405, { allow: "GET, PUT" });

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad bingo data." }, 400); }
  const board = clean(body);
  if (typeof board === "string") return json({ error: board }, 400);

  const s = store(), cur = await read(s);
  if (body.rev !== cur.rev) return json({ error: "Someone else changed the bingo board. Showing the latest version.", board: cur }, 409);
  const next = { ...board, rev: cur.rev + 1, updated: Date.now(), by: staff.name };
  await s.setJSON("board", next);
  // Delete custom images the board no longer uses
  const kept = new Set(next.tiles.map(t => t.img));
  await Promise.all(cur.tiles.map(t => t.img).filter(id => id && !kept.has(id)).map(id => s.delete(imageKey(id)).catch(() => {})));
  // If the purge fails, viewers still catch up when the cached copy expires (60s)
  try { await purgeCache({ tags: [CACHE_TAG] }); } catch (e) { console.error("Bingo cache purge failed:", e.message); }
  return json(next);
};

export const config = { path: "/api/bingo" };
