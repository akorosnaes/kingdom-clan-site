// Calendar storage in Netlify Blobs: one image per month ("img/2026-10") plus a small index of what's uploaded.
import { getStore } from "@netlify/blobs";

export const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const MAX_BYTES = 5 * 1024 * 1024;

export const store = () => getStore({ name: "calendars", consistency: "strong" });
export const imageKey = month => "img/" + month;

// [{ month, type, size, updated, by }], newest month first
export async function readIndex(s = store()){
  const list = await s.get("index", { type: "json" });
  return Array.isArray(list) ? list : [];
}
export const writeIndex = (list, s = store()) =>
  s.setJSON("index", list.slice().sort((a, b) => b.month.localeCompare(a.month)));
