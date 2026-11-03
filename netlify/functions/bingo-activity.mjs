// /api/bingo/activity  GET staff: the staff activity log, newest first (see lib/activity.mjs for what's recorded)
import { getStaff, json } from "../lib/auth.mjs";
import { readActivity } from "../lib/activity.mjs";

export default async req => {
  if (!getStaff(req)) return json({ error: "Log in with an approved Discord account first." }, 401);
  return json(await readActivity());
};

export const config = { path: "/api/bingo/activity" };
