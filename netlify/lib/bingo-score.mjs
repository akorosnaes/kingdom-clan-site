// Bingo scoring, the same rules as the Bingo page, for the link preview image and the edge function that describes the board.
// Plain JavaScript with no Node imports, so the edge function (Deno) can use it too.
export const COLORS = ["#e5484d", "#3e63dd", "#30a46c", "#f5d90a", "#8e4ec6", "#f76b15", "#12a594", "#d6409f"];
const LINES = [0, 1, 2, 3, 4].flatMap(i => [[0, 1, 2, 3, 4].map(c => i * 5 + c), [0, 1, 2, 3, 4].map(r => r * 5 + i)]);   // rows and columns

const need = t => t?.need || 1;
const isDone = (board, team, i) => (team.p?.[i] || 0) >= need(board.tiles[i]);
const bonus = board => board.bonus ?? 25;

// Every tile's points plus every possible bingo
export const total = board => board.tiles.reduce((a, t) => a + (t.points || 0), 0) + LINES.length * bonus(board);

// "before" the start time, "over" after the end time, otherwise "live"
export const phase = (board, now = Date.now()) => board.starts && now < board.starts ? "before" : board.ends && now >= board.ends ? "over" : "live";

// Teams with their score, tiles done and bingos, highest score first
export function standings(board){
  return board.teams.map((t, i) => {
    const tiles = board.tiles.filter((_, j) => isDone(board, t, j)).length;
    const lines = LINES.filter(l => l.every(j => isDone(board, t, j))).length;
    const pts = board.tiles.reduce((a, x, j) => a + (isDone(board, t, j) ? x.points || 0 : 0), 0) + lines * bonus(board);
    return { name: t.name, color: t.color || COLORS[i % COLORS.length], icon: t.icon || "", pts, tiles, bingos: lines };
  }).sort((a, b) => b.pts - a.pts || b.tiles - a.tiles);
}

// The clan rank icon picked for a team, on the OSRS wiki
export const rankIcon = n => "https://oldschool.runescape.wiki/images/Clan_icon_-_" + encodeURIComponent(n.replace(/ /g, "_")) + ".png";
