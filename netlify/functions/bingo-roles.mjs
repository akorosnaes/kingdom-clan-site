// /api/bingo/roles   (staff console, "Bingo roles")
//   GET   staff: the saved server and roles, the servers the bot is in, the roles of the saved server (or of ?guild=ID,
//         while staff are choosing a different one) with how many members have each, and anything that needs fixing
//   POST  staff: { guild, captain, referee } to save. Either role can be "" (nobody gets it from Discord).
import { getStaff, json, sameOrigin } from "../lib/auth.mjs";
import { store } from "../lib/bingo.mjs";
import { logActivity } from "../lib/activity.mjs";
import { botToken, clearRoleCache, discordCached, members, readRoleSettings, SNOWFLAKE } from "../lib/roles.mjs";

const MEMBERS_INTENT = "The bot can't list the server's members. On the Discord Developer Portal, open the bot's application, "
  + "go to Bot and switch on Server Members Intent, then reload this page.";
const BAD_TOKEN = "Discord didn't accept DISCORD_BOT_TOKEN. Copy the token again from the bot's page (Bot > Reset Token), update it in Netlify and redeploy.";
// What went wrong, in words staff can act on (the status code helps if it needs looking into)
const why = e => e.status === 401 ? BAD_TOKEN : e.status === 429 ? "Discord is asking the site to slow down. Wait a minute and try again."
  : `Couldn't get an answer from Discord${e.status ? ` (error ${e.status})` : ""}. Try again in a moment.`;

// The bot, the servers it's in, and the roles of one of them (not @everyone, whose ID is the server's, or roles
// other bots and integrations manage)
async function lookup(guild){
  const me = await discordCached("/users/@me");
  const guilds = ((await discordCached("/users/@me/guilds")) || []).map(g => ({ id: g.id, name: g.name }));
  const roles = guild && guilds.some(g => g.id === guild) ? ((await discordCached(`/guilds/${guild}/roles`)) || [])
    .filter(r => r.id !== guild && !r.managed).sort((a, b) => b.position - a.position)
    .map(r => ({ id: r.id, name: r.name, color: r.color ? "#" + r.color.toString(16).padStart(6, "0") : "" })) : [];
  return { me, guilds, roles };
}

// Everything the panel shows, for the saved server or the one being picked
async function state(pick){
  const saved = await readRoleSettings();
  const out = { bot: !!botToken(), saved, guild: pick || saved.guild, guilds: [], roles: [], problem: "", invite: "" };
  if (!out.bot) return out;
  let found;
  try { found = await lookup(out.guild); }
  catch (e) { console.error("Bingo roles:", e.message); out.problem = why(e); return out; }
  out.botName = found.me.global_name || found.me.username;
  out.invite = `https://discord.com/oauth2/authorize?client_id=${found.me.id}&scope=bot&permissions=0`;
  out.guilds = found.guilds; out.roles = found.roles;
  if (!out.guild) return out;
  if (!out.guilds.some(g => g.id === out.guild)) {
    out.problem = out.guild === saved.guild ? "The bot isn't in the saved server any more. Invite it back, or pick another server." : "The bot isn't in that server.";
    return out;
  }
  // Member counts are a nice extra: if Discord won't give them, the panel still works without them
  try {
    const list = await members(out.guild), count = {};
    list.forEach(m => m.roles.forEach(id => count[id] = (count[id] || 0) + 1));
    out.roles.forEach(r => r.count = count[r.id] || 0);
  } catch (e) {
    console.error("Bingo roles, member counts:", e.message);
    if (e.status === 403 || e.code === 50001) out.problem = MEMBERS_INTENT;
  }
  return out;
}

export default async req => {
  const staff = getStaff(req);
  if (!staff) return json({ error: "Log in with an approved Discord account first." }, 401);

  if (req.method === "GET") {
    const pick = new URL(req.url).searchParams.get("guild") || "";
    return json(await state(SNOWFLAKE.test(pick) ? pick : ""));
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "GET, POST" });
  if (!sameOrigin(req)) return json({ error: "Bad origin." }, 403);
  if (!botToken()) return json({ error: "Add DISCORD_BOT_TOKEN in Netlify first." }, 400);

  const b = await req.json().catch(() => null);
  const guild = String(b?.guild || ""), captain = String(b?.captain || ""), referee = String(b?.referee || "");
  let cur;
  try { cur = await lookup(guild); }
  catch (e) { console.error("Bingo roles save:", e.message); return json({ error: why(e) }, 502); }
  const g = cur.guilds.find(x => x.id === guild);
  if (!g) return json({ error: "Pick a server the bot is in." }, 400);
  const role = id => cur.roles.find(r => r.id === id);
  if ((captain && !role(captain)) || (referee && !role(referee))) return json({ error: "That role isn't in the server any more. Reload and pick again." }, 400);

  const s = store();
  await s.setJSON("roles", { guild, captain, referee, updated: Date.now(), by: staff.name });
  clearRoleCache();
  const say = id => id ? "@" + role(id).name : "none";
  await logActivity(staff.name, "roles", `Set the bingo roles in ${g.name}: captains ${say(captain)}, referees ${say(referee)}`, s);
  return json(await state());
};

export const config = { path: "/api/bingo/roles" };
