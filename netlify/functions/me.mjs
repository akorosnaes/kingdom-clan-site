// /api/me: who is logged in to the staff console (401 if nobody).
// Also keeps the nav's staff hint cookie in step, so the staff-only nav links appear or go away.
import { configured, getStaff, json, staffHint } from "../lib/auth.mjs";

export default async req => {
  if (!configured()) return json({ error: "setup" }, 503);
  const s = getStaff(req);
  return s ? json({ id: s.id, name: s.name, avatar: s.avatar }, 200, { "set-cookie": staffHint(true) })
    : json({ error: "login" }, 401, { "set-cookie": staffHint(false) });
};

export const config = { path: "/api/me" };
