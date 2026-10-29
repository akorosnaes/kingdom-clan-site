// /auth/logout: clears the login session. ?to=bingo sends captains back to the Bingo page instead of the console.
import { redirect, setCookie, SESSION_COOKIE, staffHint } from "../lib/auth.mjs";

export default async req =>
  redirect(new URL(req.url).searchParams.get("to") === "bingo" ? "/bingo.html" : "/admin.html?loggedout=1", [setCookie(SESSION_COOKIE, "", 0), staffHint(false)]);

export const config = { path: "/auth/logout" };
