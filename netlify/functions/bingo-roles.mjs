// /api/bingo/roles   (staff console, "Bingo roles")
//   GET   staff: the saved server and roles, the servers the bot is in, the roles of the saved server (or of ?guild=ID,
//         while staff are choosing a different one) with how many members have each, and anything that needs fixing
//   POST  staff: { guild, captain, referee } to save. Either role can be "" (nobody gets it from Discord).
import { getStaff, json, sameOrigin } from "../lib/auth.mjs";
import { store } from "../lib/bingo.mjs";
import { logActivity } from "../lib/activity.mjs";
import { botToken, clearRoleCache, discord, members, readRoleSettings, SNOWFLAKE } from "../lib/roles.mjs";

const MEMBERS_INTENT = "The bot can't list the server's members. On the Discord Developer Portal, open the bot's application, "
  + "go to Bot and switch on Server Members Intent, then reload this page.";

// Everything the panel shows, for the saved server or the one being picked
async function state(pick){
  const saved = await readRoleSettings();
  const out = { bot: !!botToken(), saved, guild: "", guilds: [], roles: [], problem: "", invite: "" };
  if (!out.bot) return out;
  try {
    const me = await discord("/users/@me");
    out.botName = me.global_name || me.username;
    out.invite = `https://discord.com/oauth2/authorize?client_id=${me.id}&scope=bot&permissions=0`;
    out.guilds = ((await discord("/users/@me/guilds")) || []).map(g => ({ id: g.id, name: g.name }));
  } catch (e) {
    out.problem = e.status === 401 ? "Discord didn't accept DISCORD_BOT_TOKEN. Copy the token again from the bot's page (Bot > Reset Token), update it in Netlify and redeploy."
      : "Couldn't reach Discord. Try again in a moment.";
    return out;
  }
  out.guild = pick || saved.guild;
  if (!out.guild) return out;
  if (!out.guilds.some(g => g.id === out.guild)) {
    out.problem = out.guild === saved.guild ? "The bot isn't in the saved server any more. Invite it back, or pick another server." : "The bot isn't in that server.";
    return out;
  }
  const roles = (await discord(`/guilds/${out.guild}/roles`)) || [];
  // Not @everyone (its ID is the server's) or roles other bots and integrations manage
  out.roles = roles.filter(r => r.id !== out.guild && !r.managed).sort((a, b) => b.position - a.position)
    .map(r => ({ id: r.id, name: r.name, color: r.color ? "#" + r.color.toString(16).padStart(6, "0") : "" }));
  try {
    const list = await members(out.guild), count = {};
    list.forEach(m => m.roles.forEach(id => count[id] = (count[id] || 0) + 1));
    out.roles.forEach(r => r.count = count[r.id] || 0);
  } catch (e) {
    if (e.status === 403 || e.code === 50001) out.problem = MEMBERS_INTENT; else throw e;
  }
  return out;
}

export default async req => {
  const staff = getStaff(req);
  if (!staff) return json({ error: "Log in with an approved Discord account first." }, 401);

  if (req.method === "GET") {
    const pick = new URL(req.url).searchParams.get("guild") || "";
    try { return json(await state(SNOWFLAKE.test(pick) ? pick : "")); }
    catch (e) { console.error("Bingo roles:", e.message); return json({ error: "Couldn't get the server's roles from Discord. Try again in a moment." }, 502); }
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "GET, POST" });
  if (!sameOrigin(req)) return json({ error: "Bad origin." }, 403);
  if (!botToken()) return json({ error: "Add DISCORD_BOT_TOKEN in Netlify first." }, 400);

  const b = await req.json().catch(() => null);
  const guild = String(b?.guild || ""), captain = String(b?.captain || ""), referee = String(b?.referee || "");
  let cur;
  try { cur = await state(guild); } catch { return json({ error: "Couldn't reach Discord. Try again in a moment." }, 502); }
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
