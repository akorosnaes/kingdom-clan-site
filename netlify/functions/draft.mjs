// /api/draft
//   GET  anyone: the bingo draft board (title, teams with their players, and the undrafted pool)
//   PUT  staff:  save the whole board. Send back the "rev" you loaded; if someone else saved since, you get 409 and the latest board.
import { getStore } from "@netlify/blobs";
import { getStaff, json, sameOrigin } from "../lib/auth.mjs";

const store = () => getStore({ name: "draft", consistency: "strong" });
const EMPTY = { rev: 0, title: "", teams: [], pool: [], updated: 0, by: "" };
const MAX_TEAMS = 16, MAX_PLAYERS = 500;

async function read(s = store()){
  const b = await s.get("board", { type: "json" });
  return b && Array.isArray(b.teams) ? b : EMPTY;
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
    const teams = body.teams.map((t, i) => ({ name: text(t && t.name, 40) || `Team ${i + 1}`, players: names(t && t.players) }));
    const pool = names(body.pool);
    if (seen.size > MAX_PLAYERS) return `Up to ${MAX_PLAYERS} players.`;
    return { title: text(body.title, 60), teams, pool };
  } catch (e) { return typeof e === "string" ? e : "Bad draft data."; }
}

export default async req => {
  const staff = getStaff(req);
  if (req.method === "GET") return json(await read());

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
  return json(next);
};

export const config = { path: "/api/draft" };
