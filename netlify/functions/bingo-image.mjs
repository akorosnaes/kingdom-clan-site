// /api/bingo/images/:id: a custom tile image. Images never change once uploaded, so they're cached for a long time.
import { IMAGE_ID, imageKey, store } from "../lib/bingo.mjs";

export default async (req, context) => {
  const id = context.params.id;
  if (!IMAGE_ID.test(id)) return new Response("Not found", { status: 404 });
  const hit = await store().getWithMetadata(imageKey(id), { type: "arrayBuffer" });
  if (!hit) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(hit.data, { headers: {
    "content-type": hit.metadata.type || "image/png", "cache-control": "public, max-age=31536000, immutable" } });
};

export const config = { path: "/api/bingo/images/:id" };
