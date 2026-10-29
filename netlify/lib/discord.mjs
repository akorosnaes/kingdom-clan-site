// Posts approved bingo drops to a Discord channel.
//
// Netlify environment variable (optional; nothing is posted without it):
//   DISCORD_BINGO_WEBHOOK  the channel's webhook URL (Discord: channel settings > Integrations > Webhooks > New Webhook > Copy Webhook URL)
import { env } from "./auth.mjs";

const WEBHOOK = /^https:\/\/(?:ptb\.|canary\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const IMAGE = /\.(png|jpe?g|gif|webp)(\?.*)?$/i;
const SITE = "https://kingdomosrs.com/bingo.html";

// Completed rows and columns ("Row 2", "Column 5") for a team
export function lines(board, team){
  const done = i => team.p[i] >= (board.tiles[i]?.need || 1);
  const out = [];
  for (let r = 0; r < 5; r++) if ([0,1,2,3,4].every(c => done(r * 5 + c))) out.push(`Row ${r + 1}`);
  for (let c = 0; c < 5; c++) if ([0,1,2,3,4].every(r => done(r * 5 + c))) out.push(`Column ${c + 1}`);
  return out;
}

// The team's score against everything on the board (tile points + every possible bingo), as on the Bingo page
function standing(board, team){
  const bonus = board.bonus ?? 25, done = i => team.p[i] >= (board.tiles[i]?.need || 1);
  const tiles = board.tiles.filter((t, i) => done(i)).length, bingos = lines(board, team).length;
  const pts = board.tiles.reduce((a, t, i) => a + (done(i) ? t.points || 0 : 0), 0) + bingos * bonus;
  const total = board.tiles.reduce((a, t) => a + (t.points || 0), 0) + 10 * bonus;
  const pct = total ? Math.min(100, Math.round(pts / total * 100)) : 0, filled = Math.round(pct / 10);
  const bar = "🟩".repeat(filled) + "⬛".repeat(10 - filled);
  return `${bar} **${pct}%**\n${pts.toLocaleString("en-US")} / ${total.toLocaleString("en-US")} pts · ${tiles} tile${tiles === 1 ? "" : "s"} done · ${bingos} bingo${bingos === 1 ? "" : "s"}`;
}

// Never throws: a Discord hiccup mustn't stop the approval going through
export async function announceDrop({ board, team, sub, newLines }){
  const url = env("DISCORD_BINGO_WEBHOOK");
  if (!WEBHOOK.test(url)) return;
  const t = board.tiles[sub.tile] || {}, need = t.need || 1, v = Math.max(0, team.p[sub.tile]);
  const progress = v >= need ? "Completed!" : `${v}/${need}`;
  const fields = [
    { name: "Tile", value: `${sub.tileName} · ${t.points || 0} pts`, inline: true },
    { name: "Progress", value: progress, inline: true },
    { name: "Logged by", value: sub.by.name, inline: true }
  ];
  if (newLines.length) fields.push({ name: "BINGO!", value: `${newLines.join(", ")} complete · +${board.bonus ?? 25} pts each` });
  fields.push({ name: `${team.name} progress`.slice(0, 256), value: standing(board, team) });
  const embed = {
    title: `${sub.player} received ${sub.item}`.slice(0, 256),
    url: SITE,
    description: `**${team.name}**${board.title ? ` · ${board.title}` : ""}`,
    // The bar down the left side: green once the drop completes the tile, yellow while it's still in progress
    color: v >= need ? 0x34a853 : 0xe8b923,
    fields,
    timestamp: new Date(sub.t).toISOString(),
    footer: { text: "Kingdom Bingo" }
  };
  if (IMAGE.test(sub.proof)) embed.image = { url: sub.proof };
  else fields.push({ name: "Proof", value: sub.proof.slice(0, 1000) });
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(5000),
      // allowed_mentions: names and items come from captains, so they can't ping @everyone or roles
      body: JSON.stringify({ username: "Kingdom Bingo", embeds: [embed], allowed_mentions: { parse: [] } }) });
    if (!r.ok) console.error("Discord webhook failed:", r.status, await r.text().catch(() => ""));
  } catch (e) { console.error("Discord webhook failed:", e.message); }
}
