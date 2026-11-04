// /api/bingo/activity
//   GET    staff: the staff activity log, newest first (see lib/activity.mjs for what's recorded)
//   DELETE staff: empty the log (e.g. after testing); the one entry left says who cleared it
import { getStaff, json, sameOrigin } from "../lib/auth.mjs";
import { clearActivity, readActivity } from "../lib/activity.mjs";

export default async req => {
  const staff = getStaff(req);
  if (!staff) return json({ error: "Log in with an approved Discord account first." }, 401);
  if (req.method === "DELETE") {
    if (!sameOrigin(req)) return json({ error: "Bad origin." }, 403);
    await clearActivity(staff.name);
    return json(await readActivity());
  }
  if (req.method !== "GET") return json({ error: "Method not allowed." }, 405, { allow: "GET, DELETE" });
  return json(await readActivity());
};

export const config = { path: "/api/bingo/activity" };
