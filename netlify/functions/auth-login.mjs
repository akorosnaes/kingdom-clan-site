// /auth/login: sends the visitor to Discord's "Authorize" screen
import { configured, env, randomToken, redirectUri, redirect, setCookie, STATE_COOKIE } from "../lib/auth.mjs";

export default async req => {
  if (!configured()) return redirect("/admin.html?error=setup");
  const state = randomToken();   // checked in /auth/callback so the login can't be started by another site
  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({ client_id: env("DISCORD_CLIENT_ID"), redirect_uri: redirectUri(req),
    response_type: "code", scope: "identify", state, prompt: "none" });
  return redirect(url.toString(), [setCookie(STATE_COOKIE, state, 600)]);
};

export const config = { path: "/auth/login" };
