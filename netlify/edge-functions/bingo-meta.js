// Link previews for the Bingo page. When Discord (or another site's link previewer) fetches /bingo.html, this swaps the page's
// fixed preview picture and description for live ones: the standings card from /api/og/bingo.png and a line like
// "Team Zamorak leads with 1,240 pts · 4 teams · live now". The picture's URL carries the board's revision, so a
// changed board gets a fresh picture instead of Discord's cached one. Visitors' browsers get the page untouched.
import { phase, standings } from "../lib/bingo-score.mjs";

const PREVIEWERS = /discordbot|twitterbot|facebookexternalhit|slackbot|telegrambot|whatsapp|linkedinbot|redditbot|embedly|skypeuripreview|iframely|mastodon/i;
const num = n => Math.round(n).toLocaleString("en-US");
const attr = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function describe(board){
  const n = board.teams.length, teams = `${n} team${n === 1 ? "" : "s"}`;
  if (!n) return "Live clan bingo board: every team's tiles, points and bingos.";
  if (!board.revealed) return `${teams} drafted · the board is revealed after the draft.`;
  const p = phase(board), [a, b] = standings(board);
  const when = p === "before" ? "starting soon" : p === "over" ? "final results" : "live now";
  if (!a.pts) return `${teams} · ${when} · no tiles completed yet.`;
  const lead = b && b.pts === a.pts ? `${a.name} and ${b.name} are tied on ${num(a.pts)} pts`
    : `${a.name} ${p === "over" ? "won" : "leads"} with ${num(a.pts)} pts`;
  return `${lead} · ${teams} · ${when}`;
}

export default async (req, context) => {
  if (!PREVIEWERS.test(req.headers.get("user-agent") || "")) return;   // people get the normal page
  const page = await context.next();
  let board;
  try { board = await (await fetch(new URL("/api/bingo", req.url))).json(); } catch { return page; }
  if (!board || !Array.isArray(board.teams)) return page;

  const img = new URL(`/api/og/bingo.png?v=${board.rev || 0}-${board.revealed ? phase(board) : "hidden"}`, req.url).href;
  const desc = attr(describe(board)), title = attr(board.title ? `${board.title} · Kingdom` : "Kingdom Bingo");
  const html = (await page.text())
    .replace(/(<meta property="og:image" content=")[^"]*/, `$1${attr(img)}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, `$1${desc}`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${desc}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${title}`);
  const headers = new Headers(page.headers);
  headers.delete("content-length");
  headers.set("cache-control", "public, max-age=0, must-revalidate");
  return new Response(html, { status: page.status, headers });
};

export const config = { path: ["/bingo.html", "/bingo"] };
