// Bingo backups, kept in the "bingo" Blobs store:
//   "backups"       the list staff see: [{ id, t, kind, by, rev, title, teams, drops, subs, size }], newest first
//   "backup/<id>"   one backup: everything needed to put the bingo back as it was —
//                   { kind: "kingdom-bingo-backup", v: 1, t, by, board, items, subs, captains, images: { id: { type, data } } }
// A backup is taken every 6 hours (bingo-backup-cron.mjs), whenever staff press "Back up now", and just before a restore.
// Backups live next to the data they protect, so staff should also download one now and then and keep it somewhere else.
import { IMAGE_ID, imageKey, purge, readBoard, readItemEdits, readSubs, store, TYPES, writeSubs } from "./bingo.mjs";

export const KIND = "kingdom-bingo-backup";
const KEEP = 40;   // 10 days of 6-hourly backups, plus any taken by hand
const BACKUP_ID = /^[a-z0-9]{6,20}$/;
const backupKey = id => "backup/" + id;
export const validId = id => BACKUP_ID.test(String(id || ""));

export async function listBackups(s = store()){
  const list = await s.get("backups", { type: "json" });
  return Array.isArray(list) ? list : [];
}

export async function readBackup(id, s = store()){
  return validId(id) ? s.get(backupKey(id), { type: "json" }) : null;
}

// Everything in the bingo right now, as one JSON-able object
async function snapshot(s){
  const [board, items, subs, captains] = await Promise.all([readBoard(s), readItemEdits(s), readSubs(s),
    s.get("captains", { type: "json" }).then(c => c || {})]);
  const images = {};
  await Promise.all([...new Set(board.tiles.map(t => t.img).filter(Boolean))].map(async id => {
    const r = await s.getWithMetadata(imageKey(id), { type: "arrayBuffer" }).catch(() => null);
    if (r?.data) images[id] = { type: r.metadata?.type || "image/png", data: Buffer.from(r.data).toString("base64") };
  }));
  return { board, items, subs, captains, images };
}

// kind: "auto" (every 6 hours), "manual" (Back up now) or "restore" (taken just before a restore)
export async function makeBackup(kind, by, s = store()){
  const snap = await snapshot(s), t = Date.now();
  const id = t.toString(36) + Math.random().toString(36).slice(2, 6);
  const data = { kind: KIND, v: 1, t, by, ...snap };
  const body = JSON.stringify(data);
  await s.set(backupKey(id), body);
  const meta = { id, t, kind, by, rev: snap.board.rev, title: snap.board.title, teams: snap.board.teams.length,
    drops: snap.board.log.length, subs: snap.subs.length, size: body.length };
  const list = [meta, ...(await listBackups(s))];
  await s.setJSON("backups", list.slice(0, KEEP));
  await Promise.all(list.slice(KEEP).map(b => s.delete(backupKey(b.id)).catch(() => {})));
  return meta;
}

// Checks a backup (one of ours, or a file staff uploaded) has the right shape. Returns an error message or null.
export function checkBackup(d){
  if (!d || typeof d !== "object" || d.kind !== KIND) return "That isn't a Kingdom bingo backup file.";
  const b = d.board;
  if (!b || !Array.isArray(b.tiles) || b.tiles.length !== 25 || !b.tiles.every(t => t && typeof t === "object")
    || !Array.isArray(b.teams) || !b.teams.every(t => t && typeof t.name === "string" && Array.isArray(t.p) && t.p.length === 25)
    || !Array.isArray(b.log ?? [])) return "That backup's board is damaged.";
  if (d.subs != null && !Array.isArray(d.subs)) return "That backup's drop submissions are damaged.";
  if (d.items != null && (typeof d.items !== "object" || Array.isArray(d.items))) return "That backup's item lists are damaged.";
  return null;
}

// Puts a backup back. The board gets the next revision number, so open pages take it as the newest version.
export async function restoreBackup(d, by, s = store()){
  const cur = await readBoard(s);
  const board = { ...d.board, log: d.board.log || [], rev: (cur.rev || 0) + 1, updated: Date.now(), by };
  for (const [id, img] of Object.entries(d.images || {})) {
    if (!IMAGE_ID.test(id) || !TYPES[img?.type] || typeof img.data !== "string") continue;
    await s.set(imageKey(id), Buffer.from(img.data, "base64"), { metadata: { type: img.type, by } });
  }
  await s.setJSON("board", board);
  await s.setJSON("items", d.items || {});
  await writeSubs(d.subs || [], s);
  if (d.captains && typeof d.captains === "object") await s.setJSON("captains", d.captains);
  await purge();
  return board;
}
