// Shared helpers for the staff console: Discord login settings, signed session cookies, and the staff check.
//
// Netlify environment variables (Site configuration > Environment variables):
//   DISCORD_CLIENT_ID      Discord application's Client ID
//   DISCORD_CLIENT_SECRET  Discord application's Client Secret
//   SESSION_SECRET         long random string used to sign login cookies
//   ADMIN_DISCORD_IDS      comma-separated Discord user IDs allowed into the console
//   CAPTAIN_DISCORD_IDS    optional: comma-separated Discord user IDs of bingo team captains. Captains can only
//                          submit drops for their own team on the Bingo page; they get none of the staff tools.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "kd_session";
export const STATE_COOKIE = "kd_oauth_state";
const SESSION_DAYS = 7;

export const env = name => (process.env[name] || "").trim();
export const configured = () =>
  ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "SESSION_SECRET", "ADMIN_DISCORD_IDS"].every(n => env(n)) && env("SESSION_SECRET").length >= 32;
export const staffIds = () => env("ADMIN_DISCORD_IDS").split(/[\s,]+/).filter(Boolean);
export const isStaff = id => staffIds().includes(String(id));
export const captainIds = () => env("CAPTAIN_DISCORD_IDS").split(/[\s,]+/).filter(Boolean);
export const isCaptain = id => captainIds().includes(String(id));
export const redirectUri = req => new URL("/auth/callback", req.url).toString();
export const randomToken = () => randomBytes(24).toString("base64url");

const sign = data => createHmac("sha256", env("SESSION_SECRET")).update(data).digest("base64url");
const safeEqual = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export function cookies(req){
  const out = {};
  (req.headers.get("cookie") || "").split(/;\s*/).forEach(p => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1)); });
  return out;
}
export const setCookie = (name, value, maxAge) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
// A readable "kd_staff=1" cookie so every page's nav can show the staff-only links. It's only a hint for the nav:
// the pages and APIs behind those links still check the signed session.
export const STAFF_HINT = "kd_staff";
export const staffHint = on => `${STAFF_HINT}=${on ? 1 : ""}; Path=/; Secure; SameSite=Lax; Max-Age=${on ? SESSION_DAYS * 86400 : 0}`;

// Session = base64url(JSON) + "." + HMAC signature, so it can't be edited without SESSION_SECRET
export function makeSession(user){
  const data = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + SESSION_DAYS * 864e5 })).toString("base64url");
  return setCookie(SESSION_COOKIE, data + "." + sign(data), SESSION_DAYS * 86400);
}

// The signed-in Discord user from the session cookie, or null (signature and expiry checked, roles not)
function session(req){
  if (!configured()) return null;
  const raw = cookies(req)[SESSION_COOKIE];
  if (!raw || !raw.includes(".")) return null;
  const [data, sig] = raw.split(".");
  if (!safeEqual(sig, sign(data))) return null;
  try {
    const s = JSON.parse(Buffer.from(data, "base64url").toString());
    return s.exp > Date.now() ? s : null;
  } catch { return null; }
}

// Returns the logged-in staff member, or null. Roles are re-checked on every request,
// so removing someone from ADMIN_DISCORD_IDS (or CAPTAIN_DISCORD_IDS) locks them out straight away.
export function getStaff(req){
  const s = session(req);
  return s && isStaff(s.id) ? s : null;
}
export function getCaptain(req){
  const s = session(req);
  return s && isCaptain(s.id) ? s : null;
}

// Writes must come from our own pages (blocks other sites posting with a staff member's cookie)
export const sameOrigin = req => { const o = req.headers.get("origin"); return !o || o === new URL(req.url).origin; };

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
export const redirect = (to, cookieHeaders = []) => {
  const h = new Headers({ location: to, "cache-control": "no-store" });
  cookieHeaders.forEach(c => h.append("set-cookie", c));
  return new Response(null, { status: 302, headers: h });
};
