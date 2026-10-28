// /auth/logout: clears the staff session
import { redirect, setCookie, SESSION_COOKIE } from "../lib/auth.mjs";

export default async () => redirect("/admin.html?loggedout=1", [setCookie(SESSION_COOKIE, "", 0)]);

export const config = { path: "/auth/logout" };
