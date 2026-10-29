// /api/bingo/subs
//   GET   staff:   every pending drop, plus the latest reviewed ones
//         captain: their own team's drops and how each was reviewed
//   POST  captain: log a drop for their team { tile, item, player, proof } — it waits for staff approval.
//         Only between the bingo's start and end times (when they're set).
// /api/bingo/review
//   POST  staff: { id, action: "approve" | "reject" } for a pending drop, or { id, action: "undo" } for an approved one.
//         Approving adds one completion to the team's tile, puts the drop in the public drop log and announces it on
//         Discord (if DISCORD_BINGO_WEBHOOK is set); undo takes the progress and log entry back.
import { getCaptain, getStaff, json, sameOrigin } from "../lib/auth.mjs";
import { bump, LOG_MAX, newId, readBoard, readSubs, saveBoard, store, text, writeSubs } from "../lib/bingo.mjs";
import { announceDrop, lines } from "../lib/discord.mjs";

const RSN = /^[A-Za-z0-9 _-]{1,12}$/;
const URL_RE = /^https?:\/\/[^\s<>"]{3,400}$/i;
const MAX_PENDING = 50;
const tileName = (t, i) => t.name || (t.boss ? t.boss.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : `Tile ${i + 1}`);

async function body(req){ try { return await req.json(); } catch { return null; } }

async function subs(req){
  const s = store();
  if (req.method === "GET") {
    const staff = getStaff(req), cap = getCaptain(req);
    if (!staff && !cap) return json({ error: "Log in first." }, 401);
    const list = await readSubs(s), out = {};
    if (staff) {
      out.pending = list.filter(x => x.status === "pending");
      out.recent = list.filter(x => x.status !== "pending").slice(-50).reverse();
    }
    if (cap) out.mine = list.filter(x => x.by.id === cap.id).slice(-100).reverse();
    return json(out);
  }

  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "GET, POST" });
  const cap = getCaptain(req);
  if (!cap) return json({ error: "Only team captains can log drops." }, 401);
  if (!sameOrigin(req)) return json({ error: "Bad origin." }, 403);

  const b = await body(req), board = await readBoard(s), now = Date.now();
  if (!board.revealed) return json({ error: "The board hasn't been revealed yet." }, 403);
  if (board.starts && now < board.starts) return json({ error: "The bingo hasn't started yet. Drops can be logged once it starts." }, 403);
  if (board.ends && now > board.ends) return json({ error: "The bingo has ended, so no more drops can be logged." }, 403);
  const ti = board.teams.findIndex(t => t.captain === cap.id);
  if (ti < 0) return json({ error: "You're not set as captain of a team yet. Ask an admin to pick you in Bingo setup." }, 403);
  const team = board.teams[ti], tile = Number(b?.tile), t = board.tiles[tile];
  if (!Number.isInteger(tile) || !t || (!t.boss && !t.name)) return json({ error: "Pick a tile." }, 400);
  if (team.p[tile] >= t.need) return json({ error: "Your team has already completed that tile." }, 400);
  const item = text(b.item, 60), player = text(b.player, 12), proof = String(b.proof || "").trim();
  if (!item) return json({ error: "Pick the item that dropped." }, 400);
  if (!RSN.test(player)) return json({ error: "Pick who got the drop." }, 400);
  if (!URL_RE.test(proof)) return json({ error: "Add a link to a screenshot of the drop (starting with https://)." }, 400);

  const list = await readSubs(s);
  if (list.filter(x => x.status === "pending" && x.team === team.name).length >= MAX_PENDING)
    return json({ error: "Your team has too many drops waiting for approval. Ask an admin to review them." }, 429);
  // The page sends the tile's display name (e.g. "Kree'arra") so the drop log keeps it even if the tile changes later
  const sub = { id: newId(), t: Date.now(), team: team.name, tile, tileName: text(b.tileName, 40) || tileName(t, tile), item, player, proof,
    by: { id: cap.id, name: cap.name }, status: "pending" };
  list.push(sub);
  await writeSubs(list, s);
  return json(sub);
}

async function review(req){
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "POST" });
  const staff = getStaff(req);
  if (!staff) return json({ error: "Log in with an approved Discord account first." }, 401);
  if (!sameOrigin(req)) return json({ error: "Bad origin." }, 403);
  const b = await body(req), s = store();
  const list = await readSubs(s), sub = list.find(x => x.id === b?.id);
  if (!sub) return json({ error: "That drop isn't there any more. Refresh the page." }, 404);

  const board = await readBoard(s);
  const team = board.teams.find(t => t.name === sub.team) || board.teams.find(t => t.captain === sub.by.id);
  const reviewed = { at: Date.now(), reviewer: staff.name };

  if (b.action === "reject") {
    if (sub.status !== "pending") return json({ error: "That drop has already been reviewed." }, 409);
    Object.assign(sub, { status: "rejected" }, reviewed);
    await writeSubs(list, s);
    return json({ sub });
  }

  if (b.action === "approve") {
    if (sub.status !== "pending") return json({ error: "That drop has already been reviewed." }, 409);
    if (!team) return json({ error: `Team "${sub.team}" isn't on the board any more.` }, 409);
    const t = board.tiles[sub.tile], before = new Set(lines(board, team));
    if (t) bump(team, sub.tile, t.need, 1);
    const newLines = lines(board, team).filter(l => !before.has(l));
    board.log = [{ id: sub.id, t: sub.t, team: team.name, tile: sub.tile, tileName: sub.tileName, item: sub.item,
      player: sub.player, proof: sub.proof, by: sub.by.name, ok: reviewed.at }, ...board.log].slice(0, LOG_MAX);
    Object.assign(sub, { status: "approved" }, reviewed);
    const next = await saveBoard(board, staff.name, s);
    await writeSubs(list, s);
    await announceDrop({ board: next, team, sub, newLines });
    return json({ sub, rev: next.rev });
  }

  if (b.action === "undo") {
    if (sub.status !== "approved") return json({ error: "Only approved drops can be undone." }, 409);
    board.log = board.log.filter(x => x.id !== sub.id);
    const t = board.tiles[sub.tile];
    if (team && t) bump(team, sub.tile, t.need, -1);
    Object.assign(sub, { status: "undone" }, reviewed);
    const next = await saveBoard(board, staff.name, s);
    await writeSubs(list, s);
    return json({ sub, rev: next.rev });
  }

  return json({ error: "Unknown action." }, 400);
}

export default async req => new URL(req.url).pathname.endsWith("/review") ? review(req) : subs(req);

export const config = { path: ["/api/bingo/subs", "/api/bingo/review"] };
