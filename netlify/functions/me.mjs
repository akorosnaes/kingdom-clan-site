// /api/me: who is logged in to the staff console (401 if nobody)
import { configured, getStaff, json } from "../lib/auth.mjs";

export default async req => {
  if (!configured()) return json({ error: "setup" }, 503);
  const s = getStaff(req);
  return s ? json({ id: s.id, name: s.name, avatar: s.avatar }) : json({ error: "login" }, 401);
};

export const config = { path: "/api/me" };
