// Staff activity log, kept in the "bingo" Blobs store as "activity": [{ t, by, kind, text }], newest first.
// Records the things staff do that change the bingo for everyone: reviewing drops, logging drops for a team,
// revealing or hiding the board, resetting or clearing it, changing its dates, editing item lists, and backups.
// Ordinary board edits (tile names, points, colours) aren't logged; they happen dozens of times while setting up.
import { store } from "./bingo.mjs";

const MAX = 500;

export async function readActivity(s = store()){
  const list = await s.get("activity", { type: "json" });
  return Array.isArray(list) ? list : [];
}

// Never throws: a failed log write mustn't undo the action it describes
export async function logActivity(by, kind, text, s = store()){
  try {
    const list = await readActivity(s);
    list.unshift({ t: Date.now(), by: String(by || "Unknown").slice(0, 60), kind, text: String(text).slice(0, 300) });
    await s.setJSON("activity", list.slice(0, MAX));
  } catch (e) { console.error("Activity log write failed:", e.message); }
}
