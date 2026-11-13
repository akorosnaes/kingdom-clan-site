// /api/turkey-trot
//   GET  anyone: the Turkey Trot standings { total, drops: [{ n, name }], players: [{ rsn, icon, color, progress, reachedAt }], updated },
//        best first (finishers by completion time, then most spaces, then who got there first).
//        The bot writes the "Progress" and "Drops" tabs of a Google Sheet; this reads them with a read-only service account.
//        Progress comes from the coloured tick cells (one spreadsheets.get with grid data): the ticks are the spaces covered and the fill is the player's colour.
//        Every good read is kept as a snapshot, which is served if Google is down; with nothing configured and no snapshot it's an empty list (200).
//        Served from Netlify's CDN cache for 30 s so visitors can poll for free.
//        ?sample=1 returns made-up moving players, but only while TROT_ALLOW_SAMPLE=1 (for building the page).
//
// Netlify environment variables (Site configuration > Environment variables):
//   GOOGLE_SA_EMAIL    service account email; share the sheet with it as Viewer
//   GOOGLE_SA_KEY      the service account's private key (PEM; literal "\n" is fine)
//   TROT_SHEET_ID      the spreadsheet id (the long part of its URL)
//   TROT_SHEET_TAB     optional: the progress tab's name, default "Progress"
//   TROT_ALLOW_SAMPLE  optional: set to 1 to allow ?sample=1
import { getStore } from "@netlify/blobs";
import { env } from "../lib/auth.mjs";
import { configured, readGrid, readRange } from "../lib/google.mjs";
import { makeHandler } from "../lib/turkey-trot-api.mjs";

const store = () => getStore({ name: "turkeytrot", consistency: "strong" });
const quote = tab => `'${tab.replace(/'/g, "''")}'`;

export default makeHandler({
  env,
  configured,
  readSheet: async (id, tab) => {
    // Drop names are optional: a missing "Drops" tab leaves the spots unnamed instead of failing the read
    const [progress, drops] = await Promise.all([readGrid(id, `${quote(tab)}!A2:AD`), readRange(id, "'Drops'!A2:B27").catch(() => [])]);
    return { progress, drops };
  },
  snapshot: {
    get: async () => store().get("snapshot", { type: "json" }),
    set: async result => store().setJSON("snapshot", result),
  },
});

export const config = { path: "/api/turkey-trot" };
