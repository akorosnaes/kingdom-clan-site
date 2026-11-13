// The /api/turkey-trot handler, with its sheet reader and snapshot store passed in so tests can fake them.
import { json } from "./auth.mjs";
import { parseSheet, sampleResult } from "./turkey-trot.mjs";

export const CACHE_TAG = "turkeytrot";
const CDN_CACHE = { "cache-control": "public, max-age=0, must-revalidate",
  "netlify-cdn-cache-control": "public, durable, s-maxage=30", "cache-tag": CACHE_TAG, "netlify-vary": "query=sample" };
const EMPTY = () => ({ total: 26, drops: [], players: [], updated: null });

// deps: { env(name), configured(), readSheet(id, tab) -> { progress, drops }, snapshot: { get(), set(result) } }
export const makeHandler = deps => async req => {
  if (req.method !== "GET") return json({ error: "Method not allowed." }, 405, { allow: "GET" });
  const now = new Date().toISOString();

  const q = new URL(req.url).searchParams;
  if (deps.env("TROT_ALLOW_SAMPLE") === "1" && q.get("sample") === "1")
    return json({ ...sampleResult(Date.now(), { n: Number(q.get("n")) || 0, seed: q.has("seed") ? Number(q.get("seed")) : NaN }), updated: now });

  const id = deps.env("TROT_SHEET_ID");
  const saved = () => deps.snapshot.get().catch(() => null);
  if (id && deps.configured()) {
    try {
      const { progress, drops } = await deps.readSheet(id, deps.env("TROT_SHEET_TAB") || "Progress");
      const result = { ...parseSheet(progress, drops), updated: now };
      if (result.players.length) {
        await deps.snapshot.set(result).catch(() => {});
        return json(result, 200, CDN_CACHE);
      }
      // An empty tab (for example while /trotsync is rewriting it) must not wipe a board that had players
      const last = await saved();
      return json(last?.players?.length ? last : result, 200, CDN_CACHE);
    } catch (e) { console.error("turkey-trot sheet read failed:", e.message); }
    const last = await saved();
    return last ? json(last, 200, CDN_CACHE) : json({ error: "The standings are not available right now." }, 503);
  }
  return json(await saved() || EMPTY(), 200, CDN_CACHE);
};
