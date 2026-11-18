// /api/bingo/shots
//   POST captain or staff: upload a drop screenshot (form field "file"; the page shrinks it first). Returns { url }, a
//        path like /api/bingo/shots/<id>.webp, which the page sends as the drop's proof link. The file extension lets
//        Discord show the screenshot in the drop announcement.
// /api/bingo/shots/<id>.<ext>
//   GET  anyone: the screenshot. Screenshots never change once uploaded, so they're cached for a long time.
// Screenshots are kept after a reset, so drop log proof links (and backups restored later) keep working.
import { randomBytes } from "node:crypto";
import { getCaptain, getStaff, json, sameOrigin } from "../lib/auth.mjs";
import { store, TYPES } from "../lib/bingo.mjs";

const MAX_SHOT = 2 * 1024 * 1024;
const SHOT = /^([a-f0-9]{18})\.(png|jpg|webp)$/;
const shotKey = id => "shot/" + id;

export default async (req, context) => {
  const file = context.params?.file;
  if (file) {
    const m = SHOT.exec(file);
    if (!m || req.method !== "GET") return new Response("Not found", { status: 404 });
    const hit = await store().getWithMetadata(shotKey(m[1]), { type: "arrayBuffer" });
    if (!hit) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
    return new Response(hit.data, { headers: {
      "content-type": hit.metadata.type || "image/png", "cache-control": "public, max-age=31536000, immutable" } });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "POST" });
  const me = getStaff(req) || await getCaptain(req);
  if (!me) return json({ error: "Only team captains and staff can upload screenshots." }, 401);
  if (!sameOrigin(req)) return json({ error: "Bad origin." }, 403);

  let form;
  try { form = await req.formData(); } catch { return json({ error: "Upload a screenshot." }, 400); }
  const f = form.get("file");
  if (!f || typeof f === "string" || !TYPES[f.type]) return json({ error: "The screenshot must be a PNG, JPG or WebP." }, 400);
  if (f.size > MAX_SHOT) return json({ error: "That screenshot is too big (2 MB max)." }, 413);

  const id = randomBytes(9).toString("hex");
  await store().set(shotKey(id), await f.arrayBuffer(), { metadata: { type: f.type, by: me.name, t: Date.now() } });
  return json({ url: `/api/bingo/shots/${id}.${TYPES[f.type]}` });
};

export const config = { path: ["/api/bingo/shots", "/api/bingo/shots/:file"] };
