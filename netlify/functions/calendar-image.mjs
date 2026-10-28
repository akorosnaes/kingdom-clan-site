// /api/calendars/:month: the calendar image itself. Links carry ?v=<upload time>, so a replaced image gets a new URL
// and browsers can cache each version for a long time.
import { imageKey, MONTH, store } from "../lib/calendars.mjs";

export default async (req, context) => {
  const month = context.params.month;
  if (!MONTH.test(month)) return new Response("Not found", { status: 404 });
  const hit = await store().getWithMetadata(imageKey(month), { type: "arrayBuffer" });
  if (!hit) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(hit.data, { headers: {
    "content-type": hit.metadata.type || "image/png",
    "cache-control": new URL(req.url).searchParams.has("v") ? "public, max-age=31536000, immutable" : "public, max-age=300" } });
};

export const config = { path: "/api/calendars/:month" };
