// /api/bingo
//   GET  anyone: the bingo board (25 tiles, each with a boss or custom image, name, description, points and how many completions it needs),
//        the bonus points per bingo, every team's colour and progress, the drop log, the item list for each boss on the board,
//        the start and end times, and the competition link the EHB leaderboard reads.
//        Before the start time the tiles are blanked for everyone but staff ("hidden": true).
//        Served from Netlify's CDN cache so viewers can check every few seconds for free;
//        every save clears that cache. ?staff=1 skips the cache.
//   PUT  staff:  save the whole board. Send back the "rev" you loaded; if someone else saved since, you get 409 and the latest board.
//        The drop log isn't sent back: it only changes through drop approvals, or { clearLog: true } to empty it
//        (used by "Reset all progress" and "Clear board"), which also clears every submitted drop.
import { getStaff, json, sameOrigin } from "../lib/auth.mjs";
import { blankTile, BONUS, CACHE_TAG, IMAGE_ID, imageKey, itemsFor, MAX_ITEMS, readBoard, readItemEdits, saveBoard, SIZE, store, text, writeSubs } from "../lib/bingo.mjs";

const CDN_CACHE = { "cache-control": "public, max-age=0, must-revalidate",
  "netlify-cdn-cache-control": "public, durable, s-maxage=60", "cache-tag": CACHE_TAG, "netlify-vary": "query" };

const MAX_TEAMS = 16, MAX_NEED = 99;
// Default team colours, handed out in order
const COLORS = ["#e5484d", "#3e63dd", "#30a46c", "#f5d90a", "#8e4ec6", "#f76b15", "#12a594", "#d6409f"];
const COLOR = /^#[0-9a-f]{6}$/i;
const BOSS = /^[a-z_]{0,40}$/;      // a Wise Old Man boss name, or "" for a custom tile (which may have an uploaded image)
const DISCORD_ID = /^\d{5,25}$/;
// The EHB leaderboard reads a Wise Old Man or TempleOSRS competition
const TRACK = /^https:\/\/(?:www\.)?(?:wiseoldman\.net\/competitions\/\d+|templeosrs\.com\/competitions\/[\w.]*\?(?:[^#\s]*&)?id=\d+)[^\s<>"]*$/i;
const when = v => Number.isInteger(v) && v > 0 ? v : 0;

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
    // Custom tiles keep their own item list; boss tiles use the boss's list (edited through /api/bingo/items)
    const items = boss || !Array.isArray(t?.items) ? [] : [...new Set(t.items.map(i => text(i, 60)).filter(Boolean))].slice(0, MAX_ITEMS);
    tiles.push({ boss, img, name: text(t?.name, 40), desc: text(t?.desc, 80), points, need, items });
  }
  const teams = [];
  for (const [i, t] of body.teams.entries()) {
    const p = t?.p;
    if (!Array.isArray(p) || p.length !== SIZE || !p.every(v => Number.isInteger(v) && v >= -1 && v <= MAX_NEED)) return "Bad tile progress.";
    const color = COLOR.test(t?.color) ? t.color.toLowerCase() : COLORS[i % COLORS.length];
    const captain = DISCORD_ID.test(t?.captain) ? t.captain : "";
    // A count can't go past what the tile needs; "in progress" (-1) only applies to one-and-done tiles
    teams.push({ name: text(t?.name, 40) || `Team ${i + 1}`, color, captain,
      p: p.map((v, j) => v === -1 ? (tiles[j].need === 1 ? -1 : 0) : Math.min(v, tiles[j].need)) });
  }
  const starts = when(body.starts), ends = when(body.ends);
  if (starts && ends && ends <= starts) return "The end time must be after the start time.";
  const track = String(body.track ?? "").trim();
  if (track && (track.length > 300 || !TRACK.test(track))) return "The EHB tracking link must be a Wise Old Man or TempleOSRS competition link.";
  return { title: text(body.title, 60), bonus, tiles, teams, starts, ends, track };
}

// Before the start time, everyone but staff gets the board with its tiles blanked out (team names stay visible)
function forViewer(board, staff){
  const now = Date.now();
  if (staff || !board.starts || board.starts <= now) return { board: { ...board, hidden: false }, maxAge: 60 };
  return { board: { ...board, hidden: true, tiles: board.tiles.map(() => blankTile()), log: [], items: {},
    teams: board.teams.map(t => ({ ...t, p: Array(SIZE).fill(0) })) },
    // Don't let the CDN keep the hidden copy past the start time
    maxAge: Math.max(1, Math.min(60, Math.ceil((board.starts - now) / 1000))) };
}

// The board plus the item list for each boss on it
async function withItems(board, s){
  const edits = await readItemEdits(s), items = {};
  board.tiles.forEach(t => { if (t.boss) items[t.boss] = itemsFor(t.boss, edits); });
  return { ...board, items };
}

export default async req => {
  const staff = getStaff(req), s = store();
  if (req.method === "GET") {
    // ?staff=1 skips the CDN cache; only a staff login gets the tiles before the start time
    const fresh = new URL(req.url).searchParams.has("staff");
    const { board, maxAge } = forViewer(await withItems(await readBoard(s), s), fresh && staff);
    return fresh ? json(board) : json(board, 200, { ...CDN_CACHE, "netlify-cdn-cache-control": `public, durable, s-maxage=${maxAge}` });
  }

  if (!staff) return json({ error: "Log in with an approved Discord account first." }, 401);
  if (!sameOrigin(req)) return json({ error: "Bad origin." }, 403);
  if (req.method !== "PUT") return json({ error: "Method not allowed." }, 405, { allow: "GET, PUT" });

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad bingo data." }, 400); }
  const board = clean(body);
  if (typeof board === "string") return json({ error: board }, 400);

  const cur = await readBoard(s);
  if (body.rev !== cur.rev) return json({ error: "Someone else changed the bingo board. Showing the latest version.", board: await withItems(cur, s) }, 409);
  const next = await saveBoard({ ...board, rev: cur.rev, log: body.clearLog ? [] : cur.log }, staff.name, s);
  if (body.clearLog) await writeSubs([], s);
  // Delete custom images the board no longer uses
  const kept = new Set(next.tiles.map(t => t.img));
  await Promise.all(cur.tiles.map(t => t.img).filter(id => id && !kept.has(id)).map(id => s.delete(imageKey(id)).catch(() => {})));
  return json(await withItems(next, s));
};

export const config = { path: "/api/bingo" };
