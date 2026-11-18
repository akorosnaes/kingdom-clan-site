// Bingo captains and referees are whoever has the matching role in the clan's Discord server. Staff pick the server and
// the two roles in the staff console ("Bingo roles"); the choice is kept in the "bingo" Blobs store as "roles".
//
// Netlify environment variable:
//   DISCORD_BOT_TOKEN   the bot's token (Bot tab of its Discord application). The bot has to be in the server, with the
//                       Server Members Intent switched on (also on the Bot tab). It needs no permissions and never posts.
//   DISCORD_API_BASE    local testing only: points the lookups at a stand-in for Discord's API
//
// Someone's roles are looked up when they log in and then at most once a minute while they use the site, so giving or
// taking away a role in Discord takes effect within a minute. If Discord can't be reached, the last answer is reused.
import { store } from "./bingo.mjs";

const TTL = 60e3;
const api = () => (process.env.DISCORD_API_BASE || "https://discord.com/api/v10").replace(/\/$/, "");
export const botToken = () => (process.env.DISCORD_BOT_TOKEN || "").trim();
export const SNOWFLAKE = /^\d{17,20}$/;

// Answers kept for a minute in this function instance; a stale one is reused if Discord fails
const cache = new Map();
async function cached(key, fn, ttl = TTL){
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  try {
    const v = await fn();
    cache.set(key, { t: Date.now(), v });
    return v;
  } catch (e) {
    if (hit) { console.error("Discord lookup failed, using the last answer:", e.message); return hit.v; }
    throw e;
  }
}
export const clearRoleCache = () => cache.clear();

export class DiscordError extends Error {
  constructor(status, code, path){ super(`Discord ${path} ${status}${code ? " (" + code + ")" : ""}`); this.status = status; this.code = code; }
}
// GET from Discord as the bot; null for "not found" (e.g. someone who isn't in the server)
export async function discord(path){
  const r = await fetch(api() + path, { headers: { authorization: "Bot " + botToken() } });
  if (r.status === 404) return null;
  if (!r.ok) { const b = await r.json().catch(() => ({})); throw new DiscordError(r.status, b.code, path.split("?")[0]); }
  return r.json();
}

export async function readRoleSettings(s = store()){
  const v = await s.get("roles", { type: "json" });
  return { guild: v?.guild || "", captain: v?.captain || "", referee: v?.referee || "" };
}
const settings = () => cached("settings", () => readRoleSettings());

// { captain, referee } for a Discord user ID: both false until the bot and roles are set up
export async function rolesOf(id){
  const none = { captain: false, referee: false };
  if (!botToken() || !SNOWFLAKE.test(String(id))) return none;
  try {
    const set = await settings();
    if (!set.guild || (!set.captain && !set.referee)) return none;
    const roles = (await cached(`member:${set.guild}:${id}`, () => discord(`/guilds/${set.guild}/members/${id}`)))?.roles || [];
    return { captain: !!set.captain && roles.includes(set.captain), referee: !!set.referee && roles.includes(set.referee) };
  } catch (e) {
    console.error("Bingo role check failed:", e.message);
    return none;
  }
}

// The server's display name for a member: their server nickname, else their Discord display name, else username
export const memberName = m => m.nick || m.user?.global_name || m.user?.username || "";

// Everyone in the server (needs the Server Members Intent), 1000 at a time
export const members = guild => cached(`members:${guild}`, async () => {
  const out = [];
  for (let after = "0", i = 0; i < 20; i++) {
    const page = (await discord(`/guilds/${guild}/members?limit=1000&after=${after}`)) || [];
    out.push(...page);
    if (page.length < 1000) break;
    after = page[page.length - 1].user.id;
  }
  return out;
});

// Everyone with the captain role, by name
export async function captainMembers(){
  const set = await settings();
  if (!botToken() || !set.guild || !set.captain) return [];
  return (await members(set.guild)).filter(m => m.roles.includes(set.captain)).map(m => ({ id: m.user.id, name: memberName(m) }));
}
