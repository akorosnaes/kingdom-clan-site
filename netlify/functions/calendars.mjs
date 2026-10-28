// /api/calendars
//   GET     anyone: the list of monthly calendars (newest first)
//   POST    staff:  upload or replace a month's calendar (form fields "month" = YYYY-MM, "file" = image)
//   DELETE  staff:  remove a month's calendar (?month=YYYY-MM)
import { getStaff, json, sameOrigin } from "../lib/auth.mjs";
import { imageKey, MAX_BYTES, MONTH, readIndex, store, TYPES, writeIndex } from "../lib/calendars.mjs";

const publicList = (list, staff) => list.map(c => ({ month: c.month, updated: c.updated,
  url: `/api/calendars/${c.month}?v=${c.updated}`, ...(staff ? { by: c.by, size: c.size } : {}) }));

export default async req => {
  const staff = getStaff(req);

  // The console asks with ?staff=1 so its uncached, detailed list never shares a cache entry with the public one
  if (req.method === "GET")
    return staff && new URL(req.url).searchParams.has("staff")
      ? json(publicList(await readIndex(), true))
      : json(publicList(await readIndex(), false), 200, { "cache-control": "public, max-age=60" });

  if (!staff) return json({ error: "Log in with an approved Discord account first." }, 401);
  if (!sameOrigin(req)) return json({ error: "Bad origin." }, 403);
  const s = store();

  if (req.method === "POST") {
    let form;
    try { form = await req.formData(); } catch { return json({ error: "Upload a month and an image." }, 400); }
    const month = String(form.get("month") || ""), file = form.get("file");
    if (!MONTH.test(month)) return json({ error: "Pick a month." }, 400);
    if (!file || typeof file === "string" || !TYPES[file.type]) return json({ error: "The calendar must be a PNG, JPG or WebP image." }, 400);
    if (file.size > MAX_BYTES) return json({ error: "That image is over 5 MB. Export it smaller (WebP or JPG) and try again." }, 413);

    const updated = Date.now();
    await s.set(imageKey(month), await file.arrayBuffer(), { metadata: { type: file.type, updated } });
    const list = (await readIndex(s)).filter(c => c.month !== month);
    list.push({ month, type: file.type, size: file.size, updated, by: staff.name });
    await writeIndex(list, s);
    return json(publicList(await readIndex(s), true));
  }

  if (req.method === "DELETE") {
    const month = new URL(req.url).searchParams.get("month") || "";
    if (!MONTH.test(month)) return json({ error: "Pick a month." }, 400);
    await s.delete(imageKey(month));
    await writeIndex((await readIndex(s)).filter(c => c.month !== month), s);
    return json(publicList(await readIndex(s), true));
  }

  return json({ error: "Method not allowed." }, 405, { allow: "GET, POST, DELETE" });
};

export const config = { path: "/api/calendars" };
