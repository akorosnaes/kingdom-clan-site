// /api/draft
//   GET  anyone: the bingo draft board: title, teams (players and captain), the undrafted pool, and the live draft:
//        snake order on/off, pick timer (minutes, 0 = off), when the draft started, when the current pick's clock
//        started, and the pick history [{ player, team, t }] in order
//        Served from Netlify's CDN cache so viewers can check every couple of seconds for free;
//        every save clears that cache. ?staff=1 skips the cache.
//   PUT  staff:  save the whole board. Send back the "rev" you loaded; if someone else saved since, you get 409 and the latest board.
import { getStore } from "@netlify/blobs";
import { purgeCache } from "@netlify/functions";
import { getStaff, json, sameOrigin } from "../lib/auth.mjs";

const CACHE_TAG = "draft";
const CDN_CACHE = { "cache-control": "public, max-age=0, must-revalidate",
  "netlify-cdn-cache-control": "public, durable, s-maxage=60", "cache-tag": CACHE_TAG, "netlify-vary": "query" };

const store = () => getStore({ name: "draft", consistency: "strong" });
const EMPTY = { rev: 0, title: "", teams: [], pool: [], snake: true, timer: 0, started: 0, clock: 0, picks: [], updated: 0, by: "" };
const MAX_TEAMS = 16, MAX_PLAYERS = 500;

async function read(s = store()){
  const b = await s.get("board", { type: "json" });
  // Boards saved before the live draft features get their defaults
  return b && Array.isArray(b.teams) ? { ...EMPTY, ...b, teams: b.teams.map(t => ({ captain: "", ...t })) } : EMPTY;
}

const text = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
// RuneScape names: up to 12 letters, numbers, spaces, - and _
const RSN = /^[A-Za-z0-9 _-]{1,12}$/;

// Checks and tidies a board sent by the staff page. Returns an error message or the clean board.
function clean(body){
  if (!body || typeof body !== "object" || !Array.isArray(body.teams) || !Array.isArray(body.pool)) return "Bad draft data.";
  if (body.teams.length > MAX_TEAMS) return `Up to ${MAX_TEAMS} teams.`;
  const seen = new Set();
  const names = list => {
    if (!Array.isArray(list)) throw "Bad draft data.";
    return list.map(n => text(n, 12)).filter(n => {
      if (!RSN.test(n)) throw `"${n}" isn't a valid RuneScape name.`;
      const k = n.toLowerCase().replace(/[ _-]/g, "");
      if (seen.has(k)) throw `${n} is listed twice.`;
      seen.add(k); return true;
    });
  };
  try {
    const teams = body.teams.map((t, i) => {
      const players = names(t && t.players);
      // The captain has to be one of the team's players
      const captain = players.find(p => p.toLowerCase() === text(t && t.captain, 12).toLowerCase()) || "";
      return { name: text(t && t.name, 40) || `Team ${i + 1}`, players, captain };
    });
    const pool = names(body.pool);
    if (seen.size > MAX_PLAYERS) return `Up to ${MAX_PLAYERS} players.`;

    // Pick history only keeps players who are still on a team, filed under the team they're on now
    const teamOf = new Map(teams.flatMap(t => t.players.map(p => [p.toLowerCase(), t.name])));
    const now = Date.now(), time = v => Number.isInteger(v) && v > 0 && v <= now + 60000 ? v : 0;
    const picks = (Array.isArray(body.picks) ? body.picks : []).map(p => ({ player: text(p && p.player, 12), t: time(p && p.t) }))
      .filter((p, i, all) => teamOf.has(p.player.toLowerCase()) && all.findIndex(q => q.player.toLowerCase() === p.player.toLowerCase()) === i).map(p => ({ ...p, team: teamOf.get(p.player.toLowerCase()) })).slice(0, MAX_PLAYERS);
    const timer = Math.round(Math.max(0, Math.min(60, Number(body.timer) || 0)) * 2) / 2;   // minutes, in half-minute steps
    return { title: text(body.title, 60), teams, pool, snake: body.snake !== false, timer, started: time(body.started), clock: time(body.clock), picks };
  } catch (e) { return typeof e === "string" ? e : "Bad draft data."; }
}

export default async req => {
  const staff = getStaff(req);
  if (req.method === "GET")
    return new URL(req.url).searchParams.has("staff") ? json(await read()) : json(await read(), 200, CDN_CACHE);

  if (!staff) return json({ error: "Log in with an approved Discord account first." }, 401);
  if (!sameOrigin(req)) return json({ error: "Bad origin." }, 403);
  if (req.method !== "PUT") return json({ error: "Method not allowed." }, 405, { allow: "GET, PUT" });

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad draft data." }, 400); }
  const board = clean(body);
  if (typeof board === "string") return json({ error: board }, 400);

  const s = store(), cur = await read(s);
  if (body.rev !== cur.rev) return json({ error: "Someone else changed the draft. Showing the latest version.", board: cur }, 409);
  const next = { ...board, rev: cur.rev + 1, updated: Date.now(), by: staff.name };
  await s.setJSON("board", next);
  // If the purge fails, viewers still catch up when the cached copy expires (60s)
  try { await purgeCache({ tags: [CACHE_TAG] }); } catch (e) { console.error("Draft cache purge failed:", e.message); }
  return json(next);
};

export const config = { path: "/api/draft" };
