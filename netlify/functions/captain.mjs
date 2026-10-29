// /api/captain          captain: who's logged in and which bingo team they captain (401 if not a captain)
// /api/bingo/captains   staff:   every captain in CAPTAIN_DISCORD_IDS, named if they've logged in before, and the team each captains
import { captainIds, configured, getCaptain, getStaff, json } from "../lib/auth.mjs";
import { readBoard, store } from "../lib/bingo.mjs";

export default async req => {
  if (!configured()) return json({ error: "setup" }, 503);
  const s = store(), board = await readBoard(s);
  const teamOf = id => { const i = board.teams.findIndex(t => t.captain === id); return i < 0 ? null : { index: i, name: board.teams[i].name }; };

  if (new URL(req.url).pathname.endsWith("/captains")) {
    if (!getStaff(req)) return json({ error: "Log in with an approved Discord account first." }, 401);
    const names = (await s.get("captains", { type: "json" })) || {};
    return json(captainIds().map(id => ({ id, name: names[id]?.name || "", team: teamOf(id)?.name || "" })));
  }

  const c = getCaptain(req);
  if (!c) return json({ error: "login" }, 401);
  // Remember the captain's Discord name so staff can pick them by name in Bingo setup
  const names = (await s.get("captains", { type: "json" })) || {};
  if (names[c.id]?.name !== c.name) { names[c.id] = { name: c.name, seen: Date.now() }; await s.setJSON("captains", names); }
  return json({ id: c.id, name: c.name, avatar: c.avatar, team: teamOf(c.id) });
};

export const config = { path: ["/api/captain", "/api/bingo/captains"] };
