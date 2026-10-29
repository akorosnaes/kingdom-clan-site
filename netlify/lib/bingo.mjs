// Bingo storage in Netlify Blobs: the board ("board") plus custom tile images ("img/<id>").
import { getStore } from "@netlify/blobs";

export const store = () => getStore({ name: "bingo", consistency: "strong" });
export const imageKey = id => "img/" + id;
export const IMAGE_ID = /^[a-f0-9]{18}$/;
export const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const MAX_BYTES = 512 * 1024;
