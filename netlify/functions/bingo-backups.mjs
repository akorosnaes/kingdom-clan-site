// /api/bingo/backups (staff only)
//   GET               the list of backups, newest first
//   GET  ?id=<id>     download one backup as a .json file
//   POST { action: "create" }               back up now
//   POST { action: "restore", id }          restore one of the stored backups
//   POST { action: "restore", data }        restore from a downloaded backup file
//   Every restore first backs up the bingo as it is, so a restore can itself be undone.
import { getStaff, json, sameOrigin } from "../lib/auth.mjs";
import { checkBackup, listBackups, makeBackup, readBackup, restoreBackup } from "../lib/backup.mjs";
import { store } from "../lib/bingo.mjs";

export default async req => {
  const staff = getStaff(req);
  if (!staff) return json({ error: "Log in with an approved Discord account first." }, 401);
  const s = store();

  if (req.method === "GET") {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return json(await listBackups(s));
    const d = await readBackup(id, s);
    if (!d) return json({ error: "That backup isn't there any more." }, 404);
    const name = `kingdom-bingo-backup-${new Date(d.t).toISOString().slice(0, 16).replace(/[T:]/g, "-")}.json`;
    return new Response(JSON.stringify(d, null, 1), { headers: { "content-type": "application/json",
      "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "GET, POST" });
  if (!sameOrigin(req)) return json({ error: "Bad origin." }, 403);
  let b;
  try { b = await req.json(); } catch { return json({ error: "That file couldn't be read. Pick a backup .json file." }, 400); }

  if (b?.action === "create") {
    const meta = await makeBackup("manual", staff.name, s);
    return json({ backup: meta, list: await listBackups(s) });
  }

  if (b?.action === "restore") {
    const d = b.data ?? await readBackup(b.id, s);
    if (!d) return json({ error: "That backup isn't there any more." }, 404);
    const bad = checkBackup(d);
    if (bad) return json({ error: bad }, 400);
    await makeBackup("restore", staff.name, s);
    const board = await restoreBackup(d, staff.name, s);
    return json({ restored: d.t, rev: board.rev, list: await listBackups(s) });
  }

  return json({ error: "Unknown action." }, 400);
};

export const config = { path: "/api/bingo/backups" };
