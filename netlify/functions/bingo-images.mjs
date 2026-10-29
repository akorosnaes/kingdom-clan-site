// /api/bingo/images
//   POST staff: upload a custom tile image (form field "file"). Returns { id }; the staff page then saves that id on the tile.
//   Images are never changed after upload, so each id's URL can be cached forever. Saving a board that no longer
//   uses an image deletes it (see bingo.mjs).
import { randomBytes } from "node:crypto";
import { getStaff, json, sameOrigin } from "../lib/auth.mjs";
import { imageKey, MAX_BYTES, store, TYPES } from "../lib/bingo.mjs";

export default async req => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "POST" });
  const staff = getStaff(req);
  if (!staff) return json({ error: "Log in with an approved Discord account first." }, 401);
  if (!sameOrigin(req)) return json({ error: "Bad origin." }, 403);

  let form;
  try { form = await req.formData(); } catch { return json({ error: "Upload an image." }, 400); }
  const file = form.get("file");
  if (!file || typeof file === "string" || !TYPES[file.type]) return json({ error: "The image must be a PNG, JPG or WebP." }, 400);
  if (file.size > MAX_BYTES) return json({ error: "That image is too big (512 KB max)." }, 413);

  const id = randomBytes(9).toString("hex");
  await store().set(imageKey(id), await file.arrayBuffer(), { metadata: { type: file.type, by: staff.name } });
  return json({ id });
};

export const config = { path: "/api/bingo/images" };
