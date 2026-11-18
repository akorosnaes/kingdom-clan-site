// /auth/callback: Discord sends the visitor back here. Look up who they are and let them in only if they're staff,
// or have the bingo captain or referee role in the clan's Discord server.
import { configured, cookies, env, isStaff, makeSession, redirectUri, redirect, setCookie, staffHint, STATE_COOKIE } from "../lib/auth.mjs";
import { rolesOf } from "../lib/roles.mjs";

export default async req => {
  if (!configured()) return redirect("/admin.html?error=setup");
  const q = new URL(req.url).searchParams;
  const clearState = setCookie(STATE_COOKIE, "", 0);
  if (q.get("error")) return redirect("/admin.html?error=cancelled", [clearState]);
  if (!q.get("code") || !q.get("state") || q.get("state") !== cookies(req)[STATE_COOKIE])
    return redirect("/admin.html?error=expired", [clearState]);

  try {
    const tok = await fetch("https://discord.com/api/oauth2/token", { method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env("DISCORD_CLIENT_ID"), client_secret: env("DISCORD_CLIENT_SECRET"),
        grant_type: "authorization_code", code: q.get("code"), redirect_uri: redirectUri(req) }) });
    if (!tok.ok) throw new Error("token " + tok.status);
    const { access_token } = await tok.json();
    const me = await fetch("https://discord.com/api/users/@me", { headers: { authorization: "Bearer " + access_token } });
    if (!me.ok) throw new Error("user " + me.status);
    const u = await me.json();
    const staff = isStaff(u.id);
    const role = staff ? null : await rolesOf(u.id);
    if (!staff && !role.captain && !role.referee) return redirect("/admin.html?error=denied", [clearState]);
    // Staff land in the console; captains and referees land on the Bingo page, where they log and review drops
    return redirect(staff ? "/admin.html" : "/bingo.html", [clearState, makeSession({ id: u.id, name: u.global_name || u.username, avatar: u.avatar }), staffHint(staff)]);
  } catch (e) {
    console.error("Discord login failed:", e.message);
    return redirect("/admin.html?error=discord", [clearState]);
  }
};

export const config = { path: "/auth/callback" };
