// /api/bingo/items
//   PUT staff: replace one boss's item list (the choices captains get when logging a drop).
//       Body { boss, items: [names] }. An empty list goes back to the built-in defaults.
import { getStaff, json, sameOrigin } from "../lib/auth.mjs";
import { itemsFor, MAX_ITEMS, purge, readItemEdits, store, text } from "../lib/bingo.mjs";

const BOSS = /^[a-z_]{1,40}$/;

export default async req => {
  if (req.method !== "PUT") return json({ error: "Method not allowed." }, 405, { allow: "PUT" });
  const staff = getStaff(req);
  if (!staff) return json({ error: "Log in with an approved Discord account first." }, 401);
  if (!sameOrigin(req)) return json({ error: "Bad origin." }, 403);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad item list." }, 400); }
  if (!BOSS.test(body?.boss) || !Array.isArray(body.items)) return json({ error: "Bad item list." }, 400);
  const items = [...new Set(body.items.map(i => text(i, 60)).filter(Boolean))].slice(0, MAX_ITEMS);

  const s = store(), edits = await readItemEdits(s);
  if (items.length) edits[body.boss] = items; else delete edits[body.boss];
  await s.setJSON("items", edits);
  await purge();
  return json({ boss: body.boss, items: itemsFor(body.boss, edits) });
};

export const config = { path: "/api/bingo/items" };
