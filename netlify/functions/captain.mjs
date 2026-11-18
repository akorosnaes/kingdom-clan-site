// /api/captain          captain or referee: who's logged in, which bingo team they captain (if any), and whether they're
//                       a captain and/or a referee (401 if neither)
// /api/bingo/captains   staff:   everyone with the captain role in Discord, by name, and the team each captains. Captains still
//                       on a team who've lost the role are listed too, marked "gone", so staff can see and remove them.
import { configured, getCaptain, getReferee, getStaff, json } from "../lib/auth.mjs";
import { readBoard, store, teamOfCaptain } from "../lib/bingo.mjs";
import { captainMembers } from "../lib/roles.mjs";

export default async req => {
  if (!configured()) return json({ error: "setup" }, 503);
  const s = store(), board = await readBoard(s);
  const teamOf = id => { const i = board.teams.indexOf(teamOfCaptain(board, id)); return i < 0 ? null : { index: i, name: board.teams[i].name }; };

  if (new URL(req.url).pathname.endsWith("/captains")) {
    if (!getStaff(req)) return json({ error: "Log in with an approved Discord account first." }, 401);
    let list;
    try { list = await captainMembers(); }
    catch (e) { console.error("Captain list failed:", e.message); return json({ error: "Couldn't get the captain role's members from Discord." }, 502); }
    const names = (await s.get("captains", { type: "json" })) || {};
    const out = list.map(c => ({ ...c, team: teamOf(c.id)?.name || "" })).sort((a, b) => a.name.localeCompare(b.name));
    board.teams.forEach(t => (t.captains || []).forEach(id => {
      if (!out.some(c => c.id === id)) out.push({ id, name: names[id]?.name || "", team: t.name, gone: true });
    }));
    return json(out);
  }

  const c = await getCaptain(req), r = await getReferee(req), me = c || r;
  if (!me) return json({ error: "login" }, 401);
  // Remember the captain's Discord name, so a captain who later loses the role still shows by name in Bingo setup
  if (c) {
    const names = (await s.get("captains", { type: "json" })) || {};
    if (names[c.id]?.name !== c.name) { names[c.id] = { name: c.name, seen: Date.now() }; await s.setJSON("captains", names); }
  }
  return json({ id: me.id, name: me.name, avatar: me.avatar, captain: !!c, referee: !!r, team: c ? teamOf(c.id) : null });
};

export const config = { path: ["/api/captain", "/api/bingo/captains"] };
