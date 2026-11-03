// /api/og/bingo.png: the picture Discord (and other sites) show when someone shares the Bingo page.
// A 1200×630 card with the bingo's name and live standings: each team's icon, score and progress.
// Until staff reveal the board it only lists the teams. Drawn as SVG and turned into a PNG with resvg.
// The CDN keeps it until the board changes (every save clears it); the edge function bingo-meta.mjs links to it with
// the board's revision in the URL, so Discord fetches a fresh one whenever the standings change.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { CACHE_TAG, readBoard } from "../lib/bingo.mjs";
import { phase, rankIcon, standings, total } from "../lib/bingo-score.mjs";

const W = 1200, H = 630, PAD = 72, MAX_ROWS = 5;
// Files shipped with the function (see netlify.toml), found from the site's root folder
const file = p => readFileSync(join(process.cwd(), p));
let ready = null, fonts = null;
function setup(){
  ready ??= initWasm(file("node_modules/@resvg/resvg-wasm/index_bg.wasm"));
  fonts ??= ["Geist-Regular.ttf", "Geist-SemiBold.ttf", "GeistMono-Medium.ttf"].map(f => new Uint8Array(file("netlify/og/" + f)));
  return ready;
}
let crown = null;
const crownUri = () => crown ??= "data:image/png;base64," + file("netlify/og/crown.png").toString("base64");

const x = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
const cut = (s, n) => s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
const num = n => Math.round(n).toLocaleString("en-US");

// The team's clan icon as an embedded picture (resvg can't fetch images itself); null if the wiki doesn't answer quickly
async function iconData(name){
  try {
    const r = await fetch(rankIcon(name), { signal: AbortSignal.timeout(2500), headers: { "user-agent": "KingdomClanSite/1.0 (kingdomosrs.com bingo preview)" } });
    if (!r.ok) return null;
    return "data:image/png;base64," + Buffer.from(await r.arrayBuffer()).toString("base64");
  } catch { return null; }
}

async function card(board){
  // Before the reveal, teams go in setup order with no progress, so the order gives nothing away
  const hidden = !board.revealed, tot = total(board), p = phase(board);
  const rows = standings(hidden ? { ...board, teams: board.teams.map(t => ({ ...t, p: [] })) } : board);
  const shown = rows.slice(0, MAX_ROWS), more = rows.length - shown.length;
  const icons = await Promise.all(shown.map(r => r.icon ? iconData(r.icon) : null));
  const status = hidden ? ["#9a9a9a", "Board revealed after the draft"] : p === "before" ? ["#e8b923", "Starting soon"]
    : p === "over" ? ["#9a9a9a", "Final results"] : ["#34a853", "Live now"];
  const top = 300, step = Math.min(62, (H - 90 - top) / Math.max(1, shown.length + (more ? 1 : 0)));

  const teamRows = shown.map((r, i) => {
    const y = top + i * step, mark = icons[i]
      ? `<image href="${icons[i]}" x="${PAD + 46}" y="${y - 23}" width="26" height="26" image-rendering="optimizeSpeed"/>`
      : `<circle cx="${PAD + 59}" cy="${y - 10}" r="8" fill="${x(r.color)}"/>`;
    const barW = W - PAD * 2 - 88, fill = hidden || !tot ? 0 : Math.max(r.pts ? 6 : 0, Math.min(1, r.pts / tot) * barW);
    return `${hidden ? "" : `<text x="${PAD}" y="${y}" class="m" font-size="24" fill="${i === 0 && r.pts ? "#ffffff" : "#5f5f5f"}">${i + 1}</text>`}
      ${mark}
      <text x="${PAD + 88}" y="${y}" class="s" font-size="30" fill="#ffffff">${x(cut(r.name, 30))}</text>
      ${hidden ? "" : `<text x="${W - PAD}" y="${y}" class="m" font-size="26" fill="#ffffff" text-anchor="end" xml:space="preserve">${num(r.pts)}<tspan fill="#9a9a9a" font-size="18"> pts</tspan></text>
      <rect x="${PAD + 88}" y="${y + 12}" width="${barW}" height="5" rx="2.5" fill="#232323"/>
      ${fill ? `<rect x="${PAD + 88}" y="${y + 12}" width="${fill}" height="5" rx="2.5" fill="${x(r.color)}"/>` : ""}`}`;
  }).join("");

  const empty = rows.length ? "" : `<text x="${PAD}" y="${top}" class="r" font-size="28" fill="#9a9a9a">Teams are picked in the Bingo Draft</text>`;
  const extra = more ? `<text x="${PAD + 88}" y="${top + shown.length * step}" class="r" font-size="22" fill="#9a9a9a">+ ${more} more team${more === 1 ? "" : "s"}</text>` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <style>.r{font-family:Geist;font-weight:400}.s{font-family:Geist;font-weight:600}.m{font-family:'Geist Mono';font-weight:500}</style>
  <rect width="${W}" height="${H}" fill="#080808"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="#1c1c1c"/>
  <image href="${crownUri()}" x="${PAD}" y="62" width="53" height="36"/>
  <text x="${PAD + 70}" y="88" class="m" font-size="20" letter-spacing="5" fill="#9a9a9a">KINGDOM · BINGO</text>
  <text x="${PAD}" y="176" class="s" font-size="64" letter-spacing="-2" fill="#ffffff">${x(cut(board.title || "Bingo", 32))}</text>
  <circle cx="${PAD + 7}" cy="225" r="7" fill="${status[0]}"/>
  <text x="${PAD + 24}" y="233" class="r" font-size="26" fill="#ffffff" xml:space="preserve">${status[1]}<tspan fill="#9a9a9a" dx="12">${rows.length ? `·  ${rows.length} team${rows.length === 1 ? "" : "s"}` : ""}${hidden || !rows.length ? "" : `  ·  ${num(tot)} points up for grabs`}</tspan></text>
  ${teamRows}${extra}${empty}
  <text x="${PAD}" y="${H - 44}" class="m" font-size="18" letter-spacing="2" fill="#5f5f5f">KINGDOMOSRS.COM/BINGO</text>
</svg>`;
}

export default async req => {
  await setup();
  const board = await readBoard();
  const svg = await card(board);
  const png = new Resvg(svg, { fitTo: { mode: "width", value: W },
    font: { fontBuffers: fonts, defaultFontFamily: "Geist", loadSystemFonts: false } }).render().asPng();
  return new Response(png, { headers: { "content-type": "image/png", "cache-control": "public, max-age=300",
    "netlify-cdn-cache-control": "public, durable, s-maxage=86400", "cache-tag": CACHE_TAG, "netlify-vary": "query" } });
};

export const config = { path: "/api/og/bingo.png" };
